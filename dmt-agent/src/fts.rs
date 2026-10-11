//! FTS data plane for cross-site model copies (Plan/FTS_API.md). The desktop
//! still speaks the agent NDJSON protocol; the two agents coordinate through
//! the FtsPrepare/FtsReserve/FtsFinalize ops while the file bytes travel
//! directly between the two sites' local fts daemons (QUIC with TCP fallback,
//! BLAKE3-checked, checkpoint resume). Each agent controls ONLY its local
//! daemon over the localhost REST API - the fts REST/gRPC endpoints must never
//! be exposed beyond the machine they run on.
//!
//! Flow (source agent = the one the desktop called, target agent = receiver):
//! 1. source probes its local fts daemon (`capabilities`);
//! 2. source -> target: FtsPrepare  (target stages per-kind dirs, reports its
//!    fts data port and certificate fingerprint);
//! 3. per kind: source -> target FtsReserve (fresh 600s inbox token), then
//!    source submits the model folder to its local daemon with that ticket and
//!    follows the SSE event stream, mapping events onto progress lines;
//! 4. source -> target FtsFinalize (delete guards + atomic swap-in, shared
//!    implementation in dmt-copy-core::finalize).
//!
//! Any failure here falls back to the QUIC relay data plane in main.rs.

use crate::relay::{kind_base, sweep_stale_staging};
use dmt_copy_core::copier::{endpoint_model_folders, target_folder_path, CopyEndpoint, CopyProgress};
use dmt_copy_core::fts_client::{
    fts_error_name, FtsClient, FtsEvent, TransferStatus, UncCredential, FTS_ERROR_INTERRUPTED,
};
use dmt_copy_core::finalize::{finalize_staged_folders, StagedFolder};
use dmt_copy_core::protocol::{
    AgentLine, AgentRequest, AgentTarget, FtsPrepareReply, FtsReserveReply, FtsStage, FTS_MIN_PROTOCOL,
};
use dmt_copy_core::{call_agent, ensure_unc_credentials, relay::staging_prefix, CopyReport};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

// ---------- configuration ----------

/// The `[fts]` section of agent.json. Every field has a default so an agent
/// upgraded in place keeps working with zero config changes.
#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct FtsConfig {
    pub enabled: bool,
    /// The local daemon's REST endpoint (must stay localhost-only).
    pub rest_addr: String,
    /// The port the local daemon's data plane listens on; the source site
    /// dials `<target agent host>:<this port>`.
    pub data_port: u16,
    /// Where the daemon keeps its self-signed certificate. Empty = `.fts`
    /// next to the agent executable (matches the fts-daemon.ps1 default).
    pub cert_cache: String,
}

impl Default for FtsConfig {
    fn default() -> Self {
        FtsConfig { enabled: true, rest_addr: "127.0.0.1:5050".into(), data_port: 4433, cert_cache: String::new() }
    }
}

impl FtsConfig {
    fn cert_cache_dir(&self) -> PathBuf {
        if self.cert_cache.trim().is_empty() {
            return std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
                .unwrap_or_default()
                .join(".fts");
        }
        PathBuf::from(&self.cert_cache)
    }
}

/// The daemon pins its own certificate fingerprint at startup: BLAKE3 over the
/// certificate DER (`File-Transfer/src/tls.rs`). Reading the same file gives
/// the same value without any operator copy-paste.
fn daemon_fingerprint(config: &FtsConfig) -> Result<String, String> {
    let cert_path = config.cert_cache_dir().join("fts-cert.der");
    let cert = std::fs::read(&cert_path).map_err(|error| {
        format!("Cannot read the fts certificate at {} - is the fts daemon running with this cert cache? ({error})", cert_path.display())
    })?;
    let fingerprint = blake3::hash(&cert).to_hex().to_string();
    Ok(fingerprint)
}

fn conn_id() -> String {
    format!(
        "{:x}",
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() ^ std::process::id() as u128
    )
}

fn validate_kind(kind: &str) -> Result<(), String> {
    if kind.is_empty() || !kind.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("Unsafe spec kind \"{kind}\"."));
    }
    Ok(())
}

/// The fts data address the source site dials: the same host the agent itself
/// was dialed on (the Tailscale IP), but the daemon's data port.
fn data_addr(agent_addr: &str, data_port: u16) -> String {
    let host = agent_addr.trim().trim_start_matches("tcp://");
    let host = match host.rfind(':') {
        Some(index) => &host[..index],
        None => host,
    };
    format!("{host}:{data_port}")
}

// ---------- target-side handlers (run on the RECEIVING agent) ----------

/// FtsPrepare: create the per-kind staging directories on this site's Vision
/// PC and report how our local fts daemon can be reached.
pub fn handle_prepare(config: &FtsConfig, target: &CopyEndpoint, target_model: &str, kinds: &[String]) -> Result<FtsPrepareReply, String> {
    if target_model.trim().is_empty() {
        return Err("A target model name is required.".into());
    }
    ensure_unc_credentials(&[&target.inventory_path, &target.repository_path], &target.username, &target.password)?;
    let id = conn_id();
    let mut stages = Vec::new();
    for kind in kinds {
        validate_kind(kind)?;
        let base = kind_base(target, kind)?;
        sweep_stale_staging(&base);
        let stage = base.join(format!("{}fts_{id}_{kind}", staging_prefix()));
        std::fs::create_dir_all(&stage).map_err(|error| format!("Cannot create staging {}: {error}", stage.display()))?;
        stages.push(FtsStage {
            kind: kind.clone(),
            staging_dir: stage.display().to_string(),
            final_dir: target_folder_path(target, kind, target_model).display().to_string(),
        });
    }
    let fingerprint = daemon_fingerprint(config)?;
    crate::log(&format!("[fts] prepared {} staging folder(s), data port {}", stages.len(), config.data_port));
    Ok(FtsPrepareReply { fts_port: config.data_port, fingerprint, stages })
}

/// FtsReserve: one directory-mode inbox token on our local daemon for one
/// staging directory. Called right before each submit so the 600s token TTL
/// never expires mid-run. The staging dir must be one THIS agent handed out.
pub fn handle_reserve(config: &FtsConfig, target: &CopyEndpoint, kind: &str, staging_dir: &str) -> Result<FtsReserveReply, String> {
    validate_kind(kind)?;
    let base = kind_base(target, kind)?;
    let staging = Path::new(staging_dir);
    let name_ok = staging.file_name().map(|name| name.to_string_lossy().starts_with(staging_prefix())).unwrap_or(false);
    if staging.parent() != Some(base.as_path()) || !name_ok {
        return Err(format!("Refusing to reserve {staging_dir}: not a staging directory this agent created under {}.", base.display()));
    }
    if !staging.is_dir() {
        return Err(format!("Staging directory {staging_dir} is gone - run FtsPrepare again."));
    }
    let client = FtsClient::new(&config.rest_addr);
    let credential = if target.username.is_empty() && target.password.is_empty() {
        None
    } else {
        Some(UncCredential { user_name: target.username.clone(), password: target.password.clone() })
    };
    let token = client.reserve_inbox(staging_dir, credential.as_ref())?;
    crate::log(&format!("[fts] reserved inbox for {kind} in {staging_dir}"));
    Ok(FtsReserveReply { token })
}

/// FtsFinalize: swap the transferred folders into place with the same delete
/// guards as every other copy path. Every path is re-derived/validated here -
/// the source agent's message is only trusted to point at staging dirs this
/// agent itself created.
pub fn handle_finalize(target: &CopyEndpoint, source_model: &str, target_model: &str, kinds: &[String], folders: &[StagedFolder]) -> Result<CopyReport, String> {
    for folder in folders {
        if !kinds.iter().any(|kind| kind == &folder.kind) {
            return Err(format!("Finalize mentions kind {} which is not part of this transfer.", folder.kind));
        }
        validate_kind(&folder.kind)?;
        let base = kind_base(target, &folder.kind)?;
        let stage = Path::new(&folder.stage_dir);
        let stage_name_ok = stage.file_name().map(|name| name.to_string_lossy().starts_with(staging_prefix())).unwrap_or(false);
        if stage.parent() != Some(base.as_path()) || !stage_name_ok {
            return Err(format!("Refusing to finalize {}: not a staging directory this agent created under {}.", folder.stage_dir, base.display()));
        }
        if Path::new(&folder.staged_model_dir).parent() != Some(stage) {
            return Err(format!("Refusing to finalize {}: the staged folder is not inside {}.", folder.staged_model_dir, folder.stage_dir));
        }
        if Path::new(&folder.final_dir) != target_folder_path(target, &folder.kind, target_model) {
            return Err(format!("Refusing to finalize {}: not the target folder for model {target_model}.", folder.final_dir));
        }
    }
    ensure_unc_credentials(&[&target.inventory_path, &target.repository_path], &target.username, &target.password)?;
    crate::log(&format!("[fts] finalizing {} folder(s) into place", folders.len()));
    finalize_staged_folders(folders.to_vec(), target, source_model, target_model, kinds)
}

// ---------- source-side orchestration ----------

/// The terminal state of one fts task, from the result event or (if the event
/// stream died) a Status poll.
#[derive(Clone, Debug)]
struct TaskOutcome {
    state: String,
    checksum_ok: bool,
    error_code: i32,
    error: String,
}

impl TaskOutcome {
    fn ok(&self) -> bool {
        self.state == "COMPLETED" && self.checksum_ok
    }
}

/// Maps the daemon's SSE events onto the agent's CopyProgress lines.
struct TaskObserver<'a> {
    kind: &'a str,
    tx: &'a mpsc::UnboundedSender<AgentLine>,
    relay_mode: String,
    completed_bytes: u64,
    files_done: u64,
    files_total: u64,
    current_file: String,
}

impl TaskObserver<'_> {
    fn emit(&self, bytes_done: u64) {
        let _ = self.tx.send(AgentLine::Progress {
            progress: CopyProgress {
                kind: self.kind.to_string(),
                file: self.current_file.clone(),
                files_done: self.files_done as u32,
                files_total: self.files_total as u32,
                bytes_done,
                relay_mode: self.relay_mode.clone(),
            },
        });
    }

    fn on_event(&mut self, event: &FtsEvent) {
        match event {
            FtsEvent::File { name, index, total } => {
                self.files_total = *total;
                self.files_done = index.saturating_sub(1);
                self.current_file = name.clone();
                self.emit(self.completed_bytes);
            }
            FtsEvent::Progress { bytes_done, .. } => self.emit(self.completed_bytes + bytes_done),
            FtsEvent::FileDone { bytes, .. } => {
                self.completed_bytes += bytes;
                self.files_done += 1;
                self.emit(self.completed_bytes);
            }
            FtsEvent::Degradation { .. } => {
                self.relay_mode = "fts-tcp".into();
                self.emit(self.completed_bytes);
            }
            _ => {}
        }
    }
}

/// Submit one transfer and follow it to a terminal state. Blocking - run in
/// spawn_blocking. The SSE stream is the primary source; if it ends without a
/// result event we poll Status once (the fts contract's fallback).
fn submit_and_observe(client: &FtsClient, source_dir: &str, dst_addr: &str, fingerprint: &str, ticket: &str, kind: &str, tx: &mpsc::UnboundedSender<AgentLine>) -> Result<TaskOutcome, String> {
    let task_id = client.submit(&[source_dir], dst_addr, fingerprint, ticket, "auto")?;
    crate::log(&format!("[fts] submitted {kind} as task {task_id}"));
    let mut observer = TaskObserver { kind, tx, relay_mode: "fts".into(), completed_bytes: 0, files_done: 0, files_total: 0, current_file: String::new() };
    let events_result = client.events(&task_id, &mut |event| observer.on_event(event));
    match events_result {
        Ok(Some(event)) => {
            let FtsEvent::Result { state, checksum_ok, error_code, error, .. } = event else {
                return Err("fts stream produced a non-result terminal event".into());
            };
            Ok(TaskOutcome { state, checksum_ok, error_code, error })
        }
        Ok(None) => Err("fts event stream produced no result event".into()),
        Err(stream_error) => {
            let status: TransferStatus = client.status(&task_id)?;
            if status.state == "RUNNING" {
                return Err(format!("fts event stream lost while the task was still running: {stream_error}"));
            }
            crate::log(&format!("[fts] stream lost, Status fallback says {} for {kind}", status.state));
            Ok(TaskOutcome { state: status.state, checksum_ok: status.checksum_ok, error_code: status.error_code, error: status.error_message })
        }
    }
}

/// Source side of the FTS data plane. Blocking work runs in spawn_blocking;
/// progress flows out through `tx` exactly like the QUIC relay does. Any
/// error makes main.rs fall back to the relay data plane.
pub async fn run_cross_site_fts(
    config: &FtsConfig,
    source: &CopyEndpoint,
    target_agent: &AgentTarget,
    target: &CopyEndpoint,
    source_model: &str,
    target_model: &str,
    tx: &mpsc::UnboundedSender<AgentLine>,
) -> Result<serde_json::Value, String> {
    if !config.enabled {
        return Err("The fts data plane is disabled in agent.json.".into());
    }

    // 1. the local daemon must be alive and speaking a known contract
    let rest_addr = config.rest_addr.clone();
    let capabilities = tokio::task::spawn_blocking(move || FtsClient::new(&rest_addr).capabilities())
        .await
        .map_err(|error| error.to_string())??;
    crate::log(&format!("[fts] local daemon fts v{}, protocol v{}", capabilities.fts_version, capabilities.protocol_version));

    // 2. the source folders to send; the UNC sessions this establishes also
    //    serve the fts daemon reading them (same Windows account)
    let source_clone = source.clone();
    let source_model_owned = source_model.to_string();
    let folders = tokio::task::spawn_blocking(move || -> Result<Vec<(String, PathBuf)>, String> {
        ensure_unc_credentials(&[&source_clone.inventory_path, &source_clone.repository_path], &source_clone.username, &source_clone.password)?;
        endpoint_model_folders(&source_clone, &source_model_owned)
    })
    .await
    .map_err(|error| error.to_string())??;
    if folders.is_empty() {
        return Err(format!("Model {source_model} was not found on {} - nothing to send.", source.host));
    }
    let kinds: Vec<String> = folders.iter().map(|(kind, _)| kind.clone()).collect();

    // 3. the target agent stages and reports its daemon's data port + fingerprint
    let prepare_request = AgentRequest::FtsPrepare { target: target.clone(), target_model: target_model.to_string(), kinds: kinds.clone() };
    let agent_target = target_agent.clone();
    let (protocol, value) = tokio::task::spawn_blocking(move || call_agent(&agent_target, &prepare_request, |_| {}))
        .await
        .map_err(|error| error.to_string())??;
    if protocol < FTS_MIN_PROTOCOL {
        return Err(format!("The target site's agent speaks protocol v{protocol} - the fts data plane needs v{FTS_MIN_PROTOCOL}."));
    }
    let prepare: FtsPrepareReply = serde_json::from_value(value).map_err(|error| format!("fts prepare reply malformed: {error}"))?;
    let dst_addr = data_addr(&target_agent.addr, prepare.fts_port);
    crate::log(&format!("[fts] target staged {} kind(s), data plane {dst_addr}", prepare.stages.len()));

    // 4. per kind: reserve a fresh inbox token, submit, watch the events
    let client = FtsClient::new(&config.rest_addr);
    let mut staged_folders = Vec::new();
    for stage in &prepare.stages {
        let (_, source_dir) = folders
            .iter()
            .find(|(kind, _)| *kind == stage.kind)
            .ok_or_else(|| format!("Kind {} disappeared on the source side mid-transfer.", stage.kind))?;
        let source_dir = source_dir.display().to_string();
        let staged_model_dir = Path::new(&stage.staging_dir)
            .join(Path::new(&source_dir).file_name().ok_or_else(|| format!("Cannot derive the folder name of {source_dir}"))?);

        let reserve_request = AgentRequest::FtsReserve { target: target.clone(), kind: stage.kind.clone(), staging_dir: stage.staging_dir.clone() };
        let agent_target = target_agent.clone();
        let (_, value) = tokio::task::spawn_blocking(move || call_agent(&agent_target, &reserve_request, |_| {}))
            .await
            .map_err(|error| error.to_string())??;
        let reserve: FtsReserveReply = serde_json::from_value(value).map_err(|error| format!("fts reserve reply malformed: {error}"))?;

        let mut outcome = submit_and_observe(&client, &source_dir, &dst_addr, &prepare.fingerprint, &reserve.token, &stage.kind, tx)?;
        if !outcome.ok() && outcome.error_code == FTS_ERROR_INTERRUPTED {
            // resubmitting with the same ticket resumes from the receiver's
            // checkpoints - no caller intervention needed (fts contract)
            crate::log(&format!("[fts] {} interrupted, resubmitting with the same ticket", stage.kind));
            outcome = submit_and_observe(&client, &source_dir, &dst_addr, &prepare.fingerprint, &reserve.token, &stage.kind, tx)?;
        }
        if !outcome.ok() {
            return Err(format!(
                "The fts transfer of {} failed: {} ({} / code {}).",
                stage.kind,
                if outcome.error.is_empty() { "no detail".to_string() } else { outcome.error.clone() },
                fts_error_name(outcome.error_code),
                outcome.error_code
            ));
        }
        staged_folders.push(StagedFolder {
            kind: stage.kind.clone(),
            stage_dir: stage.staging_dir.clone(),
            staged_model_dir: staged_model_dir.display().to_string(),
            final_dir: stage.final_dir.clone(),
        });
    }

    // 5. the target swaps everything into place and reports per kind
    let finalize_request = AgentRequest::FtsFinalize {
        target: target.clone(),
        source_model: source_model.to_string(),
        target_model: target_model.to_string(),
        kinds,
        folders: staged_folders,
    };
    let agent_target = target_agent.clone();
    let (_, value) = tokio::task::spawn_blocking(move || call_agent(&agent_target, &finalize_request, |_| {}))
        .await
        .map_err(|error| error.to_string())??;
    crate::log("[fts] finalize done");
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dmt_agent_fts_test_{}_{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn endpoint(inventory: &Path, repository: &Path) -> CopyEndpoint {
        CopyEndpoint {
            host: "FM2".into(),
            inventory_path: inventory.display().to_string(),
            repository_path: repository.display().to_string(),
            username: String::new(),
            password: String::new(),
        }
    }

    fn config_with(cert_cache: &Path, rest_addr: &str) -> FtsConfig {
        FtsConfig { enabled: true, rest_addr: rest_addr.to_string(), data_port: 4433, cert_cache: cert_cache.display().to_string() }
    }

    /// A one-shot localhost HTTP stub for the fts REST surface.
    fn http_stub(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut tmp = [0u8; 4096];
            loop {
                if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
                let n = stream.read(&mut tmp).unwrap();
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&tmp[..n]);
            }
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&raw).to_string()
        });
        (addr, handle)
    }

    #[test]
    fn data_addr_extracts_the_host_from_the_agent_address() {
        assert_eq!(data_addr("100.64.0.5:3777", 4433), "100.64.0.5:4433");
        assert_eq!(data_addr("tcp://site-b.tailnet:3777", 4433), "site-b.tailnet:4433");
        assert_eq!(data_addr("100.64.0.5", 4433), "100.64.0.5:4433");
    }

    fn write_cert(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("fts-cert.der"), vec![9u8; 128]).unwrap();
    }

    #[test]
    fn prepare_creates_staging_and_reads_the_daemon_fingerprint() {
        let base = temp_dir("prepare");
        write_cert(&base.join(".fts"));
        let cert = std::fs::read(base.join(".fts").join("fts-cert.der")).unwrap();
        let inventory = base.join("inv");
        let repository = base.join("repo");
        let config = config_with(&base.join(".fts"), "127.0.0.1:5050");

        let reply = handle_prepare(&config, &endpoint(&inventory, &repository), "2AN0860F01", &["LIGHT_SPEC".to_string(), "PxRepository".to_string()]).unwrap();
        assert_eq!(reply.fts_port, 4433);
        assert_eq!(reply.fingerprint, blake3::hash(&cert).to_hex().to_string(), "same BLAKE3 over the DER as the daemon prints");
        assert_eq!(reply.stages.len(), 2);
        for stage in &reply.stages {
            assert!(Path::new(&stage.staging_dir).is_dir(), "{}", stage.staging_dir);
            // spec kinds stage under the inventory ROOT (invisible to model
            // scans); PxRepository under its own root
            let expected_parent = if stage.kind == "PxRepository" { repository.clone() } else { inventory.clone() };
            assert_eq!(Path::new(&stage.staging_dir).parent(), Some(expected_parent.as_path()), "{}", stage.staging_dir);
        }
        assert!(reply.stages.iter().any(|stage| stage.final_dir.ends_with("LIGHT_SPEC\\2AN0860F01")));
    }

    #[test]
    fn prepare_fails_without_a_readable_certificate() {
        let base = temp_dir("nocert");
        let inventory = base.join("inv");
        let config = config_with(&base.join("missing"), "127.0.0.1:5050");
        let error = handle_prepare(&config, &endpoint(&inventory, &base.join("repo")), "M02", &["LIGHT_SPEC".to_string()]).unwrap_err();
        assert!(error.contains("fts-cert.der"), "{error}");
    }

    #[test]
    fn reserve_rejects_foreign_dirs_then_reserves_via_the_daemon() {
        let base = temp_dir("reserve");
        let inventory = base.join("inv");
        let repository = base.join("repo");
        let config = config_with(&base.join("certs"), "127.0.0.1:0");

        // a staging dir the agent never handed out is refused before any REST call
        let foreign = inventory.join("LIGHT_SPEC").join("2AN0860F01");
        std::fs::create_dir_all(&foreign).unwrap();
        let error = handle_reserve(&config, &endpoint(&inventory, &repository), "LIGHT_SPEC", &foreign.display().to_string()).unwrap_err();
        assert!(error.contains("Refusing to reserve"), "{error}");

        // the real flow: prepare hands out a staging dir, the local daemon
        // (stubbed) answers the inbox reservation
        write_cert(&base.join("certs"));
        let body = r#"{"token":"tok-1","expires_in":600}"#;
        let response: &'static str = Box::leak(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len()).into_boxed_str());
        let (addr, server) = http_stub(response);
        let config = config_with(&base.join("certs"), &addr);
        let prepare = handle_prepare(&config, &endpoint(&inventory, &repository), "2AN0860F01", &["LIGHT_SPEC".to_string()]).unwrap();
        let staging_dir = prepare.stages[0].staging_dir.clone();
        let reply = handle_reserve(&config, &endpoint(&inventory, &repository), "LIGHT_SPEC", &staging_dir).unwrap();
        assert_eq!(reply.token, "tok-1");
        let request = server.join().unwrap();
        assert!(request.contains("POST /v1/inbox"), "{request}");
        assert!(!request.contains("credential"), "no credential section for unconfigured endpoints");
    }

    #[test]
    fn finalize_swaps_the_fts_staged_folder_into_place_and_validates() {
        let base = temp_dir("finalize");
        let inventory = base.join("inv");
        let repository = base.join("repo");
        let config = config_with(&base.join("certs"), "127.0.0.1:0");
        write_cert(&base.join("certs"));
        let target = endpoint(&inventory, &repository);

        let prepare = handle_prepare(&config, &target, "2AN0860F01", &["LIGHT_SPEC".to_string()]).unwrap();
        let stage = &prepare.stages[0];
        // simulate what fts delivered: the folder under its SOURCE name
        let staged_model = Path::new(&stage.staging_dir).join("2AN0859F01-00");
        std::fs::create_dir_all(&staged_model).unwrap();
        std::fs::write(staged_model.join("LightSpec.xml"), "<light/>").unwrap();

        let folder = StagedFolder { kind: "LIGHT_SPEC".into(), stage_dir: stage.staging_dir.clone(), staged_model_dir: staged_model.display().to_string(), final_dir: stage.final_dir.clone() };
        let report = handle_finalize(&target, "2AN0859F01", "2AN0860F01", &["LIGHT_SPEC".to_string()], &[folder]).unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(inventory.join("LIGHT_SPEC").join("2AN0860F01").join("LightSpec.xml").exists());
        assert!(!Path::new(&stage.staging_dir).exists(), "staging root is cleared");

        // a staged folder outside its staging dir must be refused
        let prepare = handle_prepare(&config, &target, "M02", &["LIGHT_SPEC".to_string()]).unwrap();
        let stage = &prepare.stages[0];
        let rogue = base.join("rogue");
        std::fs::create_dir_all(&rogue).unwrap();
        let folder = StagedFolder { kind: "LIGHT_SPEC".into(), stage_dir: stage.staging_dir.clone(), staged_model_dir: rogue.display().to_string(), final_dir: stage.final_dir.clone() };
        let error = handle_finalize(&target, "M01", "M02", &["LIGHT_SPEC".to_string()], &[folder]).unwrap_err();
        assert!(error.contains("not inside"), "{error}");
        assert!(Path::new(&stage.staging_dir).exists(), "refused finalize leaves staging intact");
    }
}

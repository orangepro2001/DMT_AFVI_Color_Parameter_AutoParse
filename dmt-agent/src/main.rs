//! dmt-agent: a small daemon deployed on one always-on Windows host per site
//! (usually the main PC). The desktop app connects over Tailscale and sends
//! model scan / model copy requests; this agent executes them against the
//! site's real LAN, where the Vision PC shares are gigabit-connected, and
//! streams progress back. All the copy/scan domain logic lives in
//! dmt-copy-core, so the agent and the desktop fallback path behave
//! identically.

use dmt_copy_core::protocol::{
    constant_time_eq, AgentAuth, AgentLine, AgentRequest, AuthReply, AGENT_PROTOCOL_VERSION,
};
use dmt_copy_core::relay::RelayManifest;
use dmt_copy_core::{build_copy_plan, canonical_model_name, execute_copy_plan, scan_hosts, AgentTarget, CopyEndpoint, CopyProgress};
use serde::Deserialize;
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

mod relay;

#[derive(Deserialize, Default)]
struct AgentConfig {
    port: u16,
    #[serde(default)]
    token: String,
}

/// CLI: dmt-agent.exe [--config <path>] [--port <n>] [--token <t>]
/// Default config file: agent.json next to the executable.
fn load_config() -> Result<(u16, String), String> {
    let args: Vec<String> = std::env::args().collect();
    let mut config_path: Option<String> = None;
    let mut port_override: Option<u16> = None;
    let mut token_override: Option<String> = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--config" => {
                config_path = args.get(index + 1).cloned();
                index += 2;
            }
            "--port" => {
                port_override = args.get(index + 1).and_then(|v| v.parse().ok());
                index += 2;
            }
            "--token" => {
                token_override = args.get(index + 1).cloned();
                index += 2;
            }
            other => return Err(format!("Unknown argument {other} - usage: dmt-agent [--config <path>] [--port <n>] [--token <t>]")),
        }
    }

    let path = config_path
        .map(PathBuf::from)
        .unwrap_or_else(default_config_path);
    let mut config = if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        serde_json::from_str::<AgentConfig>(&text).map_err(|error| format!("Cannot parse {}: {error}", path.display()))?
    } else {
        AgentConfig::default()
    };

    if let Some(port) = port_override {
        config.port = port;
    }
    if let Some(token) = token_override {
        config.token = token;
    }
    if config.port == 0 {
        return Err("No port configured - set \"port\" in agent.json or pass --port.".into());
    }
    if config.token.trim().is_empty() {
        return Err("No token configured - set \"token\" in agent.json or pass --token. The agent refuses to run unauthenticated.".into());
    }
    config.token = config.token.trim().to_string();
    Ok((config.port, config.token))
}

fn default_config_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
        .unwrap_or_default()
        .join("agent.json")
}

// ---------- logging ----------
// Everything goes to stderr (visible in a console run) AND to agent.log next
// to the executable - a scheduled-task service has no console, so without the
// file there would be no trace of panics or connection errors at all.

static LOG_PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

fn init_logging(config_dir: &Path) {
    let path = config_dir.join("agent.log");
    // one rotation step: agent.log over 5 MB becomes agent.log.old
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_ROTATE_BYTES {
            let _ = std::fs::rename(&path, config_dir.join("agent.log.old"));
        }
    }
    let _ = LOG_PATH.set(path);
}

/// UTC timestamp - the agent may run as SYSTEM on any site's host, local
/// timezone handling would need platform APIs for little gain.
fn timestamp() -> String {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // days-from-epoch to civil date (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 };
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

pub fn log(message: &str) {
    eprintln!("{message}");
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{} {message}", timestamp());
        }
    }
}

#[tokio::main]
async fn main() {
    let config_dir = default_config_path().parent().map(|dir| dir.to_path_buf()).unwrap_or_default();
    init_logging(&config_dir);
    let (port, token) = match load_config() {
        Ok(config) => config,
        Err(error) => {
            crate::log(&format!("[dmt-agent] {error}"));
            std::process::exit(1);
        }
    };
    let listener = match TcpListener::bind(("0.0.0.0", port)).await {
        Ok(listener) => listener,
        Err(error) => {
            crate::log(&format!("[dmt-agent] Cannot bind 0.0.0.0:{port}: {error}"));
            std::process::exit(1);
        }
    };
    crate::log(&format!("[dmt-agent] v{} listening on 0.0.0.0:{port} (protocol v{AGENT_PROTOCOL_VERSION}), log: {}", env!("CARGO_PKG_VERSION"), LOG_PATH.get().map(|p| p.display().to_string()).unwrap_or_default()));

    // task panics must leave a trace in the console / service log - a silent
    // task death would otherwise look like a network problem to the operator
    std::panic::set_hook(Box::new(|info| {
        let location = info.location().map(|location| format!("{}:{}:{}", location.file(), location.line(), location.column())).unwrap_or_default();
        let payload = info.payload();
        let message = if let Some(text) = payload.downcast_ref::<&'static str>() {
            (*text).to_string()
        } else if let Some(text) = payload.downcast_ref::<String>() {
            text.clone()
        } else {
            "unknown panic payload".to_string()
        };
        crate::log(&format!("[dmt-agent] PANIC at {location}: {message}"));
    }));

    // QUIC relay listener on the same port number (UDP socket, independent of
    // the TCP listener above); the agent still works TCP-only if this fails
    match relay::server_endpoint(port, &config_dir) {
        Ok(relay_endpoint) => {
            tokio::spawn(relay::serve_relay(relay_endpoint, token.clone()));
        }
        Err(error) => crate::log(&format!("[dmt-agent] relay disabled: {error}")),
    };

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let token = token.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_connection(stream, &token).await {
                        crate::log(&format!("[dmt-agent] {peer}: {error}"));
                    }
                });
            }
            Err(error) => eprintln!("[dmt-agent] accept failed: {error}"),
        }
    }
}

async fn handle_connection(stream: TcpStream, token: &str) -> Result<(), String> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    // the first frame must authenticate, or nothing else is read
    let first = next_line(&mut lines).await?;
    let auth: AgentAuth = parse_line(&first)?;
    if !constant_time_eq(auth.auth.trim(), token) {
        write_line(&mut writer, &AuthReply { ok: false, version: String::new(), protocol: 0, error: Some("authentication failed".into()) }).await?;
        return Err("authentication failed".into());
    }
    write_line(&mut writer, &AuthReply { ok: true, version: env!("CARGO_PKG_VERSION").into(), protocol: AGENT_PROTOCOL_VERSION, error: None }).await?;

    let request_line = next_line(&mut lines).await?;
    let request: AgentRequest = parse_line(&request_line)?;

    // The TCP-relay fallback needs the WHOLE stream back; reunite works because
    // reader and writer came from the same split, and the buffered reader cannot
    // hold a partial line (the request line was newline-framed).
    if let AgentRequest::TcpRelayPush { manifest, streams } = request {
        let buffered = lines.into_inner();
        let reader = buffered.into_inner();
        let stream = reader.reunite(writer).map_err(|_| "cannot reassemble the control connection".to_string())?;
        // this connection becomes the control channel of a relay transfer
        // where THIS agent is the target site
        return relay::handle_tcp_relay_push(stream, manifest, streams, token.to_string()).await;
    }

    // cross-site copies run on the async runtime (QUIC data plane); everything
    // else uses the blocking worker pool
    if let AgentRequest::CopyCrossSite { source, target_agent, target, model_name, target_model_name, force_full, confirmed } = request {
        let (tx, mut rx) = mpsc::unbounded_channel::<AgentLine>();
        let worker = tokio::spawn(run_cross_site(source, target_agent, target, model_name, target_model_name, force_full, confirmed, tx));
        while let Some(line) = rx.recv().await {
            write_line(&mut writer, &line).await?;
        }
        // rx closed: the task either finished (its Result line already went
        // out) or panicked - a panic must reach the client as an error line,
        // never as a silent disconnect
        if let Err(join) = worker.await {
            let message = panic_message(join);
            crate::log(&format!("[dmt-agent] cross-site task panicked: {message}"));
            let _ = write_line(&mut writer, &AgentLine::Result { result: None, error: Some(format!("agent internal error: {message}")) }).await;
            return Err(message);
        }
        return Ok(());
    }

    // the remaining ops are blocking domain work on the worker pool; progress
    // lines stream through this channel while the task forwards them out
    let (tx, mut rx) = mpsc::unbounded_channel::<AgentLine>();
    let worker = tokio::task::spawn_blocking(move || run_request(request, tx));
    while let Some(line) = rx.recv().await {
        write_line(&mut writer, &line).await?;
    }
    if let Err(join) = worker.await {
        let message = panic_message(join);
        crate::log(&format!("[dmt-agent] task panicked: {message}"));
        let _ = write_line(&mut writer, &AgentLine::Result { result: None, error: Some(format!("agent internal error: {message}")) }).await;
        return Err(message);
    }
    Ok(())
}

/// Extract the panic payload so operators see WHERE and WHY a task died.
fn panic_message(join: tokio::task::JoinError) -> String {
    if join.is_panic() {
        let payload = join.into_panic();
        if let Some(text) = payload.downcast_ref::<&'static str>() {
            (*text).to_string()
        } else if let Some(text) = payload.downcast_ref::<String>() {
            text.clone()
        } else {
            "unknown panic".to_string()
        }
    } else {
        join.to_string()
    }
}

/// Source side of a cross-site copy: enumerate the model on this site's
/// Vision PC (LAN speed) and push it to the target site's agent over QUIC.
/// ALWAYS answers with a Result line - an error must reach the desktop as
/// text, never as a silent connection close (that is what `?` paths used to
/// do and the desktop reported it as a bare EOF).
async fn run_cross_site(
    source: CopyEndpoint,
    target_agent: AgentTarget,
    target: CopyEndpoint,
    model_name: String,
    target_model_name: String,
    force_full: bool,
    confirmed: bool,
    tx: mpsc::UnboundedSender<AgentLine>,
) -> Result<(), String> {
    let outcome = run_cross_site_inner(source, target_agent, target, model_name, target_model_name, force_full, confirmed, &tx).await;
    match outcome {
        Ok(value) => {
            let _ = tx.send(AgentLine::Result { result: Some(value), error: None });
            Ok(())
        }
        Err(error) => {
            crate::log(&format!("[dmt-agent] cross-site copy failed: {error}"));
            let _ = tx.send(AgentLine::Result { result: None, error: Some(error.clone()) });
            Err(error)
        }
    }
}

async fn run_cross_site_inner(
    source: CopyEndpoint,
    target_agent: AgentTarget,
    target: CopyEndpoint,
    model_name: String,
    target_model_name: String,
    force_full: bool,
    confirmed: bool,
    tx: &mpsc::UnboundedSender<AgentLine>,
) -> Result<serde_json::Value, String> {
    if !confirmed {
        return Err("The copy was not confirmed - nothing was changed.".into());
    }
    let source_model = canonical_model_name(&model_name);
    if source_model.is_empty() {
        return Err("A model name is required.".into());
    }
    let target_model = canonical_model_name(if target_model_name.trim().is_empty() { &model_name } else { &target_model_name });
    if !target_model_name.trim().is_empty()
        && (target_model.is_empty() || target_model.starts_with('.') || !target_model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
    {
        return Err(format!("The target model name may only contain letters, digits, - _ . (got \"{target_model}\")."));
    }

    // guard against address-plan collisions: dialing an address that is one
    // of THIS machine's own addresses means the two sites' agent addresses
    // collide (e.g. both sites using 192.168.1.x with the agent on .60) and
    // the transfer would loop back into this site instead of crossing over
    let target_ip = relay::resolve_relay_addr(&target_agent.addr)?.ip();
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_default();
    let local_ips: Vec<std::net::IpAddr> =
        std::net::ToSocketAddrs::to_socket_addrs(&(hostname.as_str(), 0))
            .map(|addrs| addrs.map(|socket| socket.ip()).collect())
            .unwrap_or_default();
    if local_ips.contains(&target_ip) {
        return Err(format!(
            "The target agent address {} resolves to THIS machine - the two sites' address plans collide. Configure agent addresses with each site main PC's Tailscale IP (100.x.x.x) instead of the LAN IP.",
            target_agent.addr
        ));
    }

    let (files, kinds) = {
        let source = source.clone();
        let source_model = source_model.clone();
        tokio::task::spawn_blocking(move || relay::enumerate_source_files(&source, &source_model))
            .await
            .map_err(|error| error.to_string())??
    };
    let manifest = RelayManifest { source_model, target_model, kinds, incremental: !force_full, target };

    let tx_progress = tx.clone();
    let progress: Arc<dyn Fn(CopyProgress) + Send + Sync> = Arc::new(move |progress| {
        let _ = tx_progress.send(AgentLine::Progress { progress });
    });
    // tier 1: QUIC direct (fast, multiplexed, UDP); tier 2: tunnel the same
    // protocol through the plain TCP control channel (works whenever TCP 3777
    // reaches the target agent, e.g. when UDP is firewalled). The desktop
    // falls back to direct SMB only when BOTH relay tiers fail.
    let report = match relay::send_model(&target_agent.addr, &target_agent.token, manifest.clone(), files.clone(), "quic", progress.clone()).await {
        Ok(report) => report,
        Err(quic_error) => {
            crate::log(&format!("[dmt-agent] QUIC relay failed ({}), falling back to the TCP data plane", quic_error));
            relay::send_model_tcp(&target_agent.addr, &target_agent.token, manifest, files, progress).await?
        }
    };
    serde_json::to_value(report).map_err(|error| error.to_string())
}

fn run_request(request: AgentRequest, tx: mpsc::UnboundedSender<AgentLine>) -> Result<(), String> {
    match run_inner(request, &tx) {
        Ok(value) => {
            let _ = tx.send(AgentLine::Result { result: Some(value), error: None });
            Ok(())
        }
        Err(error) => {
            let _ = tx.send(AgentLine::Result { result: None, error: Some(error.clone()) });
            Err(error)
        }
    }
}

fn run_inner(request: AgentRequest, tx: &mpsc::UnboundedSender<AgentLine>) -> Result<serde_json::Value, String> {
    match request {
        AgentRequest::Ping => Ok(json!({ "version": env!("CARGO_PKG_VERSION"), "protocol": AGENT_PROTOCOL_VERSION })),
        AgentRequest::ScanModels { machine } => {
            let candidates = scan_hosts(
                &[("FM1", &machine.fm1_path), ("FM2", &machine.fm2_path), ("BM", &machine.bm_path)],
                &machine.username,
                &machine.password,
            )?;
            serde_json::to_value(candidates).map_err(|error| error.to_string())
        }
        AgentRequest::Copy { source, target, model_name, target_model_name, confirmed } => {
            if !confirmed {
                return Err("The copy was not confirmed - nothing was changed.".into());
            }
            // Re-derive the plan instead of trusting the client: the shares may
            // have changed between the preview and this request.
            let plan = build_copy_plan(&source, &target, &model_name, &target_model_name)?;
            let report = execute_copy_plan(&plan, &target, &|progress| {
                let _ = tx.send(AgentLine::Progress { progress });
            })?;
            serde_json::to_value(report).map_err(|error| error.to_string())
        }
        AgentRequest::CopyCrossSite { .. } => unreachable!("cross-site copies are handled asynchronously in handle_connection"),
        AgentRequest::TcpRelayPush { .. } => unreachable!("tcp relay pushes are handled in handle_connection"),
    }
}

async fn next_line<R: tokio::io::AsyncRead + Unpin>(lines: &mut tokio::io::Lines<tokio::io::BufReader<R>>) -> Result<String, String> {
    let line = lines
        .next_line()
        .await
        .map_err(|error| format!("connection read failed: {error}"))?
        .ok_or_else(|| "client closed the connection before finishing the handshake".to_string())?;
    if line.len() > 64 * 1024 * 1024 {
        return Err("oversized line - aborting".into());
    }
    Ok(line)
}

fn parse_line<T: serde::de::DeserializeOwned>(line: &str) -> Result<T, String> {
    serde_json::from_str(line.trim()).map_err(|error| format!("malformed line: {error}"))
}

async fn write_line(writer: &mut (impl tokio::io::AsyncWrite + Unpin), value: &impl serde::Serialize) -> Result<(), String> {
    let mut json = serde_json::to_string(value).map_err(|error| error.to_string())?;
    json.push('\n');
    writer.write_all(json.as_bytes()).await.map_err(|error| format!("connection write failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use dmt_copy_core::client::call_agent;
    use dmt_copy_core::protocol::AgentTarget;
    use dmt_copy_core::{CopyEndpoint, CopyReport, ModelCandidate};
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dmt_agent_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn endpoint(inventory: &PathBuf, repository: &PathBuf, host: &str) -> CopyEndpoint {
        CopyEndpoint {
            host: host.into(),
            inventory_path: inventory.display().to_string(),
            repository_path: repository.display().to_string(),
            username: String::new(),
            password: String::new(),
        }
    }

    /// One agent connection is one request; this helper boots a server on an
    /// ephemeral port and answers a single connection with the given token.
    async fn serve_one(token: &'static str) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            // rejected connections legitimately end in Err - don't panic the server task
            let _ = handle_connection(stream, token).await;
        });
        (addr, handle)
    }

    async fn blocking<T: Send + 'static>(task: impl FnOnce() -> T + Send + 'static) -> T {
        tokio::task::spawn_blocking(task).await.unwrap()
    }

    #[tokio::test]
    async fn wrong_token_is_rejected() {
        let (addr, server) = serve_one("secret").await;
        let target = AgentTarget { addr, token: "wrong".into() };
        let result = blocking(move || call_agent(&target, &AgentRequest::Ping, |_| {})).await;
        assert!(result.unwrap_err().contains("authentication failed"), "expected auth failure");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn ping_answers_with_version() {
        let (addr, server) = serve_one("secret").await;
        let target = AgentTarget { addr, token: "secret".into() };
        let (protocol, value) = blocking(move || call_agent(&target, &AgentRequest::Ping, |_| {})).await.unwrap();
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(protocol, AGENT_PROTOCOL_VERSION, "auth reply carries the protocol version");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn scan_and_copy_run_end_to_end_with_progress() {
        let base = temp_dir("e2e");
        let source_inv = base.join("src_inv");
        let source_repo = base.join("src_repo");
        let target_inv = base.join("dst_inv");
        let target_repo = base.join("dst_repo");
        // a model with a few files so the parallel copy path produces progress lines
        let light = source_inv.join("LIGHT_SPEC").join("2AN0859F01");
        fs::create_dir_all(&light).unwrap();
        fs::write(light.join("LightSpec.xml"), "<light/>").unwrap();
        fs::create_dir_all(&source_repo.join("2AN0859F01").join("sub")).unwrap();
        for i in 0..20 {
            fs::write(source_repo.join("2AN0859F01").join("sub").join(format!("g{i}.gbr")), vec![7u8; 1024]).unwrap();
        }

        // scan finds the model on FM1 only (only source paths point anywhere real)
        let (addr, server) = serve_one("secret").await;
        let target = AgentTarget { addr: addr.clone(), token: "secret".into() };
        let machine = dmt_copy_core::MachinePaths {
            fm1_path: source_inv.display().to_string(),
            fm2_path: String::new(),
            bm_path: String::new(),
            username: String::new(),
            password: String::new(),
        };
        let t = target.clone();
        let (_, candidates) = blocking(move || call_agent(&t, &AgentRequest::ScanModels { machine }, |_| {})).await.unwrap();
        let candidates: Vec<ModelCandidate> = serde_json::from_value(candidates).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].name, "2AN0859F01");
        assert_eq!(candidates[0].hosts, ["FM1"]);
        server.await.unwrap();

        // copy moves the model source -> target and streams progress
        let (addr, server) = serve_one("secret").await;
        let target = AgentTarget { addr, token: "secret".into() };
        let source = endpoint(&source_inv, &source_repo, "FM1");
        let destination = endpoint(&target_inv, &target_repo, "FM2");
        let request = AgentRequest::Copy { source, target: destination, model_name: "2AN0859F01".into(), target_model_name: String::new(), confirmed: true };
        let progress_lines = std::sync::Arc::new(std::sync::Mutex::new(0u32));
        let counter = progress_lines.clone();
        let report_value = blocking(move || {
            call_agent(&target, &request, |_| {
                *counter.lock().unwrap() += 1;
            })
        })
        .await
        .unwrap();
        let report: CopyReport = serde_json::from_value(report_value.1).unwrap();
        assert_eq!(report.model_name, "2AN0859F01");
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(*progress_lines.lock().unwrap() > 3, "expected progress lines");
        assert_eq!(fs::read_to_string(target_repo.join("2AN0859F01").join("sub").join("g0.gbr")).unwrap().len(), 1024);
        server.await.unwrap();
    }

    fn relay_target_endpoint(dst_inv: &std::path::Path, dst_repo: &std::path::Path) -> CopyEndpoint {
        CopyEndpoint {
            host: "FM2".into(),
            inventory_path: dst_inv.display().to_string(),
            repository_path: dst_repo.display().to_string(),
            username: String::new(),
            password: String::new(),
        }
    }

    #[tokio::test]
    async fn wrong_relay_token_is_rejected() {
        let base = temp_dir("relay_auth");
        let config_dir = base.join("cfg");
        std::fs::create_dir_all(&config_dir).unwrap();
        let relay_endpoint = relay::server_endpoint(0, &config_dir).unwrap();
        let local = relay_endpoint.local_addr().unwrap();
        let addr = std::net::SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), local.port()).to_string();
        tokio::spawn(relay::serve_relay(relay_endpoint, "secret".to_string()));

        let manifest = RelayManifest {
            source_model: "M01".into(),
            target_model: "M01".into(),
            kinds: vec!["LIGHT_SPEC".into()],
            incremental: true,
            target: relay_target_endpoint(&base.join("inv"), &base.join("repo")),
        };
        let result = relay::send_model(&addr, "wrong-token", manifest, Vec::new(), "quic", Arc::new(|_| {})).await;
        assert!(result.unwrap_err().contains("authentication failed"), "expected auth failure");
    }

    #[tokio::test]
    async fn cross_site_relay_transfers_skips_and_reconciles() {
        use std::sync::atomic::{AtomicU64, Ordering};

        let base = temp_dir("relay");
        let src_inv = base.join("src_inv");
        let src_repo = base.join("src_repo");
        let dst_inv = base.join("dst_inv");
        let dst_repo = base.join("dst_repo");
        let light = src_inv.join("LIGHT_SPEC").join("2AN0859F01");
        fs::create_dir_all(&light).unwrap();
        fs::write(light.join("LightSpec.xml"), "<light/>").unwrap();
        let repo_dir = src_repo.join("2AN0859F01").join("sub");
        fs::create_dir_all(&repo_dir).unwrap();
        // 200 files: exercises stream-count limits and the spawn_blocking pool
        for i in 0..200 {
            fs::write(repo_dir.join(format!("g{i}.gbr")), vec![7u8; 50_000]).unwrap();
        }

        let config_dir = base.join("agentcfg");
        fs::create_dir_all(&config_dir).unwrap();
        let relay_endpoint = relay::server_endpoint(0, &config_dir).unwrap();
        let local = relay_endpoint.local_addr().unwrap();
        let addr = std::net::SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), local.port()).to_string();
        tokio::spawn(relay::serve_relay(relay_endpoint, "secret".to_string()));

        let source = CopyEndpoint {
            host: "FM1".into(),
            inventory_path: src_inv.display().to_string(),
            repository_path: src_repo.display().to_string(),
            username: String::new(),
            password: String::new(),
        };
        let target = relay_target_endpoint(&dst_inv, &dst_repo);

        let (files, kinds) = blocking({ let source = source.clone(); move || relay::enumerate_source_files(&source, "2AN0859F01") }).await.unwrap();
        assert_eq!(kinds, ["LIGHT_SPEC", "PxRepository"]);

        let manifest = RelayManifest { source_model: "2AN0859F01".into(), target_model: "2AN0860F01".into(), kinds, incremental: true, target };
        let last_bytes = Arc::new(AtomicU64::new(u64::MAX));
        let progress = { let last_bytes = last_bytes.clone(); Arc::new(move |p: CopyProgress| { last_bytes.store(p.bytes_done, Ordering::Relaxed); }) };
        let report = relay::send_model(&addr, "secret", manifest.clone(), files, "quic", progress).await.unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(dst_inv.join("LIGHT_SPEC").join("2AN0860F01").join("LightSpec.xml").exists());
        assert_eq!(fs::read(dst_repo.join("2AN0860F01").join("sub").join("g0.gbr")).unwrap().len(), 50_000);
        // mtime is restored so later incremental runs can match
        assert_eq!(fs::metadata(src_repo.join("2AN0859F01").join("sub").join("g0.gbr")).unwrap().modified().unwrap(),
                   fs::metadata(dst_repo.join("2AN0860F01").join("sub").join("g0.gbr")).unwrap().modified().unwrap(),
                   "mtime must be restored after the relay transfer");

        // a folder under the SOURCE name on the target must survive the rename copy
        let guard_dir = dst_inv.join("LIGHT_SPEC").join("2AN0859F01");
        fs::create_dir_all(&guard_dir).unwrap();
        // an INSPECT_SPEC folder on the target that the source doesn't have is reconciled away
        let stale_kind = dst_inv.join("INSPECT_SPEC").join("2AN0860F01");
        fs::create_dir_all(&stale_kind).unwrap();

        // second run (incremental): every file skipped, zero bytes transferred
        let (files, _) = blocking({ let source = source.clone(); move || relay::enumerate_source_files(&source, "2AN0859F01") }).await.unwrap();
        let last_bytes = Arc::new(AtomicU64::new(u64::MAX));
        let progress = { let last_bytes = last_bytes.clone(); Arc::new(move |p: CopyProgress| { last_bytes.store(p.bytes_done, Ordering::Relaxed); }) };
        let report = relay::send_model(&addr, "secret", manifest.clone(), files, "quic", progress).await.unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert_eq!(last_bytes.load(Ordering::Relaxed), 0, "incremental run must transfer zero bytes");
        // CRITICAL: skipped files must survive the folder swap
        assert_eq!(fs::read(dst_repo.join("2AN0860F01").join("sub").join("g0.gbr")).unwrap().len(), 50_000, "skipped files must survive the incremental run");
        assert!(guard_dir.exists(), "source-named folder survives");
        assert!(!stale_kind.exists(), "kinds absent from the manifest are reconciled away");

        // mixed run: one file changed at the source - 199 skipped + 1 sent, and
        // the folder must end up complete (skips + replacement together)
        fs::write(src_repo.join("2AN0859F01").join("sub").join("g7.gbr"), vec![9u8; 60_000]).unwrap();
        let (files, _) = blocking({ let source = source.clone(); move || relay::enumerate_source_files(&source, "2AN0859F01") }).await.unwrap();
        let report = relay::send_model(&addr, "secret", manifest.clone(), files, "quic", Arc::new(|_| {})).await.unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert_eq!(fs::read(dst_repo.join("2AN0860F01").join("sub").join("g7.gbr")).unwrap().len(), 60_000, "changed file re-transferred");
        assert_eq!(fs::read(dst_repo.join("2AN0860F01").join("sub").join("g0.gbr")).unwrap().len(), 50_000, "unchanged files kept through the mixed run");
        assert_eq!(fs::read_dir(dst_repo.join("2AN0860F01").join("sub")).unwrap().count(), 200, "no file lost in the mixed incremental run");

        // forced full transfer re-sends everything
        let (files, _) = blocking({ let source = source.clone(); move || relay::enumerate_source_files(&source, "2AN0859F01") }).await.unwrap();
        let manifest = RelayManifest { incremental: false, ..manifest };
        let last_bytes = Arc::new(AtomicU64::new(0));
        let progress = { let last_bytes = last_bytes.clone(); Arc::new(move |p: CopyProgress| { last_bytes.store(p.bytes_done, Ordering::Relaxed); }) };
        let report = relay::send_model(&addr, "secret", manifest, files, "quic", progress).await.unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(last_bytes.load(Ordering::Relaxed) > 250_000, "forced full run must transfer the bytes");
    }

    /// Full TCP data-plane fallback: the target agent runs in a task serving
    /// TcpRelayPush on a real TCP connection; the source pushes over pure TCP
    /// (no QUIC involved). Verifies handshake, port discovery, transfer, skip
    /// protocol, staging swap and the final report over TCP.
    #[tokio::test(flavor = "multi_thread")]
    async fn tcp_fallback_relay_transfers_end_to_end() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use tokio::io::AsyncBufReadExt;

        let base = temp_dir("tcp_relay");
        let src_inv = base.join("src_inv");
        let src_repo = base.join("src_repo");
        let dst_inv = base.join("dst_inv");
        let dst_repo = base.join("dst_repo");
        let light = src_inv.join("LIGHT_SPEC").join("2AN0859F01");
        fs::create_dir_all(&light).unwrap();
        fs::write(light.join("LightSpec.xml"), "<light/>").unwrap();
        let repo_dir = src_repo.join("2AN0859F01").join("sub");
        fs::create_dir_all(&repo_dir).unwrap();
        for i in 0..20 {
            fs::write(repo_dir.join(format!("g{i}.gbr")), vec![7u8; 50_000]).unwrap();
        }

        // a bare TCP listener standing in for the agent's main port: every
        // incoming connection is authenticated like handle_connection does,
        // then TcpRelayPush connections are handed to the relay handler
        let main_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let main_addr = main_listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = main_listener.accept().await else { break };
                let (reader, mut writer) = tokio::io::split(stream);
                let mut reader = tokio::io::BufReader::new(reader);
                let mut auth_line = String::new();
                if reader.read_line(&mut auth_line).await.is_err() {
                    continue;
                }
                let auth: AgentAuth = serde_json::from_str(auth_line.trim()).unwrap();
                let mut reply = serde_json::to_vec(&AuthReply {
                    ok: constant_time_eq(auth.auth.trim(), "secret"),
                    version: String::new(),
                    protocol: AGENT_PROTOCOL_VERSION,
                    error: None,
                })
                .unwrap();
                reply.push(b'\n');
                use tokio::io::AsyncWriteExt;
                let _ = writer.write_all(&reply).await;
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).await.is_err() {
                    continue;
                }
                let request: AgentRequest = serde_json::from_str(request_line.trim()).unwrap();
                if let AgentRequest::TcpRelayPush { manifest, streams } = request {
                    // the relay handler needs the whole stream; a split pair
                    // cannot be reunited, so reconnect is impossible - instead
                    // this bare-bones test server handles the push inline via
                    // a fresh connection: close and let the test dial again is
                    // NOT viable, so wrap the halves back with unsplit glue:
                    // simplest correct approach: answer over the same halves.
                    let _ = relay::handle_tcp_relay_push_halves(reader, writer, manifest, streams, "secret".to_string()).await;
                }
            }
        });

        let source = CopyEndpoint {
            host: "FM1".into(),
            inventory_path: src_inv.display().to_string(),
            repository_path: src_repo.display().to_string(),
            username: String::new(),
            password: String::new(),
        };
        let target = relay_target_endpoint(&dst_inv, &dst_repo);
        let (files, _) = blocking({ let source = source.clone(); move || relay::enumerate_source_files(&source, "2AN0859F01") }).await.unwrap();
        assert_eq!(files.len(), 21);

        let manifest = RelayManifest {
            source_model: "2AN0859F01".into(),
            target_model: "2AN0860F01".into(),
            kinds: vec!["LIGHT_SPEC".into(), "PxRepository".into()],
            incremental: true,
            target,
        };
        let last_bytes = Arc::new(AtomicU64::new(0));
        let progress = { let last_bytes = last_bytes.clone(); Arc::new(move |p: CopyProgress| { last_bytes.store(p.bytes_done, Ordering::Relaxed); }) };
        let target_addr = format!("127.0.0.1:{}", main_addr.port());
        let report = relay::send_model_tcp(&target_addr, "secret", manifest.clone(), files, progress).await.unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(last_bytes.load(Ordering::Relaxed) > 1_000_000, "tcp run must transfer the bytes");
        assert!(dst_inv.join("LIGHT_SPEC").join("2AN0860F01").join("LightSpec.xml").exists());
        assert_eq!(fs::read(dst_repo.join("2AN0860F01").join("sub").join("g0.gbr")).unwrap().len(), 50_000);
        assert_eq!(fs::read_dir(dst_repo.join("2AN0860F01").join("sub")).unwrap().count(), 20, "all 20 gerbers landed");

        // incremental second run over TCP: zero bytes
        let (files, _) = blocking({ let source = source.clone(); move || relay::enumerate_source_files(&source, "2AN0859F01") }).await.unwrap();
        let last_bytes = Arc::new(AtomicU64::new(u64::MAX));
        let progress = { let last_bytes = last_bytes.clone(); Arc::new(move |p: CopyProgress| { last_bytes.store(p.bytes_done, Ordering::Relaxed); }) };
        let report = relay::send_model_tcp(&target_addr, "secret", manifest, files, progress).await.unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert_eq!(last_bytes.load(Ordering::Relaxed), 0, "tcp incremental run must skip everything");

        server.abort();
    }
}

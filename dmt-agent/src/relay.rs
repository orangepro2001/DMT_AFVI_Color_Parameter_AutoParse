//! QUIC data plane for cross-site model transfers. The site that READS the
//! model dials the site that WRITES it (each side touches its Vision PCs at
//! LAN speed); the WAN leg is one QUIC connection carrying `RELAY_STREAMS`
//! multiplexed file streams with per-file zstd compression and incremental
//! skipping. QUIC provides transport integrity and retransmission, so file
//! content is never silently corrupted (no additional checksums needed).

use dmt_copy_core::copier::{assert_deletable, endpoint_model_folders, target_folder_path, CopyEndpoint, CopyProgress, CopyReport, CopyResultEntry};
use dmt_copy_core::protocol::{constant_time_eq, AuthReply};
use dmt_copy_core::relay::{
    should_skip_file, staging_prefix, validate_relative_path, FileHeader, FileReply, FilesDone, RelayHandshake,
    RelayHandshakeReply, RelayManifest, RelayResult, CHUNK_SIZE, COMPRESSION_THRESHOLD, RELAY_ALPN, RELAY_STREAMS,
    STAGING_MAX_AGE_SECS,
};
use dmt_copy_core::ensure_unc_credentials;
use quinn::{Connection, Endpoint, RecvStream, SendStream};
use std::io::{Read, Write};
use std::net::{SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio_util::io::SyncIoBridge;

// ---------- TLS setup ----------

#[derive(Debug)]
struct SkipServerVerification(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        // the certificate is self-signed and not part of the trust model:
        // auth is the site token, encryption is TLS 1.3 inside WireGuard
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, _message: &[u8], _cert: &rustls::pki_types::CertificateDer<'_>, _dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(&self, _message: &[u8], _cert: &rustls::pki_types::CertificateDer<'_>, _dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Self-signed relay certificate, generated on first start and reused forever.
fn load_or_create_relay_cert(config_dir: &Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cert_path = config_dir.join("relay_cert.der");
    let key_path = config_dir.join("relay_key.der");
    if let (Ok(cert), Ok(key)) = (std::fs::read(&cert_path), std::fs::read(&key_path)) {
        return Ok((cert, key));
    }
    let key = rcgen::KeyPair::generate().map_err(|error| format!("Cannot generate relay key: {error}"))?;
    let params = rcgen::CertificateParams::new(vec!["dmt-agent".to_string()]).map_err(|error| error.to_string())?;
    let cert = params.self_signed(&key).map_err(|error| format!("Cannot self-sign the relay certificate: {error}"))?;
    let cert_der = cert.der().as_ref().to_vec();
    let key_der = key.serialize_der();
    std::fs::write(&cert_path, &cert_der).map_err(|error| format!("Cannot write {}: {error}", cert_path.display()))?;
    std::fs::write(&key_path, &key_der).map_err(|error| format!("Cannot write {}: {error}", key_path.display()))?;
    Ok((cert_der, key_der))
}

pub fn server_endpoint(port: u16, config_dir: &Path) -> Result<Endpoint, String> {
    let (cert, key) = load_or_create_relay_cert(config_dir)?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut server_crypto = rustls::ServerConfig::builder_with_provider(provider.into())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| error.to_string())?
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(cert)],
            rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(key)),
        )
        .map_err(|error| format!("Invalid relay certificate: {error}"))?;
    server_crypto.alpn_protocols = vec![RELAY_ALPN.to_vec()];
    let quic_crypto = quinn::crypto::rustls::QuicServerConfig::try_from(server_crypto).map_err(|error| format!("QUIC server config: {error}"))?;
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse::<SocketAddr>().map_err(|error| error.to_string())?;
    Endpoint::server(quinn::ServerConfig::with_crypto(Arc::new(quic_crypto)), addr)
        .map_err(|error| format!("Cannot bind QUIC on {addr}: {error}"))
}

/// Accept loop for the relay listener; one task per incoming connection.
pub async fn serve_relay(endpoint: Endpoint, token: String) {
    while let Some(incoming) = endpoint.accept().await {
        let token = token.clone();
        tokio::spawn(async move {
            let conn = match incoming.await {
                Ok(conn) => conn,
                Err(error) => {
                    crate::log(&format!("[dmt-agent] relay accept: {error}"));
                    return;
                }
            };
            let peer = conn.remote_address();
            if let Err(error) = handle_relay_connection(conn, &token).await {
                crate::log(&format!("[dmt-agent] relay {peer}: {error}"));
            }
        });
    }
}

fn client_endpoint() -> Result<Endpoint, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut client_crypto = rustls::ClientConfig::builder_with_provider(provider.clone().into())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| error.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(SkipServerVerification(provider)))
        .with_no_client_auth();
    client_crypto.alpn_protocols = vec![RELAY_ALPN.to_vec()];
    let quic_crypto = quinn::crypto::rustls::QuicClientConfig::try_from(client_crypto).map_err(|error| format!("QUIC client config: {error}"))?;
    let mut endpoint = Endpoint::client("0.0.0.0:0".parse::<SocketAddr>().map_err(|error| error.to_string())?)
        .map_err(|error| format!("Cannot create QUIC client endpoint: {error}"))?;
    endpoint.set_default_client_config(quinn::ClientConfig::new(Arc::new(quic_crypto)));
    Ok(endpoint)
}

pub fn resolve_relay_addr(addr: &str) -> Result<SocketAddr, String> {
    let trimmed = addr.trim().trim_start_matches("tcp://");
    let with_port = if trimmed.contains(':') { trimmed.to_string() } else { format!("{trimmed}:3777") };
    with_port
        .to_socket_addrs()
        .map_err(|error| format!("Cannot resolve relay address {with_port}: {error}"))?
        .next()
        .ok_or_else(|| format!("No addresses resolved for {with_port}"))
}

// ---------- control-stream wire helpers (async) ----------

async fn read_json_line<T: serde::de::DeserializeOwned>(recv: &mut RecvStream) -> Result<T, String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = recv.read(&mut byte).await.map_err(|error| format!("relay stream read failed: {error:?}"))?;
        if n.unwrap_or(0) == 0 {
            return Err("relay peer closed mid-frame".into());
        }
        if byte[0] == b'\n' {
            break;
        }
        line.push(byte[0]);
        if line.len() > 8 * 1024 * 1024 {
            return Err("relay frame oversized".into());
        }
    }
    serde_json::from_slice(&line).map_err(|error| format!("relay malformed frame: {error}"))
}

async fn write_json_line(send: &mut SendStream, value: &impl serde::Serialize) -> Result<(), String> {
    let mut json = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    json.push(b'\n');
    send.write_all(&json).await.map_err(|error| format!("relay write failed: {error:?}"))
}

/// std-Read-based JSON line reader for the blocking file-stream workers
/// (SyncIoBridge implements Read, but line reading needs the manual loop).
fn sync_read_json_line<T: serde::de::DeserializeOwned>(reader: &mut impl Read) -> Result<T, String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = reader.read(&mut byte).map_err(|error| format!("relay stream read failed: {error}"))?;
        if n == 0 {
            return Err("relay peer closed mid-frame".into());
        }
        if byte[0] == b'\n' {
            break;
        }
        line.push(byte[0]);
        if line.len() > 8 * 1024 * 1024 {
            return Err("relay frame oversized".into());
        }
    }
    serde_json::from_slice(&line).map_err(|error| format!("relay malformed frame: {error}"))
}

// ---------- receiving side ----------

struct Stage {
    kind: String,
    stage: PathBuf,
    final_dir: PathBuf,
}

impl Clone for Stage {
    fn clone(&self) -> Self {
        Stage { kind: self.kind.clone(), stage: self.stage.clone(), final_dir: self.final_dir.clone() }
    }
}

type ReceiveStats = Mutex<HashMap<String, (u64, u64)>>; // kind -> (files received, bytes)
use std::collections::HashMap;

/// Handle one incoming relay connection (server side of the data plane).
pub async fn handle_relay_connection(conn: Connection, token: &str) -> Result<(), String> {
    let (mut ctl_send, mut ctl_recv) = conn.accept_bi().await.map_err(|error| format!("relay handshake stream: {error}"))?;
    let handshake: RelayHandshake = read_json_line(&mut ctl_recv).await?;
    crate::log(&format!("[relay-srv] handshake from {}, token ok={}", conn.remote_address(), constant_time_eq(handshake.auth.trim(), token)));
    if !constant_time_eq(handshake.auth.trim(), token) {
        write_json_line(&mut ctl_send, &RelayHandshakeReply { ok: false, error: Some("authentication failed".into()) }).await?;
        let _ = ctl_send.finish();
        // give the rejection time to reach the client before the drop closes us
        let _ = tokio::time::timeout(Duration::from_secs(2), conn.closed()).await;
        return Err("relay: authentication failed".into());
    }
    write_json_line(&mut ctl_send, &RelayHandshakeReply { ok: true, error: None }).await?;
    crate::log("[relay-srv] auth reply written");

    let result = match receive_model(&conn, &handshake.manifest, &mut ctl_recv).await {
        Ok(report) => RelayResult { report: Some(report), error: None },
        Err(error) => RelayResult { report: None, error: Some(error) },
    };
    write_json_line(&mut ctl_send, &result).await?;
    let _ = ctl_send.finish();
    // dropping the last Connection handle closes the connection IMMEDIATELY
    // and discards untransmitted stream data - hold it until the client closes
    let _ = tokio::time::timeout(Duration::from_secs(10), conn.closed()).await;
    Ok(())
}

/// Spec kinds stage under the inventory ROOT (invisible to model scans, which
/// only look inside LIGHT_SPEC/INSPECT_SPEC); the repository under its root.
fn kind_base(endpoint: &CopyEndpoint, kind: &str) -> Result<PathBuf, String> {
    if kind == "PxRepository" {
        let base = PathBuf::from(endpoint.repository_path.trim());
        if base.as_os_str().is_empty() {
            return Err("The manifest includes PxRepository but the target endpoint has none configured.".into());
        }
        Ok(base)
    } else {
        Ok(PathBuf::from(endpoint.inventory_path.trim()))
    }
}

fn sweep_stale_staging(base: &Path) {
    let Ok(entries) = std::fs::read_dir(base) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(staging_prefix()) {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .map(|age| age.as_secs() >= STAGING_MAX_AGE_SECS)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

async fn receive_model(conn: &Connection, manifest: &RelayManifest, ctl_recv: &mut RecvStream) -> Result<CopyReport, String> {
    let endpoint = manifest.target.clone();
    {
        let inventory = endpoint.inventory_path.clone();
        let repository = endpoint.repository_path.clone();
        let username = endpoint.username.clone();
        let password = endpoint.password.clone();
        tokio::task::spawn_blocking(move || ensure_unc_credentials(&[&inventory, &repository], &username, &password))
            .await
            .map_err(|error| error.to_string())??;
    }

    let conn_id = format!(
        "{:x}",
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() ^ std::process::id() as u128
    );
    let stages: Vec<Stage> = {
        let endpoint = endpoint.clone();
        let kinds = manifest.kinds.clone();
        let target_model = manifest.target_model.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<Stage>, String> {
            let mut stages = Vec::new();
            for kind in kinds {
                let base = kind_base(&endpoint, &kind)?;
                sweep_stale_staging(&base);
                let stage = base.join(staging_prefix().to_string() + &conn_id);
                std::fs::create_dir_all(&stage).map_err(|error| format!("Cannot create staging {}: {error}", stage.display()))?;
                let final_dir = target_folder_path(&endpoint, &kind, &target_model);
                stages.push(Stage { kind, stage, final_dir });
            }
            Ok(stages)
        })
        .await
        .map_err(|error| error.to_string())??
    };

    let done: FilesDone = read_json_line(ctl_recv).await?;
    crate::log(&format!("[relay-srv] receiving {} file streams", done.streams));
    if !done.done {
        remove_stages(&stages);
        return Err("relay: unexpected control frame before transfer completion".into());
    }

    let stage_map: Arc<HashMap<String, PathBuf>> = Arc::new(stages.iter().map(|stage| (stage.kind.clone(), stage.stage.clone())).collect());
    let stats: Arc<ReceiveStats> = Arc::new(Mutex::new(HashMap::new()));
    let mut handles = Vec::new();
    let mut stream_error: Option<String> = None;
    for _ in 0..done.streams {
        let (send, recv) = match conn.accept_bi().await {
            Ok(pair) => pair,
            Err(error) => {
                stream_error = Some(format!("relay file stream: {error}"));
                break;
            }
        };
        let stage_map = stage_map.clone();
        let stats = stats.clone();
        let endpoint = endpoint.clone();
        let target_model = manifest.target_model.clone();
        let incremental = manifest.incremental;
        handles.push(tokio::task::spawn_blocking(move || receive_file_stream(send, recv, &stage_map, &endpoint, &target_model, incremental, &stats)));
    }
    for handle in handles {
        if let Err(error) = handle.await.map_err(|error| format!("relay file task panicked: {error}")).and_then(|inner| inner) {
            if stream_error.is_none() {
                stream_error = Some(error);
            }
        }
    }
    if let Some(error) = stream_error {
        // aborted transfer: wipe the staging residue immediately so no
        // `.dmt_stage_*` folders are left in the share roots
        remove_stages(&stages);
        return Err(error);
    }

    finalize(stages, &endpoint, manifest).await
}

/// Best-effort removal of staging directories from an aborted transfer, so a
/// failed run leaves no `.dmt_stage_*` residue behind.
fn remove_stages(stages: &[Stage]) {
    if stages.is_empty() {
        return;
    }
    for stage in stages {
        let _ = std::fs::remove_dir_all(&stage.stage);
    }
    crate::log(&format!("[relay-srv] cleaned up {} staging folder(s) after a failed transfer", stages.len()));
}

/// QUIC entry: each stream is a (send, recv) pair from the connection.
fn receive_file_stream(
    send: SendStream,
    recv: RecvStream,
    stage_map: &HashMap<String, PathBuf>,
    endpoint: &CopyEndpoint,
    target_model: &str,
    incremental: bool,
    stats: &ReceiveStats,
) -> Result<(), String> {
    let mut writer = SyncIoBridge::new(send);
    let mut reader = SyncIoBridge::new(recv);
    receive_file_stream_io(&mut reader, &mut writer, stage_map, endpoint, target_model, incremental, stats)
}

/// TCP entry: one marker-tagged connection per stream. Marker byte 0 = file.
#[allow(dead_code)]
pub fn receive_file_stream_tcp(
    stream: tokio::net::TcpStream,
    stage_map: &HashMap<String, PathBuf>,
    endpoint: &CopyEndpoint,
    target_model: &str,
    incremental: bool,
    stats: &ReceiveStats,
) -> Result<(), String> {
    let (reader_stream, writer_stream) = tokio::io::split(stream);
    let mut writer = SyncIoBridge::new(writer_stream);
    let mut reader = SyncIoBridge::new(reader_stream);
    receive_file_stream_io(&mut reader, &mut writer, stage_map, endpoint, target_model, incremental, stats)
}

/// Transport-agnostic per-file stream: header -> skip decision -> chunked
/// content. The reply goes on `writer`, the content arrives on `reader`.
fn receive_file_stream_io(
    reader: &mut impl Read,
    writer: &mut impl Write,
    stage_map: &HashMap<String, PathBuf>,
    endpoint: &CopyEndpoint,
    target_model: &str,
    incremental: bool,
    stats: &ReceiveStats,
) -> Result<(), String> {
    let header: FileHeader = sync_read_json_line(reader)?;
    validate_relative_path(&header.path)?;
    let stage_dir = stage_map.get(&header.kind).ok_or_else(|| format!("relay: unknown kind {}", header.kind))?;

    // incremental check against the FINAL path (the staged copy replaces it)
    let final_file = target_folder_path(endpoint, &header.kind, target_model).join(&header.path);
    let skip = std::fs::metadata(&final_file)
        .map(|meta| {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos() as i64)
                .unwrap_or(0);
            should_skip_file(meta.len(), mtime, &header, incremental)
        })
        .unwrap_or(false);

    let mut reply = serde_json::to_vec(&FileReply { skip }).map_err(|error| error.to_string())?;
    reply.push(b'\n');
    writer.write_all(&reply).map_err(|error| format!("relay reply write failed: {error}"))?;
    writer.flush().map_err(|error| error.to_string())?;
    // the write half is dropped by the caller when the function returns

    if skip {
        // move the identical file into staging so the final swap keeps it -
        // the swap replaces the whole folder, and without this move every
        // skipped file would be wiped from the target (same volume, instant)
        let staged = stage_dir.join(&header.path);
        if let Some(parent) = staged.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
        }
        std::fs::rename(&final_file, &staged).map_err(|error| format!("Cannot keep {} across the swap: {error}", final_file.display()))?;
        let mut stats = stats.lock().unwrap();
        let entry = stats.entry(header.kind.clone()).or_default();
        entry.0 += 1;
        return Ok(());
    }

    let dst = stage_dir.join(&header.path);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    }
    let mut file = std::fs::File::create(&dst).map_err(|error| format!("Cannot create {}: {error}", dst.display()))?;
    let mut total: u64 = 0;
    loop {
        let mut len_buf = [0u8; 4];
        reader.read_exact(&mut len_buf).map_err(|error| format!("relay chunk length read failed: {error}"))?;
        let len = u32::from_le_bytes(len_buf);
        if len == 0 {
            break;
        }
        let mut buf = vec![0u8; len as usize];
        reader.read_exact(&mut buf).map_err(|error| format!("relay chunk read failed: {error}"))?;
        let data: Vec<u8> = if header.compressed {
            zstd::bulk::decompress(&buf, CHUNK_SIZE).map_err(|error| format!("zstd decompress failed for {}: {error}", header.path))?
        } else {
            buf
        };
        file.write_all(&data).map_err(|error| format!("Cannot write {}: {error}", dst.display()))?;
        total += data.len() as u64;
    }
    if total != header.size {
        return Err(format!("relay size mismatch for {}: got {total}, expected {}", header.path, header.size));
    }
    let times = filetime::FileTime::from_unix_time(header.mtime_nanos.div_euclid(1_000_000_000), header.mtime_nanos.rem_euclid(1_000_000_000) as u32);
    filetime::set_file_times(&dst, times, times).map_err(|error| format!("Cannot set mtime on {}: {error}", dst.display()))?;

    let mut stats = stats.lock().unwrap();
    let entry = stats.entry(header.kind.clone()).or_default();
    entry.0 += 1;
    entry.1 += total;
    Ok(())
}

// ---------- TCP-proxy data plane (fallback when UDP/QUIC is blocked) ----------

pub const TCP_RELAY_STREAM_MARKER: u8 = 0;

/// Server side of the TCP fallback: runs on the target agent after the
/// control connection has authenticated and received the TcpRelayPush op.
///
/// Stream routing: the target opens an ephemeral local listener and sends its
/// port to the source agent on the control connection; the source dials one
/// connection per file stream to that port. This keeps the agent's main
/// listener untouched (no marker protocol sniffing there).
pub async fn handle_tcp_relay_push(
    control: tokio::net::TcpStream,
    manifest: RelayManifest,
    streams: u64,
    token: String,
) -> Result<(), String> {
    let (_reader, writer) = tokio::io::split(control);
    // the read side stays open until the transfer finishes - closing it early
    // would tear down the connection the result still has to travel on
    handle_tcp_relay_push_halves(_reader, writer, manifest, streams, token).await
}

/// Split-halves variant: the control connection's read and write sides come in
/// separately. The read side is kept (not read from) purely to hold the
/// connection open; the manifest arrives inside the TcpRelayPush op - the
/// control connection only carries the port line and the final result.
#[allow(clippy::too_many_arguments)]
pub async fn handle_tcp_relay_push_halves(
    _reader: impl tokio::io::AsyncRead + Unpin,
    mut writer: impl tokio::io::AsyncWrite + Unpin,
    manifest: RelayManifest,
    streams: u64,
    _token: String,
) -> Result<(), String> {
    // ephemeral listener for the file streams of THIS transfer; the sender
    // dials one marker-tagged connection per file stream
    let stream_listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|error| format!("tcp relay cannot open stream listener: {error}"))?;
    let stream_port = stream_listener.local_addr().map_err(|error| error.to_string())?.port();

    // reply with the handshake ok first, then the ephemeral port the sender
    // should dial for the file streams
    write_all(&mut writer, &json_reply(&RelayHandshakeReply { ok: true, error: None })).await?;
    write_all(&mut writer, &format!("{stream_port}\n").into_bytes()).await?;
    crate::log(&format!("[relay-srv/tcp] push accepted, {streams} streams on port {stream_port}"));

    let result = match receive_model_tcp(&manifest, streams, &stream_listener).await {
        Ok(report) => RelayResult { report: Some(report), error: None },
        Err(error) => RelayResult { report: None, error: Some(error) },
    };
    write_all(&mut writer, &json_reply(&result)).await?;
    // hold the connection briefly so the sender reliably reads the result
    tokio::time::sleep(Duration::from_millis(200)).await;
    Ok(())
}

async fn write_all(writer: &mut (impl tokio::io::AsyncWrite + Unpin), data: &[u8]) -> Result<(), String> {
    AsyncWriteExt::write_all(writer, data).await.map_err(|error| format!("tcp relay write failed: {error}"))
}

fn json_reply(value: &impl serde::Serialize) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(value).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}

/// The receiving half of the TCP data plane: same staging / skipping / swap as
/// the QUIC path, but file streams arrive on the ephemeral listener.
async fn receive_model_tcp(manifest: &RelayManifest, stream_count: u64, stream_listener: &tokio::net::TcpListener) -> Result<CopyReport, String> {
    let endpoint = manifest.target.clone();
    {
        let inventory = endpoint.inventory_path.clone();
        let repository = endpoint.repository_path.clone();
        let username = endpoint.username.clone();
        let password = endpoint.password.clone();
        tokio::task::spawn_blocking(move || ensure_unc_credentials(&[&inventory, &repository], &username, &password))
            .await
            .map_err(|error| error.to_string())??;
    }

    let conn_id = format!(
        "{:x}",
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() ^ std::process::id() as u128
    );
    let stages: Vec<Stage> = {
        let endpoint = endpoint.clone();
        let kinds = manifest.kinds.clone();
        let target_model = manifest.target_model.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<Stage>, String> {
            let mut stages = Vec::new();
            for kind in kinds {
                let base = kind_base(&endpoint, &kind)?;
                sweep_stale_staging(&base);
                let stage = base.join(staging_prefix().to_string() + &conn_id);
                std::fs::create_dir_all(&stage).map_err(|error| format!("Cannot create staging {}: {error}", stage.display()))?;
                let final_dir = target_folder_path(&endpoint, &kind, &target_model);
                stages.push(Stage { kind, stage, final_dir });
            }
            Ok(stages)
        })
        .await
        .map_err(|error| error.to_string())??
    };

    let stage_map: Arc<HashMap<String, PathBuf>> = Arc::new(stages.iter().map(|stage| (stage.kind.clone(), stage.stage.clone())).collect());
    let stats: Arc<ReceiveStats> = Arc::new(Mutex::new(HashMap::new()));
    let mut handles = Vec::new();
    let mut stream_error: Option<String> = None;
    for _ in 0..stream_count {
        let (stream, peer) = match stream_listener.accept().await {
            Ok(pair) => pair,
            Err(error) => {
                stream_error = Some(format!("tcp relay stream accept failed: {error}"));
                break;
            }
        };
        crate::log(&format!("[relay-srv/tcp] stream from {peer}"));
        let stage_map = stage_map.clone();
        let stats = stats.clone();
        let endpoint = endpoint.clone();
        let target_model = manifest.target_model.clone();
        let incremental = manifest.incremental;
        handles.push(tokio::task::spawn_blocking(move || {
            stream.set_nodelay(true).ok();
            // both directions on one connection: marker+content in, reply out
            let (reader_stream, writer_stream) = tokio::io::split(stream);
            let mut writer = SyncIoBridge::new(writer_stream);
            let mut reader = SyncIoBridge::new(reader_stream);
            // consume the marker byte (0 = file stream)
            let mut marker = [0u8; 1];
            reader.read_exact(&mut marker).map_err(|error| format!("tcp relay marker read failed: {error}"))?;
            if marker[0] != TCP_RELAY_STREAM_MARKER {
                return Err(format!("tcp relay: unexpected stream marker {}", marker[0]));
            }
            receive_file_stream_io(&mut reader, &mut writer, &stage_map, &endpoint, &target_model, incremental, &stats)
        }));
    }
    for handle in handles {
        if let Err(error) = handle.await.map_err(|error| format!("tcp relay file task panicked: {error}")).and_then(|inner| inner) {
            if stream_error.is_none() {
                stream_error = Some(error);
            }
        }
    }
    if let Some(error) = stream_error {
        remove_stages(&stages);
        return Err(error);
    }

    finalize(stages, &endpoint, manifest).await
}

/// Swap the staged folders into place with the same delete guards as a
/// single-site copy, then reconcile kinds the target has but the source didn't.
async fn finalize(stages: Vec<Stage>, endpoint: &CopyEndpoint, manifest: &RelayManifest) -> Result<CopyReport, String> {
    let endpoint = endpoint.clone();
    let target_model = manifest.target_model.clone();
    let source_model = manifest.source_model.clone();
    let manifest_kinds = manifest.kinds.clone();
    tokio::task::spawn_blocking(move || -> Result<CopyReport, String> {
        for stage in &stages {
            assert_deletable(&stage.final_dir, &endpoint, &stage.kind, &target_model)?;
        }
        // kinds present on the target under the new name but absent from the
        // manifest are deleted, exactly like the single-site plan does
        for (kind, dir) in endpoint_model_folders(&endpoint, &target_model).unwrap_or_default() {
            if !manifest_kinds.contains(&kind) {
                assert_deletable(&dir, &endpoint, &kind, &target_model)?;
                std::fs::remove_dir_all(&dir).map_err(|error| format!("Cannot delete {}: {error}", dir.display()))?;
            }
        }
        let mut entries = Vec::new();
        let mut remaining_stages: Vec<Stage> = stages;
        for stage in remaining_stages.clone() {
            if stage.final_dir.exists() {
                if let Err(error) = std::fs::remove_dir_all(&stage.final_dir) {
                    let message = format!("Cannot delete {}: {error}", stage.final_dir.display());
                    remove_stages(&remaining_stages);
                    return Err(message);
                }
            }
            // Windows rename needs the destination parent to exist (a fresh
            // PxInventory may not even have LIGHT_SPEC yet)
            if let Some(parent) = stage.final_dir.parent() {
                if let Err(error) = std::fs::create_dir_all(parent) {
                    let message = format!("Cannot create {}: {error}", parent.display());
                    remove_stages(&remaining_stages);
                    return Err(message);
                }
            }
            if let Err(error) = std::fs::rename(&stage.stage, &stage.final_dir) {
                let message = format!("Cannot move staged {} into place: {error}", stage.final_dir.display());
                remove_stages(&remaining_stages);
                return Err(message);
            }
            remaining_stages.retain(|left| left.stage != stage.stage);
            entries.push(CopyResultEntry { kind: stage.kind.clone(), target: stage.final_dir.display().to_string(), ok: true, error: None });
        }
        Ok(CopyReport { model_name: source_model, entries })
    })
    .await
    .map_err(|error| error.to_string())?
}

// ---------- sending side ----------

/// One file to transfer, enumerated on the source site (blocking, LAN-speed).
#[derive(Clone)]
pub struct RelayFile {
    pub kind: String,
    /// relative to the model folder, '/' separators
    pub path: String,
    pub source: PathBuf,
    pub size: u64,
    pub mtime_nanos: i64,
}

/// Enumerate the model's files on the source endpoint (call in spawn_blocking).
pub fn enumerate_source_files(source: &CopyEndpoint, source_model: &str) -> Result<(Vec<RelayFile>, Vec<String>), String> {
    ensure_unc_credentials(&[&source.inventory_path, &source.repository_path], &source.username, &source.password)?;
    let folders = endpoint_model_folders(source, source_model)?;
    if folders.is_empty() {
        return Err(format!("Model {source_model} was not found on {} ({}) - nothing to send.", source.host, source.inventory_path));
    }
    let mut files = Vec::new();
    for (kind, dir) in &folders {
        walk_model_files(kind, dir, dir, &mut files)?;
    }
    let kinds = folders.into_iter().map(|(kind, _)| kind).collect();
    Ok((files, kinds))
}

fn walk_model_files(kind: &str, root: &Path, dir: &Path, files: &mut Vec<RelayFile>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|error| format!("Cannot read {}: {error}", dir.display()))? {
        let entry = entry.map_err(|error| format!("Cannot read {}: {error}", dir.display()))?;
        let path = entry.path();
        if path.is_dir() {
            walk_model_files(kind, root, &path, files)?;
        } else {
            let meta = entry.metadata().map_err(|error| format!("Cannot stat {}: {error}", path.display()))?;
            let relative = path.strip_prefix(root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/");
            let mtime_nanos = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos() as i64)
                .unwrap_or(0);
            files.push(RelayFile { kind: kind.to_string(), path: relative, source: path, size: meta.len(), mtime_nanos });
        }
    }
    Ok(())
}

/// Push the model to the target site's agent over QUIC; per-file progress is
/// reported through `progress` (relayed to the desktop via the TCP channel).
pub async fn send_model(
    target_addr: &str,
    target_token: &str,
    manifest: RelayManifest,
    files: Vec<RelayFile>,
    relay_mode: &str,
    progress: Arc<dyn Fn(CopyProgress) + Send + Sync>,
) -> Result<CopyReport, String> {
    let files_total = files.len();
    let endpoint = client_endpoint()?;
    let addr = resolve_relay_addr(target_addr)?;
    let conn = endpoint
        .connect(addr, "dmt-relay")
        .map_err(|error| format!("relay connect: {error}"))?
        .await
        .map_err(|error| format!("Cannot establish the QUIC relay to {addr}: {error}"))?;
    crate::log(&format!("[relay-cli/quic] connected to {addr}"));

    let (mut ctl_send, mut ctl_recv) = conn.open_bi().await.map_err(|error| format!("relay control stream: {error}"))?;
    write_json_line(&mut ctl_send, &RelayHandshake { auth: target_token.to_string(), manifest }).await?;
    let reply: RelayHandshakeReply = read_json_line(&mut ctl_recv).await?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "relay: the target agent refused the transfer".into()));
    }
    // announce the stream count up front so the receiver can start accepting
    // file streams immediately (workers block on per-stream FileReplies - a
    // done-marker after the fact would deadlock both sides)
    write_json_line(&mut ctl_send, &FilesDone { done: true, streams: files_total as u64 }).await?;

    let _ = pump_files_quic(&conn, files, files_total, relay_mode, progress).await?;

    let result: RelayResult = read_json_line(&mut ctl_recv).await?;
    // tell the server we are done so it can release the connection
    conn.close(0u32.into(), b"done");
    match result {
        RelayResult { report: Some(report), .. } => Ok(report),
        RelayResult { error: Some(error), .. } => Err(error),
        _ => Err("relay: the target agent sent no report".into()),
    }
}

/// Shared file-pump logic for the QUIC data plane: workers pull files and open
/// a QUIC stream per file on the shared connection.
async fn pump_files_quic(
    conn: &Connection,
    files: Vec<RelayFile>,
    files_total: usize,
    relay_mode: &str,
    progress: Arc<dyn Fn(CopyProgress) + Send + Sync>,
) -> Result<(), String> {
    let next = Arc::new(AtomicUsize::new(0));
    let files_done = Arc::new(AtomicUsize::new(0));
    let bytes_done = Arc::new(AtomicU64::new(0));
    let files = Arc::new(files);
    let relay_mode = relay_mode.to_string();
    let last_report_ms = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let mut workers: Vec<tokio::task::JoinHandle<Result<(), String>>> = Vec::new();
    for _ in 0..RELAY_STREAMS.min(files_total.max(1)) {
        let conn = conn.clone();
        let files = files.clone();
        let next = next.clone();
        let files_done = files_done.clone();
        let bytes_done = bytes_done.clone();
        let progress = progress.clone();
        let relay_mode = relay_mode.clone();
        let last_report_ms = last_report_ms.clone();
        workers.push(tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= files.len() {
                    return Ok(());
                }
                let file = &files[index];
                let (send, recv) = handle.block_on(conn.open_bi()).map_err(|error| format!("relay open stream: {error}"))?;
                let (skipped, bytes) = send_one_file(send, recv, file, &files_done, files_total, &bytes_done, &relay_mode, &last_report_ms, start, &progress)?;
                bytes_done.fetch_add(bytes, Ordering::Relaxed);
                let done = files_done.fetch_add(1, Ordering::Relaxed) + 1;
                progress(CopyProgress {
                    kind: file.kind.clone(),
                    file: file.source.display().to_string(),
                    files_done: done as u32,
                    files_total: files_total as u32,
                    bytes_done: bytes_done.load(Ordering::Relaxed),
                    relay_mode: relay_mode.clone(),
                });
                let _ = skipped;
            }
        }));
    }
    for worker in workers {
        worker.await.map_err(|error| format!("relay worker panicked: {error}"))??;
    }
    Ok(())
}

/// TCP-proxy variant of `send_model`: dials the target agent's TCP control
/// port and tunnels the SAME wire protocol (handshake / FilesDone / per-file
/// streams with one connection per stream / final result). Succeeds whenever
/// plain TCP reaches the target agent even if UDP/QUIC is blocked.
pub async fn send_model_tcp(
    target_addr: &str,
    target_token: &str,
    manifest: RelayManifest,
    files: Vec<RelayFile>,
    progress: Arc<dyn Fn(CopyProgress) + Send + Sync>,
) -> Result<CopyReport, String> {
    let files_total = files.len();
    let addr = resolve_relay_addr(target_addr)?;
    let handshake_stream = tokio::net::TcpStream::connect(addr)
        .await
        .map_err(|error| format!("Cannot reach the target agent over TCP {addr}: {error}"))?;
    crate::log(&format!("[relay-cli/tcp] connected to {addr}"));
    handshake_stream.set_nodelay(true).ok();
    let (mut hs_reader, mut hs_writer) = handshake_stream.into_split();

    // authenticate as a normal control client, then ask for the push op
    let auth = serde_json::to_vec(&dmt_copy_core::protocol::AgentAuth { auth: target_token.to_string() }).map_err(|error| error.to_string())?;
    let mut frame = auth;
    frame.push(b'\n');
    hs_writer.write_all(&frame).await.map_err(|error| format!("tcp relay auth write failed: {error}"))?;
    let mut auth_reply = String::new();
    tokio::io::BufReader::new(&mut hs_reader).read_line(&mut auth_reply).await.map_err(|error| format!("tcp relay auth read failed: {error}"))?;
    let reply: AuthReply = serde_json::from_str(auth_reply.trim()).map_err(|error| format!("tcp relay malformed auth reply: {error}"))?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "tcp relay: authentication failed".into()));
    }

    let request = serde_json::to_vec(&dmt_copy_core::protocol::AgentRequest::TcpRelayPush { manifest, streams: files_total as u64 })
        .map_err(|error| error.to_string())?;
    let mut frame = request;
    frame.push(b'\n');
    hs_writer.write_all(&frame).await.map_err(|error| format!("tcp relay request write failed: {error}"))?;
    drop(hs_writer); // the control connection is read-only for the sender from here

    // the target agent answers: RelayHandshakeReply, then the ephemeral port
    // its per-stream listener bound, then (after the transfer) the RelayResult
    let mut hs_reader = tokio::io::BufReader::new(hs_reader);
    let mut handshake_line = String::new();
    hs_reader.read_line(&mut handshake_line).await.map_err(|error| format!("tcp relay handshake read failed: {error}"))?;
    let reply: RelayHandshakeReply = serde_json::from_str(handshake_line.trim()).map_err(|error| format!("tcp relay malformed handshake: {error}"))?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "relay: the target agent refused the transfer".into()));
    }
    let mut port_line = String::new();
    hs_reader.read_line(&mut port_line).await.map_err(|error| format!("tcp relay port read failed: {error}"))?;
    let stream_port: u16 = port_line.trim().parse().map_err(|error| format!("tcp relay malformed port: {error}"))?;
    let stream_addr = SocketAddr::new(addr.ip(), stream_port);
    crate::log(&format!("[relay-cli/tcp] streams on {stream_addr}"));

    // pump the files; each worker owns one extra marker-tagged TCP connection
    pump_files_tcp(stream_addr, files, files_total, progress).await?;

    let mut result_line = String::new();
    hs_reader.read_line(&mut result_line).await.map_err(|error| format!("tcp relay result read failed: {error}"))?;
    let result: RelayResult = serde_json::from_str(result_line.trim()).map_err(|error| format!("tcp relay malformed result: {error}"))?;
    match result {
        RelayResult { report: Some(report), .. } => Ok(report),
        RelayResult { error: Some(error), .. } => Err(error),
        _ => Err("relay: the target agent sent no report".into()),
    }
}

/// Shared file-pump for the TCP data plane: same skip/chunk protocol, but each
/// file stream is one dedicated marker-tagged TcpStream to the target's
/// ephemeral listener. The handshake stream stays on the caller's side for the
/// final RelayResult.
pub async fn pump_files_tcp(
    stream_addr: SocketAddr,
    files: Vec<RelayFile>,
    files_total: usize,
    progress: Arc<dyn Fn(CopyProgress) + Send + Sync>,
) -> Result<(), String> {
    let next = Arc::new(AtomicUsize::new(0));
    let files_done = Arc::new(AtomicUsize::new(0));
    let bytes_done = Arc::new(AtomicU64::new(0));
    let files = Arc::new(files);
    let last_report_ms = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let mut workers: Vec<tokio::task::JoinHandle<Result<(), String>>> = Vec::new();
    for _ in 0..RELAY_STREAMS.min(files_total.max(1)) {
        let files = files.clone();
        let next = next.clone();
        let files_done = files_done.clone();
        let bytes_done = bytes_done.clone();
        let progress = progress.clone();
        let last_report_ms = last_report_ms.clone();
        workers.push(tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= files.len() {
                    return Ok(());
                }
                let file = &files[index];
                let stream = handle.block_on(open_tcp_relay_stream(stream_addr))?;
                let (skipped, bytes) = send_one_file_tcp(stream, file, &files_done, files_total, &bytes_done, &last_report_ms, start, &progress)?;
                bytes_done.fetch_add(bytes, Ordering::Relaxed);
                let done = files_done.fetch_add(1, Ordering::Relaxed) + 1;
                progress(CopyProgress {
                    kind: file.kind.clone(),
                    file: file.source.display().to_string(),
                    files_done: done as u32,
                    files_total: files_total as u32,
                    bytes_done: bytes_done.load(Ordering::Relaxed),
                    relay_mode: "tcp".into(),
                });
                let _ = skipped;
            }
        }));
    }
    for worker in workers {
        worker.await.map_err(|error| format!("relay worker panicked: {error}"))??;
    }
    Ok(())
}

/// Open one extra TCP connection marked as a relay file stream: the target
/// agent reads the marker byte and then serves the same per-file protocol on
/// it as on a QUIC bidirectional stream.
async fn open_tcp_relay_stream(stream_addr: SocketAddr) -> Result<tokio::net::TcpStream, String> {
    let stream = tokio::net::TcpStream::connect(stream_addr)
        .await
        .map_err(|error| format!("tcp relay stream dial failed: {error}"))?;
    stream.set_nodelay(true).ok();
    Ok(stream)
}

/// The per-file protocol over a plain TcpStream. The receiver distinguishes
/// stream kinds by a one-byte marker: 0 = file stream.
#[allow(clippy::too_many_arguments)]
fn send_one_file_tcp(
    stream: tokio::net::TcpStream,
    file: &RelayFile,
    files_done: &AtomicUsize,
    files_total: usize,
    bytes_done: &AtomicU64,
    last_report_ms: &AtomicU64,
    start: Instant,
    progress: &Arc<dyn Fn(CopyProgress) + Send + Sync>,
) -> Result<(bool, u64), String> {
    // the stream is both directions: marker+header+content out, FileReply in
    let (reader_stream, writer_stream) = tokio::io::split(stream);
    let mut writer = SyncIoBridge::new(writer_stream);
    let mut reader = SyncIoBridge::new(reader_stream);
    std::io::Write::write_all(&mut writer, &[TCP_RELAY_STREAM_MARKER]).map_err(|error| format!("tcp relay marker write failed: {error}"))?;
    let header = FileHeader {
        kind: file.kind.clone(),
        path: file.path.clone(),
        size: file.size,
        mtime_nanos: file.mtime_nanos,
        compressed: file.size >= COMPRESSION_THRESHOLD as u64,
    };

    let mut header_line = serde_json::to_vec(&header).map_err(|error| error.to_string())?;
    header_line.push(b'\n');
    writer.write_all(&header_line).map_err(|error| format!("relay header write failed: {error}"))?;
    writer.flush().map_err(|error| error.to_string())?;

    let reply: FileReply = sync_read_json_line(&mut reader)?;
    if reply.skip {
        drop(writer);
        drop(reader);
        return Ok((true, 0));
    }

    let mut source = std::fs::File::open(&file.source).map_err(|error| format!("Cannot read {}: {error}", file.source.display()))?;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut file_bytes: u64 = 0;
    loop {
        let n = source.read(&mut buf).map_err(|error| format!("Cannot read {}: {error}", file.source.display()))?;
        if n == 0 {
            break;
        }
        let payload: Vec<u8> = if header.compressed {
            zstd::bulk::compress(&buf[..n], 3).map_err(|error| format!("zstd compress failed for {}: {error}", file.path))?
        } else {
            buf[..n].to_vec()
        };
        writer.write_all(&(payload.len() as u32).to_le_bytes()).map_err(|error| format!("relay chunk write failed: {error}"))?;
        writer.write_all(&payload).map_err(|error| format!("relay chunk write failed: {error}"))?;
        file_bytes += n as u64;
        emit_intra_progress(file_bytes, bytes_done, files_done, files_total, "tcp", last_report_ms, start, progress);
    }
    writer.write_all(&0u32.to_le_bytes()).map_err(|error| format!("relay terminator write failed: {error}"))?;
    writer.flush().map_err(|error| error.to_string())?;
    drop(writer);
    drop(reader);
    Ok((false, file.size))
}

/// Throttled intra-file heartbeat (~500ms): a single multi-gigabyte inspection
/// image can take tens of minutes over the WAN, and without this traffic the
/// desktop's control-socket read timeout would fire mid-file and force the
/// copy down the fallback chain. The byte counter already includes the bytes
/// other workers finished, so the reported total keeps climbing smoothly.
fn emit_intra_progress(
    file_bytes: u64,
    bytes_done: &AtomicU64,
    files_done: &AtomicUsize,
    files_total: usize,
    relay_mode: &str,
    last_report_ms: &AtomicU64,
    start: Instant,
    progress: &Arc<dyn Fn(CopyProgress) + Send + Sync>,
) {
    const REPORT_EVERY_MS: u64 = 500;
    let now_ms = start.elapsed().as_millis() as u64;
    let last = last_report_ms.load(Ordering::Relaxed);
    if now_ms.saturating_sub(last) >= REPORT_EVERY_MS
        && last_report_ms
            .compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    {
        progress(CopyProgress {
            kind: String::new(),
            file: String::new(),
            files_done: files_done.load(Ordering::Relaxed) as u32,
            files_total: files_total as u32,
            bytes_done: bytes_done.load(Ordering::Relaxed) + file_bytes,
            relay_mode: relay_mode.to_string(),
        });
    }
}

fn send_one_file(
    send: SendStream,
    recv: RecvStream,
    file: &RelayFile,
    files_done: &AtomicUsize,
    files_total: usize,
    bytes_done: &AtomicU64,
    relay_mode: &str,
    last_report_ms: &AtomicU64,
    start: Instant,
    progress: &Arc<dyn Fn(CopyProgress) + Send + Sync>,
) -> Result<(bool, u64), String> {
    let header = FileHeader {
        kind: file.kind.clone(),
        path: file.path.clone(),
        size: file.size,
        mtime_nanos: file.mtime_nanos,
        compressed: file.size >= COMPRESSION_THRESHOLD as u64,
    };
    let mut writer = SyncIoBridge::new(send);
    let mut reader = SyncIoBridge::new(recv);

    let mut header_line = serde_json::to_vec(&header).map_err(|error| error.to_string())?;
    header_line.push(b'\n');
    writer.write_all(&header_line).map_err(|error| format!("relay header write failed: {error}"))?;
    writer.flush().map_err(|error| error.to_string())?;

    let reply: FileReply = sync_read_json_line(&mut reader)?;
    if reply.skip {
        drop(writer);
        drop(reader);
        return Ok((true, 0));
    }

    let mut source = std::fs::File::open(&file.source).map_err(|error| format!("Cannot read {}: {error}", file.source.display()))?;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut file_bytes: u64 = 0;
    loop {
        let n = source.read(&mut buf).map_err(|error| format!("Cannot read {}: {error}", file.source.display()))?;
        if n == 0 {
            break;
        }
        let payload: Vec<u8> = if header.compressed {
            zstd::bulk::compress(&buf[..n], 3).map_err(|error| format!("zstd compress failed for {}: {error}", file.path))?
        } else {
            buf[..n].to_vec()
        };
        writer.write_all(&(payload.len() as u32).to_le_bytes()).map_err(|error| format!("relay chunk write failed: {error}"))?;
        writer.write_all(&payload).map_err(|error| format!("relay chunk write failed: {error}"))?;
        file_bytes += n as u64;
        emit_intra_progress(file_bytes, bytes_done, files_done, files_total, relay_mode, last_report_ms, start, progress);
    }
    writer.write_all(&0u32.to_le_bytes()).map_err(|error| format!("relay terminator write failed: {error}"))?;
    writer.flush().map_err(|error| error.to_string())?;
    let mut send = writer.into_inner();
    let _ = send.finish();
    drop(reader);
    Ok((false, file.size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_transfer_staging_is_removed_immediately() {
        let base = std::env::temp_dir().join(format!("dmt_stage_cleanup_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let stages: Vec<Stage> = ["a", "b"]
            .iter()
            .map(|name| {
                let stage = base.join(format!("{}{}_{}", staging_prefix(), name, std::process::id()));
                std::fs::create_dir_all(stage.join("sub")).unwrap();
                std::fs::write(stage.join("sub").join("f.bin"), vec![0u8; 16]).unwrap();
                Stage { kind: "PxRepository".into(), stage: stage.clone(), final_dir: base.join("final") }
            })
            .collect();
        remove_stages(&stages);
        for stage in &stages {
            assert!(!stage.stage.exists(), "{} must be gone", stage.stage.display());
        }
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn stale_staging_is_swept_but_fresh_is_kept() {
        let base = std::env::temp_dir().join(format!("dmt_stage_sweep_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let old_dir = base.join(format!("{}old_{}", staging_prefix(), std::process::id()));
        std::fs::create_dir_all(&old_dir).unwrap();
        // backdate the directory 3 hours: older than the 2h sweep threshold
        let old_time = filetime::FileTime::from_unix_time(
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 - 3 * 3600,
            0,
        );
        filetime::set_file_times(&old_dir, old_time, old_time).unwrap();

        let fresh_dir = base.join(format!("{}fresh_{}", staging_prefix(), std::process::id()));
        std::fs::create_dir_all(&fresh_dir).unwrap();
        let other_dir = base.join("not_staging");
        std::fs::create_dir_all(&other_dir).unwrap();

        sweep_stale_staging(&base);
        assert!(!old_dir.exists(), "stale staging must be swept");
        assert!(fresh_dir.exists(), "fresh staging must be kept");
        assert!(other_dir.exists(), "non-staging folders must never be touched");
        std::fs::remove_dir_all(&base).ok();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn quinn_loopback_smoke() {
        let dir = std::env::temp_dir().join(format!("quinn_smoke_cfg_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let server = server_endpoint(0, &dir).unwrap();
        let addr = SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), server.local_addr().unwrap().port());
        tokio::spawn(async move {
            let incoming = server.accept().await.unwrap();
            let conn = incoming.await.unwrap();
            eprintln!("[smoke] server: connection from {}", conn.remote_address());
            let (mut send, mut recv) = conn.accept_bi().await.unwrap();
            let mut byte = [0u8; 1];
            let n = recv.read(&mut byte).await.unwrap();
            eprintln!("[smoke] server: read {:?} {:?}", n, byte);
            send.write_all(b"Y").await.unwrap();
            eprintln!("[smoke] server: reply written");
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            eprintln!("[smoke] server: task ending");
        });

        let ep = client_endpoint().unwrap();
        let conn = ep.connect(addr, "dmt-relay").unwrap().await.unwrap();
        eprintln!("[smoke] client: connected");
        let (mut send, mut recv) = conn.open_bi().await.unwrap();
        send.write_all(b"hello").await.unwrap();
        eprintln!("[smoke] client: wrote hello");
        let mut buf = [0u8; 1];
        let n = recv.read(&mut buf).await.unwrap();
        eprintln!("[smoke] client: read {:?} {:?}", n, buf);
        assert_eq!(buf[0], b'Y');
    }
}

//! Minimal std-only HTTP/1.1 client for the fts daemon's localhost REST API
//! (Plan/FTS_API.md §7: `/v1/capabilities`, `/v1/inbox`, `/v1/transfers` with
//! SSE event streams). The agent controls its local fts daemon through this
//! client; hand-rolled HTTP keeps dmt-copy-core dependency-free, and the SSE
//! NDJSON events map 1:1 onto the agent's progress channel. Unknown event
//! types and unparseable events are skipped, per the fts forward-compatibility
//! promise.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

// ---------- error-code contract (API.md §10) ----------

pub const FTS_ERROR_OK: i32 = 0;
pub const FTS_ERROR_IO: i32 = 1;
pub const FTS_ERROR_INVALID_ARG: i32 = 2;
pub const FTS_ERROR_CONNECT_FAILED: i32 = 3;
/// `INCOMPATIBLE_VERSION` shares code 3 with `CONNECT_FAILED`.
pub const FTS_ERROR_INCOMPATIBLE_VERSION: i32 = 3;
pub const FTS_ERROR_CHECKSUM_FAILED: i32 = 4;
pub const FTS_ERROR_INTERRUPTED: i32 = 5;
pub const FTS_ERROR_CANCELLED: i32 = 6;
pub const FTS_ERROR_AUTH_FAILED: i32 = 7;

pub fn fts_error_name(code: i32) -> &'static str {
    match code {
        FTS_ERROR_OK => "OK",
        FTS_ERROR_IO => "IO_ERROR",
        FTS_ERROR_INVALID_ARG => "INVALID_ARG",
        FTS_ERROR_CONNECT_FAILED => "CONNECT_FAILED/INCOMPATIBLE_VERSION",
        FTS_ERROR_CHECKSUM_FAILED => "CHECKSUM_FAILED",
        FTS_ERROR_INTERRUPTED => "INTERRUPTED",
        FTS_ERROR_CANCELLED => "CANCELLED",
        FTS_ERROR_AUTH_FAILED => "AUTH_FAILED",
        _ => "UNKNOWN",
    }
}

// ---------- wire types ----------

#[derive(Deserialize, Clone, Debug)]
pub struct Capabilities {
    #[serde(default)]
    pub protocol_version: String,
    #[serde(default)]
    pub fts_version: String,
    #[serde(default)]
    pub capabilities: u32,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TransferStatus {
    #[serde(default)]
    pub task_id: String,
    pub state: String,
    #[serde(default)]
    pub checksum_ok: bool,
    #[serde(default)]
    pub error_code: i32,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub error_message: String,
}

/// The event stream (API.md §4). Fields the doc marks nullable are Options so
/// a `null` does not invalidate the whole event; unknown types land in
/// `Unknown` and unknown fields are ignored.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FtsEvent {
    Task {
        #[serde(default)]
        task_id: String,
        #[serde(default)]
        state: String,
    },
    Progress {
        bytes_done: u64,
        bytes_total: u64,
        #[serde(default)]
        throughput_bps: Option<f64>,
        #[serde(default)]
        eta_seconds: Option<f64>,
    },
    File {
        name: String,
        index: u64,
        total: u64,
    },
    FileDone {
        name: String,
        #[serde(default)]
        checksum_ok: bool,
        #[serde(default)]
        seconds: f64,
        #[serde(default)]
        bytes: u64,
    },
    Degradation {
        from: String,
        to: String,
        #[serde(default)]
        reason: String,
    },
    Result {
        state: String,
        #[serde(default)]
        checksum_ok: bool,
        #[serde(default)]
        duration_seconds: f64,
        #[serde(default)]
        error_code: i32,
        #[serde(default)]
        error: String,
    },
    Error {
        #[serde(default)]
        message: String,
    },
    /// Any event type this client does not know yet - must be ignored.
    #[serde(other)]
    Unknown,
}

impl FtsEvent {
    pub fn is_result(&self) -> bool {
        matches!(self, FtsEvent::Result { .. })
    }
}

/// SMB credentials for an inbox on an authenticated UNC share; the fts daemon
/// establishes the Windows session itself (API.md §5.3). The password never
/// appears in logs or errors.
#[derive(Serialize, Clone, Debug, Default)]
pub struct UncCredential {
    pub user_name: String,
    pub password: String,
}

// ---------- HTTP plumbing ----------

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const IO_TIMEOUT: Duration = Duration::from_secs(10);
/// SSE streams stay quiet only when the transfer itself is stuck; fts emits
/// progress roughly every second while running.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_LINE_BYTES: usize = 1024 * 1024;

enum BodyMode {
    Length,
    Chunked,
    Eof,
}

struct HttpBody {
    stream: TcpStream,
    raw: Vec<u8>,
    pos: usize,
    mode: BodyMode,
    content_remaining: u64,
    chunk_remaining: u64,
    expect_chunk_crlf: bool,
    done: bool,
}

struct Response {
    status: u16,
    body: HttpBody,
}

impl HttpBody {
    /// Pull more (still encoded) bytes from the socket. Ok(false) = EOF.
    fn raw_fill(&mut self) -> Result<bool, String> {
        if self.pos > 0 {
            self.raw.drain(..self.pos);
            self.pos = 0;
        }
        let mut tmp = [0u8; 8192];
        let n = self.stream.read(&mut tmp).map_err(|error| format!("fts response read failed: {error}"))?;
        if n == 0 {
            return Ok(false);
        }
        self.raw.extend_from_slice(&tmp[..n]);
        Ok(true)
    }

    fn raw_byte(&mut self) -> Result<Option<u8>, String> {
        loop {
            if self.pos < self.raw.len() {
                let byte = self.raw[self.pos];
                self.pos += 1;
                return Ok(Some(byte));
            }
            if !self.raw_fill()? {
                return Ok(None);
            }
        }
    }

    /// One raw line (header or chunk size), CRLF stripped.
    fn raw_line(&mut self) -> Result<Option<String>, String> {
        let mut line = Vec::new();
        loop {
            match self.raw_byte()? {
                None => {
                    return if line.is_empty() {
                        Ok(None)
                    } else {
                        Ok(Some(String::from_utf8_lossy(&line).to_string()))
                    };
                }
                Some(b'\n') => break,
                Some(byte) => {
                    line.push(byte);
                    if line.len() > MAX_LINE_BYTES {
                        return Err("fts response line oversized".into());
                    }
                }
            }
        }
        let mut text = String::from_utf8_lossy(&line).to_string();
        if text.ends_with('\r') {
            text.pop();
        }
        Ok(Some(text))
    }

    /// Next DECODED body byte (chunked framing removed).
    fn next_byte(&mut self) -> Result<Option<u8>, String> {
        if self.done {
            return Ok(None);
        }
        match self.mode {
            BodyMode::Eof => self.raw_byte(),
            BodyMode::Length => match self.raw_byte()? {
                Some(byte) => {
                    self.content_remaining = self.content_remaining.saturating_sub(1);
                    if self.content_remaining == 0 {
                        self.done = true;
                    }
                    Ok(Some(byte))
                }
                None => {
                    self.done = true;
                    Ok(None)
                }
            },
            BodyMode::Chunked => {
                if self.chunk_remaining == 0 {
                    if self.expect_chunk_crlf {
                        let _ = self.raw_line()?;
                        self.expect_chunk_crlf = false;
                    }
                    let line = self.raw_line()?.ok_or_else(|| "fts response truncated in chunk header".to_string())?;
                    let size = line.split(';').next().unwrap_or("").trim();
                    let chunk = u64::from_str_radix(size, 16).map_err(|_| format!("fts response has a bad chunk size \"{line}\""))?;
                    if chunk == 0 {
                        // trailers up to the empty line, then the body is done
                        while let Some(line) = self.raw_line()? {
                            if line.is_empty() {
                                break;
                            }
                        }
                        self.done = true;
                        return Ok(None);
                    }
                    self.chunk_remaining = chunk;
                    self.expect_chunk_crlf = true;
                }
                match self.raw_byte()? {
                    Some(byte) => {
                        self.chunk_remaining -= 1;
                        Ok(Some(byte))
                    }
                    None => {
                        self.done = true;
                        Ok(None)
                    }
                }
            }
        }
    }

    /// One decoded body line, CRLF stripped.
    fn body_line(&mut self) -> Result<Option<String>, String> {
        let mut line = Vec::new();
        loop {
            match self.next_byte()? {
                None => {
                    return if line.is_empty() {
                        Ok(None)
                    } else {
                        Ok(Some(String::from_utf8_lossy(&line).to_string()))
                    };
                }
                Some(b'\n') => {
                    let mut text = String::from_utf8_lossy(&line).to_string();
                    if text.ends_with('\r') {
                        text.pop();
                    }
                    return Ok(Some(text));
                }
                Some(byte) => {
                    line.push(byte);
                    if line.len() > MAX_LINE_BYTES {
                        return Err("fts response body line oversized".into());
                    }
                }
            }
        }
    }

    fn read_to_end(&mut self) -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        while let Some(byte) = self.next_byte()? {
            out.push(byte);
        }
        Ok(out)
    }
}

fn read_response(stream: TcpStream) -> Result<Response, String> {
    let mut stream = stream;
    let mut raw: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 8192];
    let header_end = loop {
        if let Some(index) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
        let n = stream.read(&mut tmp).map_err(|error| format!("fts response read failed: {error}"))?;
        if n == 0 {
            return Err("fts closed the connection before sending a response".into());
        }
        raw.extend_from_slice(&tmp[..n]);
        if raw.len() > MAX_LINE_BYTES {
            return Err("fts response headers oversized".into());
        }
    };
    let headers = String::from_utf8_lossy(&raw[..header_end]).to_string();
    let mut lines = headers.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| format!("fts sent a bad status line \"{status_line}\""))?;
    let mut mode = BodyMode::Eof;
    let mut content_remaining = 0u64;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
            mode = BodyMode::Chunked;
        }
        if name == "content-length" {
            if let Ok(length) = value.parse::<u64>() {
                content_remaining = length;
                mode = BodyMode::Length;
            }
        }
    }
    Ok(Response { status, body: HttpBody { stream, raw, pos: header_end, mode, content_remaining, chunk_remaining: 0, expect_chunk_crlf: false, done: false } })
}

// ---------- the client ----------

#[derive(Clone, Debug)]
pub struct FtsClient {
    rest_addr: String,
}

impl FtsClient {
    pub fn new(rest_addr: &str) -> FtsClient {
        FtsClient { rest_addr: rest_addr.trim().trim_start_matches("http://").trim_start_matches("https://").trim_end_matches('/').to_string() }
    }

    fn connect(&self, read_timeout: Duration) -> Result<TcpStream, String> {
        if self.rest_addr.is_empty() {
            return Err("No fts REST address configured.".into());
        }
        let addr = self
            .rest_addr
            .to_socket_addrs()
            .map_err(|error| format!("Cannot resolve fts REST address {}: {error}", self.rest_addr))?
            .next()
            .ok_or_else(|| format!("No addresses resolved for fts REST address {}", self.rest_addr))?;
        let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|error| format!("Cannot reach the fts daemon at {}: {error}", self.rest_addr))?;
        stream.set_nodelay(true).ok();
        stream.set_read_timeout(Some(read_timeout)).map_err(|error| error.to_string())?;
        stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(|error| error.to_string())?;
        Ok(stream)
    }

    fn send_request(stream: &mut TcpStream, host: &str, method: &str, path: &str, body: Option<&str>) -> Result<(), String> {
        let mut request = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
        match body {
            Some(body) => {
                request.push_str("Content-Type: application/json\r\n");
                request.push_str(&format!("Content-Length: {}\r\n\r\n{body}", body.len()));
            }
            None => request.push_str("\r\n"),
        }
        stream.write_all(request.as_bytes()).map_err(|error| format!("fts request write failed: {error}"))?;
        stream.flush().map_err(|error| format!("fts request write failed: {error}"))
    }

    fn request_json(&self, method: &str, path: &str, body: Option<String>) -> Result<(u16, String), String> {
        let mut stream = self.connect(IO_TIMEOUT)?;
        Self::send_request(&mut stream, &self.rest_addr, method, path, body.as_deref())?;
        let mut response = read_response(stream)?;
        let bytes = response.body.read_to_end()?;
        Ok((response.status, String::from_utf8_lossy(&bytes).to_string()))
    }

    fn check_status(status: u16, body: &str) -> Result<(), String> {
        if (200..300).contains(&status) {
            return Ok(());
        }
        let reason = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(|error| error.to_string()))
            .unwrap_or_else(|| body.trim().to_string());
        Err(format!("fts REST {status}: {reason}"))
    }

    /// Probe the daemon. The integration contract says callers must do this
    /// before assuming any capability exists.
    pub fn capabilities(&self) -> Result<Capabilities, String> {
        let (status, body) = self.request_json("GET", "/v1/capabilities", None)?;
        Self::check_status(status, &body)?;
        serde_json::from_str(&body).map_err(|error| format!("fts capabilities malformed: {error}"))
    }

    /// Directory-mode inbox token (`file_name` stays empty) for one transfer.
    pub fn reserve_inbox(&self, out_dir: &str, credential: Option<&UncCredential>) -> Result<String, String> {
        let mut payload = serde_json::json!({ "out_dir": out_dir });
        if let Some(credential) = credential {
            if !credential.user_name.is_empty() || !credential.password.is_empty() {
                payload["credential"] = serde_json::json!({ "user_name": credential.user_name, "password": credential.password });
            }
        }
        let (status, body) = self.request_json("POST", "/v1/inbox", Some(payload.to_string()))?;
        Self::check_status(status, &body)?;
        let reply: serde_json::Value = serde_json::from_str(&body).map_err(|error| format!("fts inbox reply malformed: {error}"))?;
        reply
            .get("token")
            .and_then(|token| token.as_str())
            .map(|token| token.to_string())
            .ok_or_else(|| format!("fts inbox reply has no token: {body}"))
    }

    /// Submit a transfer task; returns the task id immediately (async task).
    pub fn submit(&self, paths: &[&str], dst_addr: &str, fingerprint: &str, ticket: &str, transport: &str) -> Result<String, String> {
        let payload = serde_json::json!({
            "paths": paths,
            "dst_addr": dst_addr,
            "fingerprint": fingerprint,
            "transport": if transport.is_empty() { "auto" } else { transport },
            "ticket": ticket,
        });
        let (status, body) = self.request_json("POST", "/v1/transfers", Some(payload.to_string()))?;
        Self::check_status(status, &body)?;
        let reply: serde_json::Value = serde_json::from_str(&body).map_err(|error| format!("fts submit reply malformed: {error}"))?;
        reply
            .get("task_id")
            .and_then(|task_id| task_id.as_str())
            .map(|task_id| task_id.to_string())
            .ok_or_else(|| format!("fts submit reply has no task_id: {body}"))
    }

    pub fn status(&self, task_id: &str) -> Result<TransferStatus, String> {
        let (status, body) = self.request_json("GET", &format!("/v1/transfers/{task_id}"), None)?;
        Self::check_status(status, &body)?;
        serde_json::from_str(&body).map_err(|error| format!("fts status malformed: {error}"))
    }

    /// Idempotent cancel; a 404 (task already gone) counts as success.
    pub fn cancel(&self, task_id: &str) -> Result<(), String> {
        let (status, body) = self.request_json("POST", &format!("/v1/transfers/{task_id}/cancel"), Some("{}".to_string()))?;
        if status == 404 {
            return Ok(());
        }
        Self::check_status(status, &body)
    }

    /// Subscribe to the task's SSE event stream. Events flow through
    /// `on_event` as they arrive; returns the terminal `result` event, or an
    /// error if the stream ends (or times out) without one - callers can then
    /// fall back to [`FtsClient::status`].
    pub fn events(&self, task_id: &str, on_event: &mut dyn FnMut(&FtsEvent)) -> Result<Option<FtsEvent>, String> {
        let mut stream = self.connect(STREAM_READ_TIMEOUT)?;
        Self::send_request(&mut stream, &self.rest_addr, "GET", &format!("/v1/transfers/{task_id}/events"), None)?;
        let mut response = read_response(stream)?;
        if !(200..300).contains(&response.status) {
            // error replies are plain JSON, not a stream
            let bytes = response.body.read_to_end()?;
            Self::check_status(response.status, &String::from_utf8_lossy(&bytes))?;
        }
        loop {
            match response.body.body_line()? {
                None => return Err("fts event stream ended before a result event".into()),
                Some(line) => {
                    let Some(payload) = line.strip_prefix("data:") else { continue };
                    let payload = payload.trim();
                    if payload.is_empty() {
                        continue;
                    }
                    // unparseable events are skipped (fts contract: receivers ignore what they cannot read)
                    if let Ok(event) = serde_json::from_str::<FtsEvent>(payload) {
                        if matches!(event, FtsEvent::Unknown) {
                            continue;
                        }
                        let terminal = event.is_result();
                        on_event(&event);
                        if terminal {
                            return Ok(Some(event));
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny blocking HTTP/1.1 stub: reads one request (headers + body by
    /// content-length) and answers with the given raw response bytes.
    fn serve_one(responses: Vec<&'static str>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                seen.push(read_request(&mut stream));
                stream.write_all(response.as_bytes()).unwrap();
                // SSE responses stream gradually; the client disconnects after
                // the result event, so further writes may fail - that's fine
                let _ = stream.flush();
            }
            seen
        });
        (addr, handle)
    }

    fn read_request(stream: &mut TcpStream) -> String {
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut raw = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            if let Some(index) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&raw[..index]).to_string();
                let length = headers
                    .lines()
                    .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().ok()))
                    .flatten()
                    .unwrap_or(0);
                let body_start = index + 4;
                while raw.len() < body_start + length {
                    let n = stream.read(&mut tmp).unwrap();
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&tmp[..n]);
                }
                return String::from_utf8_lossy(&raw).to_string();
            }
            let n = stream.read(&mut tmp).unwrap();
            if n == 0 {
                break;
            }
            raw.extend_from_slice(&tmp[..n]);
        }
        String::from_utf8_lossy(&raw).to_string()
    }

    fn sse_chunk(event: &str) -> String {
        let payload = format!("data: {event}\n\n");
        format!("{:x}\r\n{payload}\r\n", payload.len())
    }

    #[test]
    fn capabilities_round_trip() {
        let body = r#"{"protocol_version":"1","fts_version":"0.1.0","capabilities":8}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        let caps = FtsClient::new(&addr).capabilities().unwrap();
        assert_eq!(caps.protocol_version, "1");
        assert_eq!(caps.capabilities, 8);
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /v1/capabilities HTTP/1.1"));
        assert!(requests[0].contains("Connection: close"));
    }

    #[test]
    fn reserve_inbox_sends_credential_and_returns_token() {
        let body = r#"{"token":"abc-123","expires_in":600}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        let credential = UncCredential { user_name: "svc".into(), password: "secret".into() };
        let token = FtsClient::new(&addr).reserve_inbox(r"\\nas\share\out", Some(&credential)).unwrap();
        assert_eq!(token, "abc-123");
        let request = server.join().unwrap().remove(0);
        assert!(request.starts_with("POST /v1/inbox HTTP/1.1"), "{request}");
        assert!(request.contains("out_dir"), "{request}");
        assert!(request.contains(r"\\nas\\share\\out"), "backslashes are JSON-escaped: {request}");
        assert!(request.contains("\"user_name\":\"svc\""), "credential goes in the body");
    }

    #[test]
    fn error_body_becomes_a_readable_error() {
        let body = r#"{"error":"必须提供 fingerprint 或 insecure=true"}"#;
        let response = format!("HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        let error = FtsClient::new(&addr).submit(&["C:\\a.bin"], "1.2.3.4:4433", "", "t", "auto").unwrap_err();
        assert!(error.contains("fts REST 400"), "{error}");
        assert!(error.contains("fingerprint"), "{error}");
        server.join().unwrap();
    }

    #[test]
    fn submit_returns_task_id() {
        let body = r#"{"task_id":"3f2b8c1a"}"#;
        let response = format!("HTTP/1.1 202 Accepted\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        let task_id = FtsClient::new(&addr).submit(&[r"C:\data\a.bin", r"C:\data\dirB"], "100.64.0.5:4433", "a".repeat(64).as_str(), "tok", "auto").unwrap();
        assert_eq!(task_id, "3f2b8c1a");
        let request = server.join().unwrap().remove(0);
        assert!(request.starts_with("POST /v1/transfers HTTP/1.1"), "{request}");
        assert!(request.contains("\"transport\":\"auto\""), "{request}");
        assert!(request.contains("\"ticket\":\"tok\""), "{request}");
    }

    #[test]
    fn status_parses_failure_fields() {
        let body = r#"{"task_id":"t1","state":"FAILED","checksum_ok":false,"error_code":4,"error":"CHECKSUM_FAILED","error_message":"boom"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        let status = FtsClient::new(&addr).status("t1").unwrap();
        assert_eq!(status.state, "FAILED");
        assert_eq!(status.error_code, FTS_ERROR_CHECKSUM_FAILED);
        assert_eq!(fts_error_name(status.error_code), "CHECKSUM_FAILED");
        server.join().unwrap();
    }

    #[test]
    fn events_stream_decodes_until_result_and_skips_unknown() {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
        let stream = format!(
            "{head}{}{}{}{}{}",
            sse_chunk(r#"{"type":"task","task_id":"t1","state":"RUNNING"}"#),
            sse_chunk(r#"{"type":"from_the_future","whatever":1}"#),
            sse_chunk(r#"{"type":"file","name":"a.bin","index":1,"total":2}"#),
            sse_chunk(r#"{"type":"progress","bytes_done":5,"bytes_total":10,"throughput_bps":null,"eta_seconds":null}"#),
            sse_chunk(r#"{"type":"result","state":"COMPLETED","checksum_ok":true,"duration_seconds":1.5}"#),
        );
        let trailing = sse_chunk(r#"{"type":"progress","bytes_done":7,"bytes_total":10}"#);
        let response = format!("{stream}{trailing}0\r\n\r\n");
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);

        let seen = std::sync::Mutex::new(Vec::new());
        let result = {
            let mut guard = seen.lock().unwrap();
            FtsClient::new(&addr).events("t1", &mut |event| guard.push(event.clone())).unwrap()
        };
        let FtsEvent::Result { state, checksum_ok, .. } = result.unwrap() else { panic!("expected result event") };
        assert_eq!(state, "COMPLETED");
        assert!(checksum_ok);
        let seen = seen.into_inner().unwrap();
        assert!(matches!(seen[0], FtsEvent::Task { .. }), "{seen:?}");
        assert!(seen.iter().all(|event| !matches!(event, FtsEvent::Unknown)), "unknown events are skipped before the callback");
        assert!(matches!(seen[1], FtsEvent::File { .. }), "{seen:?}");
        server.join().unwrap();
    }

    #[test]
    fn events_stream_ending_without_result_is_an_error() {
        let head = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";
        let response = format!("{head}{}0\r\n\r\n", sse_chunk(r#"{"type":"task","task_id":"t1","state":"RUNNING"}"#));
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        let error = FtsClient::new(&addr).events("t1", &mut |_| {}).unwrap_err();
        assert!(error.contains("result event"), "{error}");
        server.join().unwrap();
    }

    #[test]
    fn cancel_treats_404_as_success() {
        let body = r#"{"error":"任务不存在"}"#;
        let response = format!("HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let (addr, server) = serve_one(vec![Box::leak(response.into_boxed_str())]);
        FtsClient::new(&addr).cancel("gone").unwrap();
        server.join().unwrap();
    }

    #[test]
    fn client_strips_url_prefixes() {
        let client = FtsClient::new("http://127.0.0.1:5050/");
        assert_eq!(client.rest_addr, "127.0.0.1:5050");
    }
}

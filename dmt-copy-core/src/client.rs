//! Synchronous client for the LAN agent protocol. Deliberately std-only (no
//! tokio) so the desktop app can call it inside `spawn_blocking` and tests can
//! drive it from plain threads.

use crate::copier::CopyProgress;
use crate::protocol::{AgentAuth, AgentLine, AgentRequest, AgentTarget, AuthReply, DEFAULT_PORT};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);
/// Generous stall guard for the control connection. Normal transfers never hit
/// this - the agent emits intra-file progress every few hundred milliseconds -
/// but a hung agent must eventually free the caller.
const READ_TIMEOUT: Duration = Duration::from_secs(1800);

/// Send one request to the agent, invoke `on_line` for every progress line and
/// return `(agent protocol version, result payload)`. The protocol number
/// comes from the auth reply (0 for pre-v2 agents) so callers can gate newer
/// request features on agent support.
pub fn call_agent(
    target: &AgentTarget,
    request: &AgentRequest,
    mut on_progress: impl FnMut(CopyProgress),
) -> Result<(u32, serde_json::Value), String> {
    let stream = connect(&target.addr)?;
    let mut writer = stream.try_clone().map_err(|error| format!("Cannot open agent socket for writing: {error}"))?;
    let mut reader = BufReader::new(stream);

    write_json(&mut writer, &AgentAuth {
        auth: target.token.clone(),
    })?;
    let reply: AuthReply = read_json(&mut reader)?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "Agent rejected the connection (wrong token?).".into()));
    }

    write_json(&mut writer, request)?;
    loop {
        match read_json::<AgentLine>(&mut reader)? {
            AgentLine::Progress { progress } => on_progress(progress),
            AgentLine::Result { result, error } => {
                if let Some(error) = error {
                    return Err(error);
                }
                let value = result.ok_or_else(|| "Agent closed the connection without a result.".to_string())?;
                return Ok((reply.protocol, value));
            }
        }
    }
}

fn connect(addr: &str) -> Result<TcpStream, String> {
    let trimmed = addr.trim().trim_start_matches("tcp://");
    let with_port = if trimmed.contains(':') { trimmed.to_string() } else { format!("{trimmed}:{DEFAULT_PORT}") };
    let candidates: Vec<SocketAddr> = with_port
        .to_socket_addrs()
        .map_err(|error| format!("Cannot resolve agent address {with_port}: {error}"))?
        .collect();
    let mut last_error = String::from("no addresses resolved");
    for candidate in candidates {
        match TcpStream::connect_timeout(&candidate, CONNECT_TIMEOUT) {
            Ok(stream) => {
                stream.set_read_timeout(Some(READ_TIMEOUT)).map_err(|e| e.to_string())?;
                stream.set_write_timeout(Some(WRITE_TIMEOUT)).map_err(|e| e.to_string())?;
                return Ok(stream);
            }
            Err(error) => last_error = format!("Cannot reach agent at {candidate}: {error}"),
        }
    }
    Err(last_error)
}

fn write_json(stream: &mut TcpStream, value: &impl serde::Serialize) -> Result<(), String> {
    let mut json = serde_json::to_string(value).map_err(|error| error.to_string())?;
    json.push('\n');
    stream.write_all(json.as_bytes()).map_err(|error| format!("Cannot send to agent: {error}"))
}

fn read_json<T: serde::de::DeserializeOwned>(reader: &mut BufReader<TcpStream>) -> Result<T, String> {
    let mut line = String::new();
    let read = reader.read_line(&mut line).map_err(|error| {
        if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut {
            "Agent did not answer in time - the operation may still be running on the site.".to_string()
        } else {
            format!("Agent connection lost: {error}")
        }
    })?;
    if read == 0 {
        return Err("Agent closed the connection unexpectedly - the agent task may have crashed mid-operation (check the agent's console or service log).".into());
    }
    serde_json::from_str(line.trim()).map_err(|error| format!("Agent sent a malformed line: {error}"))
}

//! Wire protocol shared by the desktop client (`client.rs`) and the LAN agent
//! binary: one JSON object per line (NDJSON), token auth on the first frame.

use crate::copier::{CopyEndpoint, CopyProgress};
use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 3777;
/// v2: `target_model_name` on the copy op (rename/clone support) and the
/// protocol number in the auth reply. v3: `copy_cross_site` op (QUIC relay).
/// Clients must refuse to send requests an older agent would silently misread.
pub const AGENT_PROTOCOL_VERSION: u32 = 3;
pub const RENAME_MIN_PROTOCOL: u32 = 2;
pub const RELAY_MIN_PROTOCOL: u32 = 3;

/// Where to reach a site's agent and the token proving the client belongs to
/// the tailnet. Stored per machine in machines.json.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AgentTarget {
    pub addr: String,
    #[serde(default)]
    pub token: String,
}

/// The machine (main PC + three Vision PC share paths) a scan runs against.
/// Same shape as the desktop app's machines.json entries.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MachinePaths {
    pub fm1_path: String,
    pub fm2_path: String,
    pub bm_path: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

/// First frame from the client.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentAuth {
    pub auth: String,
}

/// First frame from the agent. `protocol` is 0 for pre-v2 agents (field
/// absent) - clients use it to gate newer request features.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthReply {
    pub ok: bool,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub protocol: u32,
    #[serde(default)]
    pub error: Option<String>,
}

/// One request per connection, after the auth handshake.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum AgentRequest {
    Ping,
    ScanModels { machine: MachinePaths },
    Copy { source: CopyEndpoint, target: CopyEndpoint, model_name: String, #[serde(default)] target_model_name: String, confirmed: bool },
    /// Cross-site: the CALLED agent is the source site's; it reads from its
    /// local Vision PC and pushes to the target site's agent over QUIC.
    CopyCrossSite {
        source: CopyEndpoint,
        target_agent: AgentTarget,
        target: CopyEndpoint,
        model_name: String,
        #[serde(default)] target_model_name: String,
        #[serde(default)] force_full: bool,
        confirmed: bool,
    },
    /// Fallback data plane: the CALLED agent acts as the RELAY TARGET - the
    /// source site's agent tunnels the QUIC wire protocol through this very
    /// TCP connection (streams and frames unchanged), so a transfer succeeds
    /// whenever plain TCP reaches both agents even if UDP/QUIC is blocked.
    TcpRelayPush {
        manifest: crate::relay::RelayManifest,
        /// file count the tunneled streams will carry
        streams: u64,
    },
}

/// Every line after the request is either a progress update or the single
/// final result envelope.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentLine {
    Progress { #[serde(flatten)] progress: CopyProgress },
    Result { #[serde(default)] result: Option<serde_json::Value>, #[serde(default)] error: Option<String> },
}

/// Compare the presented token with the configured one without leaking the
/// match position through early returns. Length equality is visible - fine,
/// token lengths are not secret.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_eq_behaves_like_string_equality() {
        assert!(constant_time_eq("token-1", "token-1"));
        assert!(!constant_time_eq("token-1", "token-2"));
        assert!(!constant_time_eq("token-1", "token-11"));
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn agent_lines_round_trip_through_json() {
        let progress = AgentLine::Progress {
            progress: CopyProgress { kind: "PxRepository".into(), file: "C:\\a.gbr".into(), files_done: 3, files_total: 9, bytes_done: 4096, relay_mode: String::new() },
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"type\":\"progress\""), "{json}");
        let parsed: AgentLine = serde_json::from_str(&json).unwrap();
        let AgentLine::Progress { progress } = parsed else { panic!("wrong variant") };
        assert_eq!(progress.files_total, 9);
        assert_eq!(progress.kind, "PxRepository");

        let result = AgentLine::Result { result: None, error: Some("boom".into()) };
        let parsed: AgentLine = serde_json::from_str(&serde_json::to_string(&result).unwrap()).unwrap();
        let AgentLine::Result { result, error } = parsed else { panic!("wrong variant") };
        assert_eq!(error.as_deref(), Some("boom"));
        assert!(result.is_none());
    }
}

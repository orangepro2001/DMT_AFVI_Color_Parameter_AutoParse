//! Agent-to-agent relay data plane (QUIC over UDP): wire types for the
//! cross-site transfer. The control TCP channel stays unchanged; this module
//! only carries types and pure helpers - all async IO lives in the agent.

use crate::copier::{CopyEndpoint, CopyReport};
use serde::{Deserialize, Serialize};

/// ALPN id of the relay protocol.
pub const RELAY_ALPN: &[u8] = b"dmt-relay/1";
/// How many files are transferred concurrently on one QUIC connection.
pub const RELAY_STREAMS: usize = 6;
/// Content is framed as `[u32 LE chunk length][bytes]`, terminated by length 0.
pub const CHUNK_SIZE: usize = 256 * 1024;
/// Files below this size skip zstd - compression overhead beats the saving.
pub const COMPRESSION_THRESHOLD: u64 = 4096;
/// Staging directories are created under the involved share roots; anything
/// older than this is swept before a new transfer stages its files. Failed
/// transfers clean up immediately - this is only the safety net for a hard
/// process crash mid-transfer.
pub const STAGING_MAX_AGE_SECS: u64 = 2 * 60 * 60;

pub fn staging_prefix() -> &'static str {
    ".dmt_stage_"
}

/// First control-stream frame: who is calling and what will be transferred.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelayHandshake {
    pub auth: String,
    pub manifest: RelayManifest,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelayHandshakeReply {
    pub ok: bool,
    #[serde(default)]
    pub error: Option<String>,
}

/// What the receiving agent should end up with. `target` is the receiving
/// agent's own Vision PC endpoint (its site's LAN); the receiving side applies
/// the same delete guards as a single-site copy.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelayManifest {
    pub source_model: String,
    pub target_model: String,
    pub kinds: Vec<String>,
    /// true = skip files the target already has with identical size+mtime
    pub incremental: bool,
    pub target: CopyEndpoint,
}

/// Per-file header frame (JSON line) sent at the start of each file stream.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileHeader {
    pub kind: String,
    /// Path relative to the model folder, '/' separators, no traversal.
    pub path: String,
    pub size: u64,
    /// nanoseconds since UNIX epoch - the receiver restores it so later
    /// incremental runs match
    pub mtime_nanos: i64,
    pub compressed: bool,
}

/// The receiver answers on the same stream before any content flows.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FileReply {
    pub skip: bool,
}

/// Sent on the control stream after every file stream has been finished.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FilesDone {
    pub done: bool,
    pub streams: u64,
}

/// Final control-stream frame: the receiving agent's copy report.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelayResult {
    #[serde(default)]
    pub report: Option<CopyReport>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Incremental rule: identical name (caller's job), size and mtime means the
/// target already has exactly this file - skip the content entirely.
pub fn should_skip_file(existing_size: u64, existing_mtime_nanos: i64, header: &FileHeader, incremental: bool) -> bool {
    incremental && existing_size == header.size && existing_mtime_nanos == header.mtime_nanos
}

/// Reject anything that could escape the staging directory.
pub fn validate_relative_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("empty relative path".into());
    }
    if path.contains("..") || path.starts_with('/') || path.starts_with('\\') || path.contains(':') {
        return Err(format!("unsafe relative path \"{path}\""));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(path: &str, size: u64, mtime: i64) -> FileHeader {
        FileHeader { kind: "PxRepository".into(), path: path.into(), size, mtime_nanos: mtime, compressed: false }
    }

    #[test]
    fn incremental_skips_only_on_full_match() {
        let file = header("a.gbr", 100, 1_000);
        assert!(should_skip_file(100, 1_000, &file, true));
        assert!(!should_skip_file(101, 1_000, &file, true), "size differs");
        assert!(!should_skip_file(100, 1_001, &file, true), "mtime differs");
        assert!(!should_skip_file(100, 1_000, &file, false), "forced full");
    }

    #[test]
    fn relative_paths_may_not_escape() {
        assert!(validate_relative_path("sub/gerber.gbr").is_ok());
        assert!(validate_relative_path("deep/deeper/file.xml").is_ok());
        assert!(validate_relative_path("../evil").is_err());
        assert!(validate_relative_path("a\\..\\..\\evil").is_err());
        assert!(validate_relative_path("C:\\evil").is_err());
        assert!(validate_relative_path("/abs").is_err());
        assert!(validate_relative_path("").is_err());
    }
}

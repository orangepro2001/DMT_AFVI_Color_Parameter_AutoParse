//! Shared Model Copy / model scan domain logic.
//!
//! Both consumers depend on this crate so the safety rules (delete guards,
//! canonical model names, same-inventory rejection) have exactly one
//! implementation:
//! - the Tauri desktop app (`tauri-app/src-tauri`), which runs the copy on the
//!   local machine over direct SMB - the fallback path,
//! - the per-site LAN agent (`dmt-agent`), which runs the same copy inside the
//!   site's real network where the Vision PCs are gigabit-connected.

pub mod client;
pub mod credentials;
pub mod copier;
pub mod protocol;
pub mod relay;
pub mod scan;

pub use client::call_agent;
pub use credentials::ensure_unc_credentials;
pub use copier::{
    assert_deletable, build_copy_plan, execute_copy_plan, CopyEndpoint, CopyPlan, CopyPlanEntry,
    CopyProgress, CopyReport, CopyResultEntry,
};
pub use protocol::{
    constant_time_eq, AgentAuth, AgentLine, AgentRequest, AgentTarget, AuthReply, MachinePaths,
    RELAY_MIN_PROTOCOL, RENAME_MIN_PROTOCOL, AGENT_PROTOCOL_VERSION, DEFAULT_PORT,
};
pub use scan::{models_in_host, scan_hosts, ModelCandidate};

use std::fs;
use std::path::{Path, PathBuf};

/// Model names compare case-insensitively and without the `-00` variant
/// suffix, so `2an0859f01-00` and `2AN0859F01` are the same model.
pub fn canonical_model_name(name: &str) -> String {
    name.trim_end_matches("-00").to_ascii_uppercase()
}

/// Locate the folder for `model_name` directly under `root`, matching folder
/// names case-insensitively via the canonical name.
pub fn find_model_dir(root: &Path, model_name: &str) -> Result<PathBuf, String> {
    let requested = canonical_model_name(model_name);
    let entries =
        fs::read_dir(root).map_err(|error| format!("Cannot read {}: {error}", root.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && canonical_model_name(&entry.file_name().to_string_lossy()) == requested {
            return Ok(path);
        }
    }
    Err(format!(
        "Model {model_name} was not found under {}",
        root.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_names_fold_case_and_variant_suffix() {
        assert_eq!(canonical_model_name("2an0859f01-00"), "2AN0859F01");
        assert_eq!(canonical_model_name("2AN0859F01"), "2AN0859F01");
        // trimming is the frontend's job - the Rust side keeps the original behavior
        assert_eq!(canonical_model_name(" 2AN0859F01 "), " 2AN0859F01 ");
    }
}

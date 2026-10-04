//! Model list scanning: enumerate the model folders of one or more Vision
//! PCs' PxInventory shares and merge them into per-model host lists.

use crate::credentials::ensure_unc_credentials;
use crate::canonical_model_name;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// One discovered model and the hosts it exists on (FM1/FM2/BM).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelCandidate {
    pub name: String,
    pub hosts: Vec<String>,
}

/// Collect the canonical model names of one PxInventory root (LIGHT_SPEC +
/// INSPECT_SPEC). Missing model folders mean "no models yet" - but the share
/// root itself must be readable: `path.exists()` is also false for
/// access-denied / unreachable shares, so without the root probe an
/// unreachable share would silently produce an empty model list instead of
/// an error.
pub fn models_in_host(base: &Path) -> Result<Vec<String>, String> {
    fs::read_dir(base)
        .map_err(|error| format!("Cannot reach {} - check the network credentials and the site agent's share access: {error}", base.display()))?;
    let mut models = Vec::new();
    for folder in ["LIGHT_SPEC", "INSPECT_SPEC"] {
        let path = base.join(folder);
        if !path.exists() {
            continue;
        }
        let entries = fs::read_dir(&path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                models.push(canonical_model_name(&entry.file_name().to_string_lossy()));
            }
        }
    }
    models.sort();
    models.dedup();
    Ok(models)
}

/// Scan every `(label, inventory path)` in parallel and merge the results
/// into one candidate list. Credentials are applied once for all UNC servers
/// first. Hosts with an empty path are skipped, so callers can scan a single
/// Vision PC by passing only its path. An unreachable share is an error -
/// never an empty result.
pub fn scan_hosts(hosts: &[(&str, &str)], username: &str, password: &str) -> Result<Vec<ModelCandidate>, String> {
    let active: Vec<(&str, &str)> = hosts.iter().copied().filter(|(_, path)| !path.trim().is_empty()).collect();
    if active.is_empty() {
        return Ok(Vec::new());
    }
    let paths: Vec<&str> = active.iter().map(|(_, path)| *path).collect();
    ensure_unc_credentials(&paths, username, password)?;
    // when no credentials are configured the logon is skipped entirely; a
    // SYSTEM-service agent then connects anonymously and typically hits
    // "access denied" - point the operator at the real fix
    let logon_skipped = username.trim().is_empty() && password.trim().is_empty();

    // Parallel per-host scans: SMB round trips dominate on high-latency
    // links, so scanning 3 hosts in series would triple the wait.
    let scanned: Vec<Result<(String, Vec<String>), String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = active
            .iter()
            .map(|(host, path)| scope.spawn(move || models_in_host(Path::new(path)).map(|models| ((*host).to_string(), models))))
            .collect();
        handles.into_iter().map(|handle| handle.join().unwrap_or_else(|_| Err("Scan thread panicked".to_string()))).collect()
    });

    let mut discovered: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for result in scanned {
        let (host, models) = match result {
            Ok(found) => found,
            Err(error) => {
                if logon_skipped {
                    return Err(format!("{error} - no network credentials are configured for this machine; fill them in under Machine Configuration so the agent can log on to the shares."));
                }
                return Err(error);
            }
        };
        for model in models {
            discovered.entry(model).or_default().push(host.clone());
        }
    }
    Ok(discovered.into_iter().map(|(name, hosts)| ModelCandidate { name, hosts }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("afvi_scan_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_paths_are_skipped_and_yield_no_candidates() {
        let candidates = scan_hosts(&[("FM1", ""), ("FM2", "  "), ("BM", "")], "", "").unwrap();
        assert!(candidates.is_empty());
    }

    #[test]
    fn unreachable_share_is_an_error_not_an_empty_list() {
        let base = temp_dir("missing");
        let missing = base.join("no_such_share");
        let error = scan_hosts(&[("FM1", missing.to_str().unwrap())], "", "").unwrap_err();
        assert!(error.contains("Cannot reach"), "{error}");
    }

    #[test]
    fn models_merge_across_hosts_case_insensitively() {
        let base = temp_dir("merge");
        let fm1 = base.join("fm1_inv");
        let fm2 = base.join("fm2_inv");
        for (root, name) in [(&fm1, "2AN0859F01"), (&fm1, "M02"), (&fm2, "2an0859f01-00")] {
            let dir = root.join("LIGHT_SPEC").join(name);
            fs::create_dir_all(&dir).unwrap();
        }
        let candidates = scan_hosts(&[("FM1", fm1.to_str().unwrap()), ("FM2", fm2.to_str().unwrap())], "", "").unwrap();
        let names: Vec<&str> = candidates.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["2AN0859F01", "M02"]);
        assert_eq!(candidates[0].hosts, ["FM1", "FM2"]);
        assert_eq!(candidates[1].hosts, ["FM1"]);
    }
}

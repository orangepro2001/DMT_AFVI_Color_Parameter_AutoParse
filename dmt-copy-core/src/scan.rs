//! Model list scanning: enumerate the model folders of one or more Vision
//! PCs' shares and merge them into per-model host lists.
//!
//! Two sources are scanned, matching the two tabs of the machine's
//! "Choose Model Names" dialog:
//! - `ScanKind::Inventory` reads `PxInventory` (`LIGHT_SPEC` / `INSPECT_SPEC`)
//!   - the models the inspection station can teach and inspect (tab "Model"),
//! - `ScanKind::Repository` reads `PxRepository` - the product version folders
//!   the Vision software keeps its Line/MasterData data in (tab "Product").

use crate::credentials::ensure_unc_credentials;
use crate::canonical_model_name;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Which share tree a scan walks. Both live beside each other on every Vision
/// PC (`\\<ip>\PxInventory` and `\\<ip>\PxRepository`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScanKind {
    /// `LIGHT_SPEC` / `INSPECT_SPEC` under `PxInventory`.
    #[default]
    Inventory,
    /// Version folders under `PxRepository`.
    Repository,
}

impl ScanKind {
    /// Lenient parse for the IPC boundary: anything that is not an explicit
    /// "repository" is an inventory scan, so old callers keep their behavior.
    pub fn from_wire(value: &str) -> Self {
        if value.trim().eq_ignore_ascii_case("repository") {
            ScanKind::Repository
        } else {
            ScanKind::Inventory
        }
    }
}

/// One discovered model and the hosts it exists on (FM1/FM2/BM).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelCandidate {
    pub name: String,
    pub hosts: Vec<String>,
    /// Creation time of the model folder, epoch milliseconds UTC. `None` when
    /// the share does not report a usable timestamp.
    #[serde(default)]
    pub created_ms: Option<i64>,
    /// Comma-joined Vision version folders ("2.0" or "2.0, 3.5"). Only the
    /// repository scan fills this - the inventory tree has no version level.
    #[serde(default)]
    pub resolution: Option<String>,
}

/// What one host contributed for one model.
#[derive(Default, Clone)]
struct HostEntry {
    created_ms: Option<i64>,
    resolution: Option<String>,
}

/// One model folder found on a host, before the per-host results merge.
struct Discovery {
    /// The folder name exactly as it is on disk - what the picker displays.
    name: String,
    /// `canonical_model_name` of `name`: the merge/lookup key.
    key: String,
    created_ms: Option<i64>,
    resolution: Option<String>,
}

fn folder_created_ms(path: &Path) -> Option<i64> {
    // `created()` is not reported on every SMB server; the modification time is
    // the next best thing and is what the folder listing normally carries.
    let created = fs::metadata(path)
        .and_then(|meta| meta.created().or_else(|_| meta.modified()))
        .ok()?;
    match created.duration_since(UNIX_EPOCH) {
        Ok(since) => i64::try_from(since.as_millis()).ok(),
        // A folder dated before 1970 is nonsense; treat it as "no timestamp".
        Err(_) => None,
    }
}

/// The immediate subdirectory names of `path`, sorted (the Vision version
/// folders of a repository model, e.g. "2.0", "3.5").
fn subfolder_names(path: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

/// Collect the canonical model names of one PxInventory root (LIGHT_SPEC +
/// INSPECT_SPEC). Missing model folders mean "no models yet" - but the share
/// root itself must be readable: `path.exists()` is also false for
/// access-denied / unreachable shares, so without the root probe an
/// unreachable share would silently produce an empty model list instead of
/// an error.
pub fn models_in_host(base: &Path) -> Result<Vec<String>, String> {
    Ok(inventory_discoveries(base)?.into_iter().map(|found| found.key).collect())
}

fn inventory_discoveries(base: &Path) -> Result<Vec<Discovery>, String> {
    fs::read_dir(base)
        .map_err(|error| format!("Cannot reach {} - check the network credentials and the site agent's share access: {error}", base.display()))?;
    let mut discovered: BTreeMap<String, Discovery> = BTreeMap::new();
    for folder in ["LIGHT_SPEC", "INSPECT_SPEC"] {
        let path = base.join(folder);
        if !path.exists() {
            continue;
        }
        let entries = fs::read_dir(&path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        for entry in entries.flatten() {
            let model = entry.path();
            if !model.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let key = canonical_model_name(&name);
            // LIGHT_SPEC carries the folder timestamp; INSPECT_SPEC only fills
            // in models LIGHT_SPEC does not have.
            let created_ms = folder_created_ms(&model);
            discovered
                .entry(key.clone())
                .and_modify(|found| found.created_ms = found.created_ms.or(created_ms))
                .or_insert(Discovery { name, key, created_ms, resolution: None });
        }
    }
    Ok(discovered.into_values().collect())
}

/// Enumerate the product folders of one PxRepository share: every model
/// directory plus the Vision version folders inside it. The repository root
/// may be the share itself or one level down (`PxRepository`), exactly like
/// the MEDIAN lookup accepts both layouts.
pub fn products_in_host(base: &Path) -> Result<Vec<ModelCandidate>, String> {
    Ok(repository_discoveries(base)?
        .into_iter()
        .map(|found| ModelCandidate {
            name: found.name,
            hosts: Vec::new(),
            created_ms: found.created_ms,
            resolution: found.resolution,
        })
        .collect())
}

fn repository_discoveries(base: &Path) -> Result<Vec<Discovery>, String> {
    fs::read_dir(base)
        .map_err(|error| format!("Cannot reach {} - check the network credentials and the site agent's share access: {error}", base.display()))?;
    let mut searches = vec![base.to_path_buf()];
    // Accept both `\\<ip>\PxRepository\<model>` and `\\<ip>\<share>\PxRepository\<model>`.
    let nested = base.join("PxRepository");
    if nested.is_dir() {
        searches.insert(0, nested);
    }

    let mut discovered: BTreeMap<String, Discovery> = BTreeMap::new();
    for root in searches {
        let Ok(entries) = fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let model = entry.path();
            if !model.is_dir() {
                continue;
            }
            // A model folder holds version folders; a share root holds model
            // folders. Folders with no subfolder at all are still listed (a
            // model that was never rendered) - the version column stays empty.
            let name = entry.file_name().to_string_lossy().to_string();
            let key = canonical_model_name(&name);
            let versions = subfolder_names(&model);
            discovered.entry(key.clone()).or_insert(Discovery {
                name,
                key,
                created_ms: folder_created_ms(&model),
                resolution: if versions.is_empty() { None } else { Some(versions.join(", ")) },
            });
        }
    }
    Ok(discovered.into_values().collect())
}

/// Scan every `(label, share path)` in parallel and merge the results into one
/// candidate list. Credentials are applied once for all UNC servers first.
/// Hosts with an empty path are skipped, so callers can scan a single Vision
/// PC by passing only its path. An unreachable share is an error - never an
/// empty result.
pub fn scan_hosts(
    hosts: &[(&str, &str)],
    kind: ScanKind,
    username: &str,
    password: &str,
) -> Result<Vec<ModelCandidate>, String> {
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
    let scanned: Vec<Result<(String, Vec<Discovery>), String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = active
            .iter()
            .map(|(host, path)| {
                scope.spawn(move || {
                    let found = match kind {
                        ScanKind::Inventory => inventory_discoveries(Path::new(path)),
                        ScanKind::Repository => repository_discoveries(Path::new(path)),
                    };
                    found.map(|models| ((*host).to_string(), models))
                })
            })
            .collect();
        handles.into_iter().map(|handle| handle.join().unwrap_or_else(|_| Err("Scan thread panicked".to_string()))).collect()
    });

    // key -> (display name, hosts, first-reported extra columns)
    let mut discovered: BTreeMap<String, (String, Vec<String>, HostEntry)> = BTreeMap::new();
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
            let entry = discovered
                .entry(model.key.clone())
                .or_insert_with(|| (model.name.clone(), Vec::new(), HostEntry::default()));
            entry.1.push(host.clone());
            // First host that reports a value wins, so the merged row stays
            // stable no matter which Vision PCs answered.
            if entry.2.created_ms.is_none() {
                entry.2.created_ms = model.created_ms;
            }
            if entry.2.resolution.is_none() {
                entry.2.resolution = model.resolution;
            }
        }
    }
    Ok(discovered
        .into_values()
        .map(|(name, hosts, entry)| ModelCandidate {
            name,
            hosts,
            created_ms: entry.created_ms,
            resolution: entry.resolution,
        })
        .collect())
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
        let candidates = scan_hosts(&[("FM1", ""), ("FM2", "  "), ("BM", "")], ScanKind::Inventory, "", "").unwrap();
        assert!(candidates.is_empty());
    }

    #[test]
    fn unreachable_share_is_an_error_not_an_empty_list() {
        let base = temp_dir("missing");
        let missing = base.join("no_such_share");
        let error = scan_hosts(&[("FM1", missing.to_str().unwrap())], ScanKind::Inventory, "", "").unwrap_err();
        assert!(error.contains("Cannot reach"), "{error}");
        let error = scan_hosts(&[("FM1", missing.to_str().unwrap())], ScanKind::Repository, "", "").unwrap_err();
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
        let candidates = scan_hosts(&[("FM1", fm1.to_str().unwrap()), ("FM2", fm2.to_str().unwrap())], ScanKind::Inventory, "", "").unwrap();
        let names: Vec<&str> = candidates.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["2AN0859F01", "M02"]);
        assert_eq!(candidates[0].hosts, ["FM1", "FM2"]);
        assert_eq!(candidates[1].hosts, ["FM1"]);
    }

    #[test]
    fn inventory_scan_reports_the_model_folder_timestamp() {
        let base = temp_dir("stamp");
        let inventory = base.join("inv");
        fs::create_dir_all(inventory.join("LIGHT_SPEC").join("6ST2001Q01")).unwrap();
        fs::create_dir_all(inventory.join("INSPECT_SPEC").join("6ST2001Q01-00")).unwrap();
        let candidates = scan_hosts(&[("FM1", inventory.to_str().unwrap())], ScanKind::Inventory, "", "").unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].name, "6ST2001Q01");
        assert!(candidates[0].created_ms.unwrap_or(0) > 0);
        assert!(candidates[0].resolution.is_none());
    }

    #[test]
    fn repository_scan_lists_model_folders_with_their_version_folders() {
        let base = temp_dir("repo");
        let share = base.join("PxRepository");
        for version in ["2.0", "3.5", "1.9"] {
            fs::create_dir_all(share.join("21msp016-30").join(version)).unwrap();
        }
        fs::create_dir_all(share.join("22CP011-08").join("2.0")).unwrap();
        // A model that exists but has no version folder yet is still listed.
        fs::create_dir_all(share.join("M02")).unwrap();

        let candidates = products_in_host(&share).unwrap();
        let rows: Vec<(&str, Option<&str>)> = candidates.iter().map(|c| (c.name.as_str(), c.resolution.as_deref())).collect();
        // The folder name is reported exactly as it is on disk (the dialog shows
        // it verbatim), and the version folders come back sorted.
        assert_eq!(rows, [("21msp016-30", Some("1.9, 2.0, 3.5")), ("22CP011-08", Some("2.0")), ("M02", None)]);
        assert!(candidates.iter().all(|c| c.created_ms.unwrap_or(0) > 0));
    }

    #[test]
    fn repository_scan_accepts_the_share_itself_as_the_root() {
        let base = temp_dir("repo_flat");
        let share = base.join("PxRepository");
        fs::create_dir_all(share.join("6SG0504A-00").join("2.0")).unwrap();
        let candidates = products_in_host(&share).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].name, "6SG0504A-00");
        assert_eq!(candidates[0].resolution.as_deref(), Some("2.0"));
    }

    #[test]
    fn models_merge_case_insensitively_but_keep_the_on_disk_folder_name() {
        let base = temp_dir("display_name");
        let share = base.join("PxRepository");
        fs::create_dir_all(share.join("21msp016-30").join("2.0")).unwrap();
        let candidates = scan_hosts(&[("FM1", share.to_str().unwrap())], ScanKind::Repository, "", "").unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].name, "21msp016-30");
    }

    #[test]
    fn scan_kind_parses_leniently_from_the_wire() {
        assert_eq!(ScanKind::from_wire("repository"), ScanKind::Repository);
        assert_eq!(ScanKind::from_wire(" Repository "), ScanKind::Repository);
        assert_eq!(ScanKind::from_wire("inventory"), ScanKind::Inventory);
        assert_eq!(ScanKind::from_wire(""), ScanKind::Inventory);
    }
}

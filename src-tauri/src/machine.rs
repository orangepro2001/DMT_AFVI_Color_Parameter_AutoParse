//! Machine paths, local/UNC model discovery and network credentials.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
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
    Ok(inventory_discoveries(base)?
        .into_iter()
        .map(|found| found.key)
        .collect())
}

fn inventory_discoveries(base: &Path) -> Result<Vec<Discovery>, String> {
    fs::read_dir(base).map_err(|error| {
        format!(
            "Cannot reach {} - check the network credentials: {error}",
            base.display()
        )
    })?;
    let mut discovered: BTreeMap<String, Discovery> = BTreeMap::new();
    for folder in ["LIGHT_SPEC", "INSPECT_SPEC"] {
        let path = base.join(folder);
        if !path.exists() {
            continue;
        }
        let entries = fs::read_dir(&path)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
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
                .or_insert(Discovery {
                    name,
                    key,
                    created_ms,
                    resolution: None,
                });
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
    fs::read_dir(base).map_err(|error| {
        format!(
            "Cannot reach {} - check the network credentials: {error}",
            base.display()
        )
    })?;
    let mut searches = vec![base.to_path_buf()];
    // Accept both `\\<ip>\PxRepository\<model>` and `\\<ip>\<share>\PxRepository\<model>`.
    let nested = base.join("PxRepository");
    if nested.is_dir() {
        searches.insert(0, nested);
    }

    let mut discovered: BTreeMap<String, Discovery> = BTreeMap::new();
    for root in searches {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
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
                resolution: if versions.is_empty() {
                    None
                } else {
                    Some(versions.join(", "))
                },
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
    let active: Vec<(&str, &str)> = hosts
        .iter()
        .copied()
        .filter(|(_, path)| !path.trim().is_empty())
        .collect();
    if active.is_empty() {
        return Ok(Vec::new());
    }
    let paths: Vec<&str> = active.iter().map(|(_, path)| *path).collect();
    ensure_unc_credentials(&paths, username, password)?;
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
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("Scan thread panicked".to_string()))
            })
            .collect()
    });

    // key -> (display name, hosts, first-reported extra columns)
    let mut discovered: BTreeMap<String, (String, Vec<String>, HostEntry)> = BTreeMap::new();
    for result in scanned {
        let (host, models) = match result {
            Ok(found) => found,
            Err(error) => {
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

    pub(super) fn temp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("afvi_scan_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_paths_are_skipped_and_yield_no_candidates() {
        let candidates = scan_hosts(
            &[("FM1", ""), ("FM2", "  "), ("BM", "")],
            ScanKind::Inventory,
            "",
            "",
        )
        .unwrap();
        assert!(candidates.is_empty());
    }

    #[test]
    fn unreachable_share_is_an_error_not_an_empty_list() {
        let base = temp_dir("missing");
        let missing = base.join("no_such_share");
        let error = scan_hosts(
            &[("FM1", missing.to_str().unwrap())],
            ScanKind::Inventory,
            "",
            "",
        )
        .unwrap_err();
        assert!(error.contains("Cannot reach"), "{error}");
        let error = scan_hosts(
            &[("FM1", missing.to_str().unwrap())],
            ScanKind::Repository,
            "",
            "",
        )
        .unwrap_err();
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
        let candidates = scan_hosts(
            &[
                ("FM1", fm1.to_str().unwrap()),
                ("FM2", fm2.to_str().unwrap()),
            ],
            ScanKind::Inventory,
            "",
            "",
        )
        .unwrap();
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
        let candidates = scan_hosts(
            &[("FM1", inventory.to_str().unwrap())],
            ScanKind::Inventory,
            "",
            "",
        )
        .unwrap();
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
        let rows: Vec<(&str, Option<&str>)> = candidates
            .iter()
            .map(|c| (c.name.as_str(), c.resolution.as_deref()))
            .collect();
        // The folder name is reported exactly as it is on disk (the dialog shows
        // it verbatim), and the version folders come back sorted.
        assert_eq!(
            rows,
            [
                ("21msp016-30", Some("1.9, 2.0, 3.5")),
                ("22CP011-08", Some("2.0")),
                ("M02", None)
            ]
        );
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
        let candidates = scan_hosts(
            &[("FM1", share.to_str().unwrap())],
            ScanKind::Repository,
            "",
            "",
        )
        .unwrap();
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
        if path.is_dir() && canonical_model_name(&entry.file_name().to_string_lossy()) == requested
        {
            return Ok(path);
        }
    }
    Err(format!(
        "Model {model_name} was not found under {}",
        root.display()
    ))
}

#[cfg(test)]
mod canonical_tests {
    use super::*;

    #[test]
    fn canonical_names_fold_case_and_variant_suffix() {
        assert_eq!(canonical_model_name("2an0859f01-00"), "2AN0859F01");
        assert_eq!(canonical_model_name("2AN0859F01"), "2AN0859F01");
        // trimming is the frontend's job - the Rust side keeps the original behavior
        assert_eq!(canonical_model_name(" 2AN0859F01 "), " 2AN0859F01 ");
    }
}

/// UNC paths (\\\\server\\share\\...) may need a logon before any file access.
/// The stored credentials (machines.json) are applied with `net use` on the
/// IPC$ share of every involved server. A blank password is legitimate - device
/// accounts like `pixel` often have none - so the password is passed as-is (an
/// empty argument becomes `""`, which logs on with a null password instead of
/// prompting); stdin is closed, so `net use` can never hang on a prompt.
#[cfg(windows)]
pub fn ensure_unc_credentials(
    paths: &[&str],
    username: &str,
    password: &str,
) -> Result<(), String> {
    let mut servers = Vec::new();
    for server in paths.iter().filter_map(|path| unc_server(path)) {
        if !servers.contains(&server) {
            servers.push(server);
        }
    }
    if servers.is_empty() {
        return Ok(());
    }
    let username = username.trim();
    let password = password.trim();
    if username.is_empty() && password.is_empty() {
        return Ok(());
    }
    if username.is_empty() {
        return Err("Network credentials: a password is set but the username is empty.".into());
    }
    for server in servers {
        connect_server(&server, password, username).map_err(|error| error)?;
    }
    Ok(())
}

#[cfg(windows)]
fn unc_server(path: &str) -> Option<String> {
    let path = path.trim();
    let rest = if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        rest
    } else {
        // Canonical Windows drive paths (\\?\C:\...) are local, not UNC.
        if path.starts_with(r"\\?\") || path.starts_with(r"\\.\") {
            return None;
        }
        path.strip_prefix(r"\\")?
    };
    let server = rest
        .split(['\\', '/'])
        .next()
        .filter(|server| !server.is_empty())?;
    Some(format!(r"\\{server}"))
}

#[cfg(windows)]
fn connect_server(server: &str, password: &str, username: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("net")
        .args([
            "use",
            &format!("{server}\\IPC$"),
            password,
            &format!("/user:{username}"),
            "/persistent:no",
        ])
        .stdin(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Cannot run net use for {server}: {error}"))?;
    let message = net_message(&output);
    if output.status.success() {
        return Ok(());
    }
    // System error 1219: the server already has a session under a different user
    // name (e.g. the one Explorer opened via Win+R). That session serves the
    // file access, so reuse it instead of fighting over the credentials.
    if message_codes(&message).contains(&"1219") {
        return Ok(());
    }
    Err(friendly_logon_error(server, &message))
}

/// net.exe writes localized text in the system codepage - decode lossily and
/// keep only the ASCII part (the "System error <n>" number survives any locale).
#[cfg(windows)]
fn net_message(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text: String = format!("{stderr} {stdout}")
        .chars()
        .filter(|c| c.is_ascii())
        .collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The decimal error codes mentioned in a net.exe message ("System error 1219 ...").
#[cfg(windows)]
fn message_codes(message: &str) -> Vec<&str> {
    message
        .split(|c: char| !c.is_ascii_digit())
        .filter(|token| !token.is_empty())
        .collect()
}

#[cfg(windows)]
fn friendly_logon_error(server: &str, raw: &str) -> String {
    let codes = message_codes(raw);
    let reason = if codes.contains(&"1326") {
        "logon failure - wrong user name or password".to_string()
    } else if codes.contains(&"1219") {
        "the server already has a session under another user name".to_string()
    } else if codes.contains(&"53") {
        "the server was not found on the network".to_string()
    } else if codes.contains(&"67") {
        "the network share was not found".to_string()
    } else if codes.contains(&"5") {
        "access denied".to_string()
    } else if codes.contains(&"85") {
        "a connection is already established".to_string()
    } else if raw.is_empty() {
        "unknown error".to_string()
    } else {
        raw.to_string()
    };
    format!("Network logon for {server} failed: {reason} - check the network credentials in Machine Configuration.")
}

#[cfg(not(windows))]
pub fn ensure_unc_credentials(
    _paths: &[&str],
    _username: &str,
    _password: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, windows))]
mod credential_tests {
    use super::*;

    #[test]
    fn extracts_error_codes_from_localized_messages() {
        // Korean net.exe output ("System error 1219 has occurred...") survives as ASCII codes
        let output = std::process::Output {
            status: exit_failure(),
            stdout: "ýýýý 1219 ýýýýýýýýý.\r\n".into(),
            stderr: vec![],
        };
        let message = net_message(&output);
        assert!(message_codes(&message).contains(&"1219"), "{message}");
        assert!(
            !message.contains('ý'),
            "mojibake must be stripped: {message}"
        );
    }

    #[test]
    fn unc_paths_exclude_canonical_local_drive_paths() {
        assert_eq!(unc_server(r"C:\reference\FM1"), None);
        assert_eq!(unc_server(r"\\?\C:\reference\FM1"), None);
        assert_eq!(unc_server(r"\\server\share"), Some(r"\\server".into()));
        assert_eq!(
            unc_server(r"\\?\UNC\server\share"),
            Some(r"\\server".into())
        );
    }

    #[test]
    fn friendly_messages_by_code() {
        assert!(
            friendly_logon_error("\\s", "System error 1326 has occurred")
                .contains("wrong user name or password")
        );
        assert!(friendly_logon_error("\\s", "System error 53 has occurred")
            .contains("not found on the network"));
        assert!(friendly_logon_error("\\s", "").contains("unknown error"));
        assert!(
            friendly_logon_error("\\s", "System error 1219 has occurred")
                .contains("another user name")
        );
    }

    fn exit_failure() -> std::process::ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(1)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct MachinePaths {
    pub id: String,
    pub name: String,
    pub fm1_path: String,
    pub fm2_path: String,
    pub bm_path: String,
    pub main_ip: String,
    pub fm1_repository_path: String,
    pub fm2_repository_path: String,
    pub bm_repository_path: String,
    pub username: String,
    pub password: String,
}

fn reference_at(root: &Path) -> Option<MachinePaths> {
    if !root.join("FM1/PxInventory").is_dir() {
        return None;
    }
    let root = fs::canonicalize(root).ok()?;
    let host_path =
        |host: &str, folder: &str| root.join(host).join(folder).to_string_lossy().into_owned();
    Some(MachinePaths {
        id: "reference".into(),
        name: "Reference (offline)".into(),
        fm1_path: host_path("FM1", "PxInventory"),
        fm2_path: host_path("FM2", "PxInventory"),
        bm_path: host_path("BM", "PxInventory"),
        fm1_repository_path: host_path("FM1", "PxRepository"),
        fm2_repository_path: host_path("FM2", "PxRepository"),
        bm_repository_path: host_path("BM", "PxRepository"),
        ..MachinePaths::default()
    })
}

#[tauri::command]
pub fn reference_machine() -> Option<MachinePaths> {
    let mut roots = Vec::new();
    if let Some(root) = std::env::var_os("AFVI_REFERENCE_DIR").filter(|root| !root.is_empty()) {
        roots.push(PathBuf::from(root));
    }
    if let Some(parent) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        roots.push(parent.join("reference"));
    }
    roots.push(PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../reference"
    )));
    roots.iter().find_map(|root| reference_at(root))
}

#[cfg(test)]
mod reference_tests {
    use super::*;

    #[test]
    fn reference_requires_inventory_but_not_images() {
        let root = tests::temp_dir("reference");
        assert!(reference_at(&root).is_none());
        fs::create_dir_all(root.join("FM1/PxInventory")).unwrap();
        let machine = reference_at(&root).unwrap();
        assert_eq!(machine.id, "reference");
        assert!(machine.username.is_empty());
        assert!(!Path::new(&machine.fm1_repository_path).exists());
        assert!(ensure_unc_credentials(&[&machine.fm1_path], "", "unused").is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}

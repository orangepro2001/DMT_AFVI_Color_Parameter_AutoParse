use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub mod export_excel;
pub mod storage;

use storage::{migrate_store, open_store, persist_storage_config, read_storage_config, MigrationReport, StorageConfig, StoreCache};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
struct ModelCandidate {
    name: String,
    hosts: Vec<String>,
}

#[derive(Serialize)]
struct HostSources {
    model_name: String,
    host: String,
    side: String,
    light_spec_xml: String,
    inspection_specs: Vec<InspectionSource>,
    spec_parameter_xml: Option<String>,
    spec_tree_node_xml: Option<String>,
}

#[derive(Deserialize)]
struct MachinePaths {
    fm1_path: String,
    fm2_path: String,
    bm_path: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
}

/// UNC paths (\\\\server\\share\\...) may need a logon before any file access.
/// The stored credentials (machines.json) are applied with `net use` on the
/// IPC$ share of every involved server. A blank password is legitimate - device
/// accounts like `pixel` often have none - so the password is passed as-is (an
/// empty argument becomes `""`, which logs on with a null password instead of
/// prompting); stdin is closed, so `net use` can never hang on a prompt.
#[cfg(windows)]
fn ensure_network_credentials(machine: &MachinePaths) -> Result<(), String> {
    ensure_unc_credentials(&[&machine.fm1_path, &machine.fm2_path, &machine.bm_path], &machine.username, &machine.password)
}

/// Apply the stored credentials to the IPC$ share of every UNC server in the
/// given paths (deduplicated). Shared by MachinePaths and CopyEndpoint logons.
#[cfg(windows)]
fn ensure_unc_credentials(paths: &[&str], username: &str, password: &str) -> Result<(), String> {
    let username = username.trim();
    let password = password.trim();
    if username.is_empty() && password.is_empty() {
        return Ok(());
    }
    if username.is_empty() {
        return Err("Network credentials: a password is set but the username is empty.".into());
    }
    let mut servers: Vec<String> = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if let Some(rest) = trimmed.strip_prefix("\\\\") {
            let end = rest.find(['\\', '/']).unwrap_or(rest.len());
            let server = format!("\\\\{}", &rest[..end]);
            if !servers.contains(&server) {
                servers.push(server);
            }
        }
    }
    for server in servers {
        connect_server(&server, password, username).map_err(|error| error)?;
    }
    Ok(())
}

#[cfg(windows)]
fn connect_server(server: &str, password: &str, username: &str) -> Result<(), String> {
    let output = std::process::Command::new("net")
        .args(["use", &format!("{server}\\IPC$"), password, &format!("/user:{username}"), "/persistent:no"])
        .stdin(std::process::Stdio::null())
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
    let text: String = format!("{stderr} {stdout}").chars().filter(|c| c.is_ascii()).collect();
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
fn ensure_network_credentials(_machine: &MachinePaths) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn ensure_unc_credentials(_paths: &[&str], _username: &str, _password: &str) -> Result<(), String> {
    Ok(())
}

#[derive(Serialize)]
struct InspectionSource {
    light: String,
    xml: String,
}

fn canonical_model_name(name: &str) -> String {
    name.trim_end_matches("-00").to_ascii_uppercase()
}

fn find_model_dir(root: &Path, model_name: &str) -> Result<PathBuf, String> {
    let requested = canonical_model_name(model_name);
    let entries = fs::read_dir(root).map_err(|error| format!("Cannot read {}: {error}", root.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && canonical_model_name(&entry.file_name().to_string_lossy()) == requested {
            return Ok(path);
        }
    }
    Err(format!("Model {model_name} was not found under {}", root.display()))
}

fn read_named_file(directory: &Path, expected_name: &str) -> Result<String, String> {
    let entries = fs::read_dir(directory).map_err(|error| format!("Cannot read {}: {error}", directory.display()))?;
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case(expected_name) {
            return fs::read_to_string(entry.path()).map_err(|error| format!("Cannot read {}: {error}", entry.path().display()));
        }
    }
    Err(format!("{expected_name} was not found in {}", directory.display()))
}

fn optional_root_file(base_path: &Path, name: &str) -> Option<String> {
    fs::read_to_string(base_path.join(name)).ok()
}

fn models_in_host(base: &Path) -> Result<Vec<String>, String> {
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

// Network scans run as async commands on the worker pool: a slow share (e.g.
// over Tailscale) must never occupy the main thread or the whole UI freezes.
// The per-host scans additionally run in parallel - SMB round trips dominate
// on high-latency links, so 3 hosts in series would triple the wait.

#[tauri::command]
async fn scan_machine_models(machine: MachinePaths) -> Result<Vec<ModelCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let hosts = [("FM1", machine.fm1_path), ("FM2", machine.fm2_path), ("BM", machine.bm_path)];
        let scanned: Vec<Result<(String, Vec<String>), String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = hosts
                .iter()
                .map(|(host, path)| scope.spawn(move || models_in_host(Path::new(path)).map(|models| ((*host).to_string(), models))))
                .collect();
            handles.into_iter().map(|handle| handle.join().unwrap_or_else(|_| Err("Scan thread panicked".to_string()))).collect()
        });
        let mut discovered: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
        for result in scanned {
            let (host, models) = result?;
            for model in models {
                discovered.entry(model).or_default().push(host.clone());
            }
        }
        Ok(discovered.into_iter().map(|(name, hosts)| ModelCandidate { name, hosts }).collect())
    })
    .await
    .map_err(|error| format!("Scan task failed: {error}"))?
}

fn collect_host_sources(base: &Path, host: &str, model_name: &str) -> Result<HostSources, String> {
    let light_dir = find_model_dir(&base.join("LIGHT_SPEC"), &model_name)?;
    let inspect_dir = find_model_dir(&base.join("INSPECT_SPEC"), &model_name)?;
    let side = if host.eq_ignore_ascii_case("BM") { "BOTTOM" } else { "TOP" };

    let light_spec_xml = read_named_file(&light_dir, "LightSpec.xml")?;
    let mut inspection_specs = Vec::new();
    let side_dir = inspect_dir.join(side);
    for light in ["LIGHT0", "LIGHT1", "LIGHT2"] {
        let path = side_dir.join(light);
        if path.exists() {
            inspection_specs.push(InspectionSource {
                light: light.into(),
                xml: read_named_file(&path, "InspectionSpec.xml")?,
            });
        }
    }

    if inspection_specs.is_empty() {
        return Err(format!("No InspectionSpec.xml files found under {}", side_dir.display()));
    }

    Ok(HostSources {
        model_name: canonical_model_name(&model_name),
        host: host.into(),
        side: side.into(),
        light_spec_xml,
        inspection_specs,
        spec_parameter_xml: optional_root_file(&base, "SpecParameter.xml"),
        spec_tree_node_xml: optional_root_file(&base, "SpecTreeNode.xml"),
    })
}

#[tauri::command]
async fn collect_machine_sources(machine: MachinePaths, model_name: String) -> Result<Vec<HostSources>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let hosts = [("FM1", machine.fm1_path), ("FM2", machine.fm2_path), ("BM", machine.bm_path)];
        let collected: Vec<Result<HostSources, String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = hosts
                .iter()
                .map(|(host, path)| {
                    let model_name = model_name.clone();
                    scope.spawn(move || collect_host_sources(Path::new(path), host, &model_name))
                })
                .collect();
            handles.into_iter().map(|handle| handle.join().unwrap_or_else(|_| Err("Collection thread panicked".to_string()))).collect()
        });
        collected.into_iter().collect()
    })
    .await
    .map_err(|error| format!("Collection task failed: {error}"))?
}

// ---- Model Copier: move a model's LIGHT_SPEC / INSPECT_SPEC / PxRepository
// folders between Vision PCs on the flat machine network. Deleting on the
// target side is confined to the folders that canonical-match the model. ----

#[derive(Deserialize)]
struct CopyEndpoint {
    host: String,
    inventory_path: String,
    #[serde(default)]
    repository_path: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
}

#[derive(Serialize, Debug)]
struct CopyPlanEntry {
    /// Which spec root the folder lives in ("LIGHT_SPEC", "INSPECT_SPEC" or "PxRepository").
    kind: String,
    source: Option<String>,
    target: String,
    exists_on_target: bool,
}

#[derive(Serialize, Debug)]
struct CopyPlan {
    model_name: String,
    entries: Vec<CopyPlanEntry>,
}

#[derive(Serialize)]
struct CopyResultEntry {
    kind: String,
    target: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Serialize)]
struct CopyReport {
    model_name: String,
    entries: Vec<CopyResultEntry>,
}

const SPEC_ROOTS: [&str; 2] = ["LIGHT_SPEC", "INSPECT_SPEC"];

fn endpoint_credentials(endpoint: &CopyEndpoint) -> Result<(), String> {
    ensure_unc_credentials(
        &[&endpoint.inventory_path, &endpoint.repository_path],
        &endpoint.username,
        &endpoint.password,
    )
}

/// Resolve the three folders a model occupies on one endpoint. Missing folders
/// are simply absent from the plan - e.g. a repository share with no folder for
/// this model, or an endpoint without a configured PxRepository share at all.
fn endpoint_model_folders(endpoint: &CopyEndpoint, model_name: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let mut found = Vec::new();
    for root in SPEC_ROOTS {
        let base = Path::new(&endpoint.inventory_path).join(root);
        if let Ok(dir) = find_model_dir(&base, model_name) {
            found.push((root.to_string(), dir));
        }
    }
    let repository = endpoint.repository_path.trim();
    if !repository.is_empty() {
        if let Ok(dir) = find_model_dir(Path::new(repository), model_name) {
            found.push(("PxRepository".to_string(), dir));
        }
    }
    Ok(found)
}

/// The target path for a copied folder. `name` is kept verbatim from the source
/// (e.g. `2AN0859F01`, `2AN0859F01-00`) so the machine sees identical folder names.
fn target_folder_path(endpoint: &CopyEndpoint, kind: &str, name: &str) -> PathBuf {
    if kind == "PxRepository" {
        Path::new(&endpoint.repository_path).join(name)
    } else {
        Path::new(&endpoint.inventory_path).join(kind).join(name)
    }
}

/// Hard guard before any delete: the path must be exactly one model folder
/// directly under the endpoint's spec root (or repository root), matching the
/// requested model. This is what makes it impossible to wipe the whole
/// LIGHT_SPEC/INSPECT_SPEC parent or an unrelated model.
fn assert_deletable(path: &Path, endpoint: &CopyEndpoint, kind: &str, model_name: &str) -> Result<(), String> {
    let expected_parent = if kind == "PxRepository" {
        PathBuf::from(endpoint.repository_path.trim())
    } else {
        Path::new(&endpoint.inventory_path).join(kind)
    };
    if path.parent() != Some(expected_parent.as_path()) {
        return Err(format!("Refusing to touch {}: not a model folder directly under {}", path.display(), expected_parent.display()));
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if canonical_model_name(&name) != canonical_model_name(model_name) {
        return Err(format!("Refusing to touch {}: does not match model {model_name}", path.display()));
    }
    Ok(())
}

fn build_copy_plan(source: &CopyEndpoint, target: &CopyEndpoint, model_name: &str) -> Result<CopyPlan, String> {
    let model = canonical_model_name(model_name);
    if model.is_empty() {
        return Err("A model name is required.".into());
    }
    let same_inventory = source.inventory_path.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(target.inventory_path.trim_end_matches(['\\', '/']));
    if same_inventory {
        return Err(format!("Source and target Vision PC are the same ({}/{}).", source.host, target.host));
    }
    endpoint_credentials(source)?;
    endpoint_credentials(target)?;

    let source_folders = endpoint_model_folders(source, &model)?;
    if source_folders.is_empty() {
        return Err(format!("Model {model} was not found on {} ({}) - nothing to copy.", source.host, source.inventory_path));
    }
    let target_folders = endpoint_model_folders(target, &model)?;

    let mut entries = Vec::new();
    for (kind, source_dir) in &source_folders {
        let name = source_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let target_path = target_folder_path(target, kind, &name);
        entries.push(CopyPlanEntry {
            kind: kind.clone(),
            source: Some(source_dir.display().to_string()),
            target: target_path.display().to_string(),
            exists_on_target: target_folders.iter().any(|(k, _)| k == kind),
        });
    }
    // Kinds present on the target but not the source still get deleted on copy
    // (e.g. the source has no repository share configured) so the target ends
    // up with exactly the source's model - but only if the target knows the model.
    for (kind, target_dir) in &target_folders {
        if !source_folders.iter().any(|(k, _)| k == kind) {
            entries.push(CopyPlanEntry {
                kind: kind.clone(),
                source: None,
                target: target_dir.display().to_string(),
                exists_on_target: true,
            });
        }
    }
    Ok(CopyPlan { model_name: model, entries })
}

#[tauri::command]
async fn preview_model_copy(source: CopyEndpoint, target: CopyEndpoint, model_name: String) -> Result<CopyPlan, String> {
    tauri::async_runtime::spawn_blocking(move || build_copy_plan(&source, &target, &model_name))
        .await
        .map_err(|error| format!("Preview task failed: {error}"))?
}

#[tauri::command]
async fn copy_model_between_hosts(source: CopyEndpoint, target: CopyEndpoint, model_name: String, confirmed: bool) -> Result<CopyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !confirmed {
            return Err("The copy was not confirmed - nothing was changed.".into());
        }
        // Re-derive the plan instead of trusting the preview: the shares may
        // have changed between preview and confirmation.
        let plan = build_copy_plan(&source, &target, &model_name)?;
        let mut report = CopyReport { model_name: plan.model_name.clone(), entries: Vec::new() };
        for entry in &plan.entries {
            let target_path = PathBuf::from(&entry.target);
            let result = (|| -> Result<(), String> {
                assert_deletable(&target_path, &target, &entry.kind, &plan.model_name)?;
                if target_path.exists() {
                    fs::remove_dir_all(&target_path).map_err(|error| format!("Cannot delete {}: {error}", target_path.display()))?;
                }
                if let Some(source_dir) = &entry.source {
                    copy_dir_recursive(Path::new(source_dir), &target_path)?;
                }
                Ok(())
            })();
            let ok = result.is_ok();
            report.entries.push(CopyResultEntry {
                kind: entry.kind.clone(),
                target: entry.target.clone(),
                ok,
                error: result.err(),
            });
            if !ok {
                // Stop at the first failure; what was already copied stays and
                // the report tells the operator exactly where it broke off.
                break;
            }
        }
        Ok(report)
    })
    .await
    .map_err(|error| format!("Copy task failed: {error}"))?
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| format!("Cannot create {}: {error}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|error| format!("Cannot read {}: {error}", src.display()))? {
        let entry = entry.map_err(|error| format!("Cannot read {}: {error}", src.display()))?;
        let to = dst.join(entry.file_name());
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            copy_dir_recursive(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to).map_err(|error| format!("Cannot copy {}: {error}", entry.path().display()))?;
        }
    }
    Ok(())
}

// ---- document database commands (backend selected by storage.json) ----
// These run as async commands on the worker pool: a MongoDB call is a network
// round trip (seconds when the cluster is slow) and must never occupy the main
// thread - sync commands freeze the whole UI.

async fn run_store_blocking<T, F>(app: AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&dyn storage::DocumentStore) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let store = open_store(&app)?;
        task(store.as_ref())
    })
    .await
    .map_err(|error| format!("Storage task failed: {error}"))?
}

#[tauri::command]
async fn load_local_file(app: AppHandle, filename: String) -> Result<String, String> {
    run_store_blocking(app, move |store| {
        store
            .read(&filename)?
            .ok_or_else(|| "Document was not found in the database.".into())
    })
    .await
}

#[tauri::command]
async fn save_local_file(app: AppHandle, filename: String, content: String) -> Result<(), String> {
    run_store_blocking(app, move |store| store.write(&filename, &content)).await
}

#[tauri::command]
async fn delete_local_file(app: AppHandle, filename: String) -> Result<(), String> {
    run_store_blocking(app, move |store| store.delete(&filename)).await
}

#[tauri::command]
async fn list_local_files(app: AppHandle, prefix: String) -> Result<Vec<String>, String> {
    run_store_blocking(app, move |store| store.list(&prefix)).await
}

#[tauri::command]
fn get_storage_config(app: AppHandle) -> Result<StorageConfig, String> {
    read_storage_config(&app)
}

#[tauri::command]
fn set_storage_config(app: AppHandle, config: StorageConfig) -> Result<(), String> {
    match config.backend.as_str() {
        "local" | "mongodb" | "firestore" => {
            persist_storage_config(&app, &config)?;
            // the cached store still points at the previous backend
            let cache = app.state::<StoreCache>();
            *cache.0.lock().map_err(|_| "Store cache is poisoned".to_string())? = None;
            Ok(())
        }
        _ => Err("Backend must be \"local\", \"mongodb\" or \"firestore\".".into()),
    }
}

#[tauri::command]
async fn test_mongo_connection(app: AppHandle, url: Option<String>, database: Option<String>) -> Result<String, String> {
    let (url, database) = resolve_mongo_target(&app, url, database)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = storage::MongoDocumentStore::new(&url, &database)?;
        let count = store.count_documents()?;
        Ok(format!("Connected to '{database}'. The collection currently holds {count} documents."))
    })
    .await
    .map_err(|error| format!("Connection task failed: {error}"))?
}

#[tauri::command]
async fn migrate_local_to_mongo(app: AppHandle, url: Option<String>, database: Option<String>) -> Result<MigrationReport, String> {
    let (url, database) = resolve_mongo_target(&app, url, database)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let local = storage::JsonFileStore::new(root);
        let mongo = storage::MongoDocumentStore::new(&url, &database)?;
        migrate_store(&local, &mongo)
    })
    .await
    .map_err(|error| format!("Migration task failed: {error}"))?
}

/// Stored MongoDB settings, overridable per-call (the Settings UI passes the
/// form fields so they can be tested before being saved).
fn resolve_mongo_target(app: &AppHandle, url: Option<String>, database: Option<String>) -> Result<(String, String), String> {
    let config = read_storage_config(app)?;
    let settings = config.mongodb.unwrap_or_default();
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()).unwrap_or(settings.url);
    let database = database.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).unwrap_or(settings.database);
    if url.is_empty() {
        return Err("No MongoDB connection string is configured.".into());
    }
    if database.is_empty() {
        return Err("No MongoDB database name is configured.".into());
    }
    Ok((url, database))
}

// ---- Firestore (Firebase): the project and its web API key are hardcoded in
// storage.rs, so unlike MongoDB these commands take no settings arguments. ----

#[tauri::command]
async fn test_firestore_connection() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = storage::FirestoreStore::new(
            storage::FIRESTORE_PROJECT_ID,
            storage::FIRESTORE_DATABASE_ID,
            storage::FIRESTORE_API_KEY,
        )?;
        let count = store.count_documents()?;
        Ok(format!(
            "Connected to project '{}'. The 'documents' collection currently holds {} documents.",
            storage::FIRESTORE_PROJECT_ID,
            count
        ))
    })
    .await
    .map_err(|error| format!("Connection task failed: {error}"))?
}

#[tauri::command]
async fn migrate_local_to_firestore(app: AppHandle) -> Result<MigrationReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let local = storage::JsonFileStore::new(root);
        let firestore = storage::FirestoreStore::new(
            storage::FIRESTORE_PROJECT_ID,
            storage::FIRESTORE_DATABASE_ID,
            storage::FIRESTORE_API_KEY,
        )?;
        migrate_store(&local, &firestore)
    })
    .await
    .map_err(|error| format!("Migration task failed: {error}"))?
}

/// Fill the blank Parameter_Template.xlsx with the stored model's values and
/// save it as `<machine>_<model>.xlsx` under the configured export path.
#[tauri::command]
async fn export_parameter_excel(
    app: AppHandle,
    machine_id: String,
    model_name: String,
    machine_name: String,
    export_path: String,
    template_path: String,
) -> Result<export_excel::ExportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = open_store(&app)?;
        let model_key = model_name.trim().to_ascii_uppercase().trim_end_matches("-00").to_string();
        // the record may live under another machine id (the machine was re-added
        // after an update and got a new id) - fall back to a by-name search
        let exact_key = format!("models/{machine_id}/{model_key}.json");
        let (record_json, record_key) = match store.read(&exact_key)? {
            Some(json) => (json, exact_key),
            None => {
                let suffix = format!("/{model_key}.json");
                let found = store
                    .list("models/")?
                    .into_iter()
                    .find(|key| key.to_ascii_uppercase().ends_with(&suffix.to_ascii_uppercase()))
                    .ok_or_else(|| format!("No stored data for {model_name} - collect the model first."))?;
                let json = store.read(&found)?.unwrap_or_default();
                (json, found)
            }
        };
        let machine_folder = record_key.split('/').nth(1).unwrap_or(machine_id.as_str()).to_string();
        let gv_json = store
            .read(&format!("ui/gv/{machine_folder}/{model_key}.json"))?
            .unwrap_or_else(|| "{}".to_string());
        let template_bytes = fs::read(template_path.trim())
            .map_err(|error| format!("Cannot read the template workbook: {error}"))?;
        export_excel::run_export(export_excel::ExportArgs {
            record_json: &record_json,
            gv_json: &gv_json,
            template_bytes: &template_bytes,
            export_path: export_path.trim(),
            machine_name: &machine_name,
        })
    })
    .await
    .map_err(|error| format!("Export task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_machine_models,
            collect_machine_sources,
            preview_model_copy,
            copy_model_between_hosts,
            load_local_file,
            save_local_file,
            delete_local_file,
            list_local_files,
            get_storage_config,
            set_storage_config,
            test_mongo_connection,
            migrate_local_to_mongo,
            test_firestore_connection,
            migrate_local_to_firestore,
            export_parameter_excel
        ])
        .setup(|app| {
            app.manage(StoreCache(std::sync::Mutex::new(None)));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn extracts_error_codes_from_localized_messages() {
        // Korean net.exe output ("System error 1219 has occurred...") survives as ASCII codes
        let output = std::process::Output { status: exit_failure(), stdout: "ýýýý 1219 ýýýýýýýýý.\r\n".into(), stderr: vec![] };
        let message = net_message(&output);
        assert!(message_codes(&message).contains(&"1219"), "{message}");
        assert!(!message.contains('ý'), "mojibake must be stripped: {message}");
    }

    #[test]
    fn friendly_messages_by_code() {
        assert!(friendly_logon_error("\\s", "System error 1326 has occurred").contains("wrong user name or password"));
        assert!(friendly_logon_error("\\s", "System error 53 has occurred").contains("not found on the network"));
        assert!(friendly_logon_error("\\s", "").contains("unknown error"));
        assert!(friendly_logon_error("\\s", "System error 1219 has occurred").contains("another user name"));
    }

    fn exit_failure() -> std::process::ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(1)
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("afvi_copier_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn endpoint(inventory: &Path, repository: &Path, host: &str) -> CopyEndpoint {
        CopyEndpoint {
            host: host.into(),
            inventory_path: inventory.display().to_string(),
            repository_path: repository.display().to_string(),
            username: String::new(),
            password: String::new(),
        }
    }

    fn write_model(inventory: &Path, repository: Option<&Path>, folder_light: &str, folder_inspect: &str, model_file: &str) {
        let light = inventory.join("LIGHT_SPEC").join(folder_light);
        let inspect = inventory.join("INSPECT_SPEC").join(folder_inspect).join("TOP").join("LIGHT0");
        fs::create_dir_all(&light).unwrap();
        fs::create_dir_all(&inspect).unwrap();
        fs::write(light.join("LightSpec.xml"), format!("<light name='{model_file}'/>")).unwrap();
        fs::write(inspect.join("InspectionSpec.xml"), format!("<inspect name='{model_file}'/>")).unwrap();
        if let Some(repo) = repository {
            let dir = repo.join(folder_light);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("gerber.gbr"), model_file).unwrap();
        }
    }

    #[test]
    fn copy_plan_matches_model_folders_case_insensitively() {
        let base = temp_dir("plan");
        let source_inv = base.join("src_inv");
        let source_repo = base.join("src_repo");
        let target_inv = base.join("dst_inv");
        let target_repo = base.join("dst_repo");
        write_model(&source_inv, Some(&source_repo), "2AN0859F01", "2AN0859F01-00", "src");
        write_model(&target_inv, Some(&target_repo), "2an0859f01", "2AN0859F01-00", "old");

        let source = endpoint(&source_inv, &source_repo, "FM1");
        let target = endpoint(&target_inv, &target_repo, "FM2");
        let plan = build_copy_plan(&source, &target, "2AN0859F01").unwrap();

        assert_eq!(plan.model_name, "2AN0859F01");
        let kinds: Vec<&str> = plan.entries.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["LIGHT_SPEC", "INSPECT_SPEC", "PxRepository"]);
        let light = &plan.entries[0];
        // the source folder name is carried over verbatim
        assert!(light.target.ends_with("\\LIGHT_SPEC\\2AN0859F01"), "{}", light.target);
        assert!(light.exists_on_target);
    }

    #[test]
    fn copy_plan_rejects_same_inventory_and_unknown_model() {
        let base = temp_dir("reject");
        let inv = base.join("inv");
        let repo = base.join("repo");
        write_model(&inv, None, "M01", "M01-00", "x");
        let a = endpoint(&inv, &repo, "FM1");
        let b = endpoint(&inv, &repo, "FM2");

        let same = build_copy_plan(&a, &b, "M01").unwrap_err();
        assert!(same.contains("same"), "{same}");

        let other = endpoint(&base.join("other_inv"), &base.join("other_repo"), "FM2");
        let missing = build_copy_plan(&a, &other, "NOPE").unwrap_err();
        assert!(missing.contains("not found"), "{missing}");
    }
    #[test]
    fn executed_copy_replaces_target_folders_and_keeps_source_names() {
        let base = temp_dir("exec");
        let source_inv = base.join("src_inv");
        let source_repo = base.join("src_repo");
        let target_inv = base.join("dst_inv");
        let target_repo = base.join("dst_repo");
        write_model(&source_inv, Some(&source_repo), "2AN0859F01", "2AN0859F01-00", "new");
        write_model(&target_inv, Some(&target_repo), "2AN0859F01", "2AN0859F01-00", "old");

        let source = endpoint(&source_inv, &source_repo, "FM1");
        let target = endpoint(&target_inv, &target_repo, "FM2");
        let plan = build_copy_plan(&source, &target, "2AN0859F01").unwrap();
        for entry in &plan.entries {
            let target_path = PathBuf::from(&entry.target);
            assert_deletable(&target_path, &target, &entry.kind, &plan.model_name).unwrap();
            if target_path.exists() {
                fs::remove_dir_all(&target_path).unwrap();
            }
            if let Some(src) = &entry.source {
                copy_dir_recursive(Path::new(src), &target_path).unwrap();
            }
        }

        let copied = fs::read_to_string(target_inv.join("LIGHT_SPEC").join("2AN0859F01").join("LightSpec.xml")).unwrap();
        assert!(copied.contains("new"), "{copied}");
        let repo = fs::read_to_string(target_repo.join("2AN0859F01").join("gerber.gbr")).unwrap();
        assert_eq!(repo, "new");
    }

    #[test]
    fn delete_guard_blocks_everything_outside_the_model_folder() {
        let base = temp_dir("guard");
        let inv = base.join("inv");
        let repo = base.join("repo");
        let endpoint = endpoint(&inv, &repo, "FM1");

        // the spec parent itself must never pass
        let parent = inv.join("LIGHT_SPEC");
        assert!(assert_deletable(&parent, &endpoint, "LIGHT_SPEC", "M01").is_err());
        // a sibling model must never pass
        let sibling = inv.join("LIGHT_SPEC").join("OTHER01");
        assert!(assert_deletable(&sibling, &endpoint, "LIGHT_SPEC", "M01").is_err());
        // a folder outside the spec root must never pass
        let stray = inv.join("M01");
        assert!(assert_deletable(&stray, &endpoint, "LIGHT_SPEC", "M01").is_err());
        // the correct model folder passes
        let ok = inv.join("LIGHT_SPEC").join("M01-00");
        assert!(assert_deletable(&ok, &endpoint, "LIGHT_SPEC", "M01").is_ok());
    }

    #[test]
    fn unconfirmed_copy_changes_nothing() {
        let base = temp_dir("unconfirmed");
        let source_inv = base.join("src_inv");
        let target_inv = base.join("dst_inv");
        write_model(&source_inv, None, "M01", "M01-00", "x");
        let source = endpoint(&source_inv, &base.join("src_repo"), "FM1");
        let target = endpoint(&target_inv, &base.join("dst_repo"), "FM2");
        // build_copy_plan itself runs, but the command layer refuses without `confirmed`;
        // that refusal is checked before any filesystem work (see copy_model_between_hosts).
        assert!(build_copy_plan(&source, &target, "M01").is_ok());
        assert!(!target_inv.join("LIGHT_SPEC").exists());
    }
}

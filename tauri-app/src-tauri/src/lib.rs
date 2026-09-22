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
    let username = machine.username.trim();
    let password = machine.password.trim();
    if username.is_empty() && password.is_empty() {
        return Ok(());
    }
    if username.is_empty() {
        return Err("Network credentials: a password is set but the username is empty.".into());
    }
    let mut servers: Vec<String> = Vec::new();
    for path in [&machine.fm1_path, &machine.fm2_path, &machine.bm_path] {
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
    let attempt = || {
        std::process::Command::new("net")
            .args(["use", &format!("{server}\\IPC$"), password, &format!("/user:{username}"), "/persistent:no"])
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|error| format!("Cannot run net use for {server}: {error}"))
    };
    let output = attempt()?;
    if output.status.success() {
        return Ok(());
    }
    let message = {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() { String::from_utf8_lossy(&output.stdout).trim().to_string() } else { stderr }
    };
    // System error 1219: the server already has a connection under a different
    // user name - drop it and log on once more with ours.
    if message.contains("1219") {
        let _ = std::process::Command::new("net")
            .args(["use", &format!("{server}\\IPC$"), "/delete"])
            .stdin(std::process::Stdio::null())
            .output();
        let retry = attempt()?;
        if retry.status.success() {
            return Ok(());
        }
        let retry_message = String::from_utf8_lossy(&retry.stderr).trim().to_string();
        let retry_message = if retry_message.is_empty() { String::from_utf8_lossy(&retry.stdout).trim().to_string() } else { retry_message };
        return Err(format!("Network logon for {server} failed: {retry_message}"));
    }
    Err(format!("Network logon for {server} failed: {message}"))
}

#[cfg(not(windows))]
fn ensure_network_credentials(_machine: &MachinePaths) -> Result<(), String> {
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

#[tauri::command]
fn scan_machine_models(machine: MachinePaths) -> Result<Vec<ModelCandidate>, String> {
    ensure_network_credentials(&machine)?;
    let mut discovered: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for (host, path) in [("FM1", machine.fm1_path), ("FM2", machine.fm2_path), ("BM", machine.bm_path)] {
        for model in models_in_host(Path::new(&path))? {
            discovered.entry(model).or_default().push(host.into());
        }
    }
    Ok(discovered.into_iter().map(|(name, hosts)| ModelCandidate { name, hosts }).collect())
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
fn collect_machine_sources(machine: MachinePaths, model_name: String) -> Result<Vec<HostSources>, String> {
    ensure_network_credentials(&machine)?;
    [
        ("FM1", machine.fm1_path),
        ("FM2", machine.fm2_path),
        ("BM", machine.bm_path),
    ]
    .into_iter()
    .map(|(host, path)| collect_host_sources(Path::new(&path), host, &model_name))
    .collect()
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
        "local" | "mongodb" => {
            persist_storage_config(&app, &config)?;
            // the cached store still points at the previous backend
            let cache = app.state::<StoreCache>();
            *cache.0.lock().map_err(|_| "Store cache is poisoned".to_string())? = None;
            Ok(())
        }
        _ => Err("Backend must be \"local\" or \"mongodb\".".into()),
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
        let record_key = format!("models/{machine_id}/{model_key}.json");
        let record_json = store
            .read(&record_key)?
            .ok_or_else(|| format!("No stored data for {model_name} - collect the model first."))?;
        let gv_json = store
            .read(&format!("ui/gv/{machine_id}/{model_key}.json"))?
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
            load_local_file,
            save_local_file,
            delete_local_file,
            list_local_files,
            get_storage_config,
            set_storage_config,
            test_mongo_connection,
            migrate_local_to_mongo,
            export_parameter_excel
        ])
        .setup(|app| {
            app.manage(StoreCache(std::sync::Mutex::new(None)));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

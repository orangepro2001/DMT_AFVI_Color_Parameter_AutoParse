use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

mod storage;

use storage::{open_store, persist_storage_config, read_storage_config, StorageConfig};
use tauri::AppHandle;

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

#[tauri::command]
fn load_local_file(app: AppHandle, filename: &str) -> Result<String, String> {
    open_store(&app)?
        .read(filename)?
        .ok_or_else(|| "Document was not found in the database.".into())
}

#[tauri::command]
fn save_local_file(app: AppHandle, filename: &str, content: &str) -> Result<(), String> {
    open_store(&app)?.write(filename, content)
}

#[tauri::command]
fn delete_local_file(app: AppHandle, filename: &str) -> Result<(), String> {
    open_store(&app)?.delete(filename)
}

#[tauri::command]
fn list_local_files(app: AppHandle, prefix: &str) -> Result<Vec<String>, String> {
    open_store(&app)?.list(prefix)
}

#[tauri::command]
fn get_storage_config(app: AppHandle) -> Result<StorageConfig, String> {
    read_storage_config(&app)
}

#[tauri::command]
fn set_storage_config(app: AppHandle, config: StorageConfig) -> Result<(), String> {
    match config.backend.as_str() {
        "local" | "mongodb" => persist_storage_config(&app, &config),
        _ => Err("Backend must be \"local\" or \"mongodb\".".into()),
    }
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
            set_storage_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

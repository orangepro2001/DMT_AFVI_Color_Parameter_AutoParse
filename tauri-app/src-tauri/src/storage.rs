use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

/// Storage seam of the application. The app only ever talks to documents
/// (JSON strings addressed by a relative key), so the backend can be swapped
/// without touching the feature code: today the default `local` backend is a
/// JSON file store in the app-data directory, tomorrow a `mongodb` backend can
/// implement the same trait (see `MongoSettings` / `storage.json`).
pub trait DocumentStore {
    fn read(&self, relative: &str) -> Result<Option<String>, String>;
    fn write(&self, relative: &str, content: &str) -> Result<(), String>;
    fn delete(&self, relative: &str) -> Result<(), String>;
    fn list(&self, prefix: &str) -> Result<Vec<String>, String>;
}

/// Default backend: one JSON document per file under the app-data directory.
/// The file layout is the database - `machines.json`, `models/<machine>/<model>.json`,
/// `ui/*.json` - and stays readable and diffable by hand.
pub struct JsonFileStore {
    root: PathBuf,
}

impl JsonFileStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn resolve(&self, relative: &str) -> Result<PathBuf, String> {
        let path = Path::new(relative);
        if path.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        }) {
            return Err("Invalid database path".into());
        }
        Ok(self.root.join(path))
    }

    fn walk(&self, dir: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|error| format!("Cannot read {}: {error}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                self.walk(&path, prefix, out)?;
            } else {
                let relative = path.strip_prefix(&self.root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                if relative.starts_with(prefix) {
                    out.push(relative);
                }
            }
        }
        Ok(())
    }
}

impl DocumentStore for JsonFileStore {
    fn read(&self, relative: &str) -> Result<Option<String>, String> {
        match fs::read_to_string(self.resolve(relative)?) {
            Ok(content) => Ok(Some(content)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn write(&self, relative: &str, content: &str) -> Result<(), String> {
        let path = self.resolve(relative)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(path, content).map_err(|error| error.to_string())
    }

    fn delete(&self, relative: &str) -> Result<(), String> {
        let path = self.resolve(relative)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>, String> {
        let mut documents = Vec::new();
        if self.root.exists() {
            self.walk(&self.root.clone(), prefix, &mut documents)?;
        }
        documents.sort();
        Ok(documents)
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MongoSettings {
    #[serde(default = "default_mongo_url")]
    pub url: String,
    #[serde(default = "default_mongo_database")]
    pub database: String,
}

impl Default for MongoSettings {
    fn default() -> Self {
        Self { url: default_mongo_url(), database: default_mongo_database() }
    }
}

fn default_mongo_url() -> String {
    "mongodb://localhost:27017".into()
}

fn default_mongo_database() -> String {
    "dmt_afvi".into()
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct StorageConfig {
    /// Active backend id: `local` (default) or `mongodb` (reserved).
    pub backend: String,
    /// Connection settings used once the MongoDB backend is implemented.
    pub mongodb: Option<MongoSettings>,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self { backend: "local".into(), mongodb: Some(MongoSettings::default()) }
    }
}

fn storage_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("storage.json"))
}

pub fn read_storage_config(app: &tauri::AppHandle) -> Result<StorageConfig, String> {
    let path = storage_config_path(app)?;
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content)
            .map_err(|error| format!("storage.json is invalid: {error}")),
        Err(_) => {
            let default = StorageConfig::default();
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&path, serde_json::to_string_pretty(&default).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            Ok(default)
        }
    }
}

pub fn persist_storage_config(app: &tauri::AppHandle, config: &StorageConfig) -> Result<(), String> {
    let path = storage_config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(config).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

/// Pick the backend configured in `storage.json`. The feature code and the
/// Tauri command surface stay identical across backends.
pub fn open_store(app: &tauri::AppHandle) -> Result<Box<dyn DocumentStore>, String> {
    let config = read_storage_config(app)?;
    match config.backend.as_str() {
        "local" | "" => {
            let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
            Ok(Box::new(JsonFileStore::new(root)))
        }
        "mongodb" => Err("MongoDB backend is configured but not implemented yet. \
            Set \"backend\": \"local\" in storage.json or implement MongoDocumentStore (see README).".into()),
        other => Err(format!("Unknown storage backend '{other}'.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> JsonFileStore {
        JsonFileStore::new(std::env::temp_dir().join(format!("dmt-afvi-test-{}", std::process::id())))
    }

    #[test]
    fn write_read_delete_roundtrip() {
        let store = temp_store();
        store.write("models/m1/6ST2001Q01.json", "{\"schemaVersion\":2}").unwrap();
        assert_eq!(store.read("models/m1/6ST2001Q01.json").unwrap().as_deref(), Some("{\"schemaVersion\":2}"));
        store.delete("models/m1/6ST2001Q01.json").unwrap();
        assert_eq!(store.read("models/m1/6ST2001Q01.json").unwrap(), None);
    }

    #[test]
    fn read_missing_document_is_none() {
        let store = temp_store();
        assert_eq!(store.read("ui/missing.json").unwrap(), None);
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        let store = temp_store();
        assert!(store.write("../escape.json", "{}").is_err());
        assert!(store.read("C:/abs.json").is_err());
    }

    #[test]
    fn list_prefix_walks_directories() {
        let store = temp_store();
        store.write("ui/gv/m1/a.json", "{}").unwrap();
        store.write("ui/gv/m2/b.json", "{}").unwrap();
        store.write("machines.json", "[]").unwrap();
        let listed = store.list("ui/gv/").unwrap();
        assert_eq!(listed, vec!["ui/gv/m1/a.json", "ui/gv/m2/b.json"]);
        store.delete("ui/gv/m1/a.json").unwrap();
        store.delete("ui/gv/m2/b.json").unwrap();
        store.delete("machines.json").unwrap();
    }
}

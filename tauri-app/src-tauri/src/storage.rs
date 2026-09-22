use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;

/// Storage seam of the application. The app only ever talks to documents
/// (JSON strings addressed by a relative key), so the backend can be swapped
/// without touching the feature code: today the default `local` backend is a
/// JSON file store in the app-data directory, tomorrow a `mongodb` backend can
/// implement the same trait (see `MongoSettings` / `storage.json`).
pub trait DocumentStore: Send + Sync {
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
/// Tauri command surface stay identical across backends. The store instance is
/// cached in Tauri state so MongoDB connections are reused across commands.
pub fn open_store(app: &tauri::AppHandle) -> Result<Arc<dyn DocumentStore>, String> {
    let config = read_storage_config(app)?;
    match config.backend.as_str() {
        "local" | "" => {
            let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
            Ok(Arc::new(JsonFileStore::new(root)))
        }
        "mongodb" => {
            let cache = app.state::<StoreCache>();
            let mut cached = cache.0.lock().map_err(|_| "Store cache is poisoned".to_string())?;
            if let Some(store) = cached.as_ref() {
                return Ok(store.clone());
            }
            let settings = config.mongodb.clone().unwrap_or_default();
            let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
            let store: Arc<dyn DocumentStore> = Arc::new(WithFallbackStore::new(
                Arc::new(MongoDocumentStore::new(&settings.url, &settings.database)?),
                JsonFileStore::new(root),
            ));
            *cached = Some(store.clone());
            Ok(store)
        }
        other => Err(format!("Unknown storage backend '{other}'.")),
    }
}

/// Tauri-managed cache of the open document store (rebuilt after config changes).
pub struct StoreCache(pub std::sync::Mutex<Option<Arc<dyn DocumentStore>>>);

/// MongoDB backend: one collection of documents, `_id` = document key (the same
/// relative path the file store uses), `content` = the JSON document text.
pub struct MongoDocumentStore {
    runtime: tokio::runtime::Runtime,
    collection: mongodb::Collection<bson::Document>,
}

impl MongoDocumentStore {
    pub fn new(url: &str, database: &str) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("Cannot start the async runtime: {error}"))?;
        let collection = runtime.block_on(async {
            let mut options = mongodb::options::ClientOptions::parse(url)
                .await
                .map_err(|error| format!("MongoDB connection string is invalid: {error}"))?;
            options.server_selection_timeout = Some(std::time::Duration::from_secs(10));
            let client = mongodb::Client::with_options(options)
                .map_err(|error| format!("Cannot create the MongoDB client: {error}"))?;
            let database = client.database(database);
            // fail fast when the cluster is unreachable
            database
                .run_command(bson::doc! { "ping": 1 })
                .await
                .map_err(|error| format!("Cannot reach the MongoDB cluster: {error}"))?;
            Ok::<mongodb::Collection<bson::Document>, String>(database.collection::<bson::Document>("documents"))
        })?;
        Ok(MongoDocumentStore { runtime, collection })
    }

    pub fn count_documents(&self) -> Result<u64, String> {
        self.runtime.block_on(async {
            self.collection
                .estimated_document_count()
                .await
                .map_err(|error| format!("Cannot count documents: {error}"))
        })
    }
    // note: `Action` types are IntoFuture in mongodb 3 - they are awaited directly

}

fn mongo_key(key: &str) -> bson::Document {
    bson::doc! { "_id": key }
}

impl DocumentStore for MongoDocumentStore {
    fn read(&self, relative: &str) -> Result<Option<String>, String> {
        self.runtime.block_on(async {
            match self.collection.find_one(mongo_key(relative)).await {
                Ok(Some(document)) => Ok(document.get_str("content").map(|s| s.to_string()).ok()),
                Ok(None) => Ok(None),
                Err(error) => Err(format!("MongoDB read failed: {error}")),
            }
        })
    }

    fn write(&self, relative: &str, content: &str) -> Result<(), String> {
        let document = bson::doc! { "_id": relative, "content": content };
        self.runtime.block_on(async {
            self.collection
                .replace_one(mongo_key(relative), document)
                .upsert(true)
                .await
                .map(|_| ())
                .map_err(|error| format!("MongoDB write failed: {error}"))
        })
    }

    fn delete(&self, relative: &str) -> Result<(), String> {
        self.runtime.block_on(async {
            self.collection
                .delete_one(mongo_key(relative))
                .await
                .map(|_| ())
                .map_err(|error| format!("MongoDB delete failed: {error}"))
        })
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>, String> {
        let pattern = format!("^{}", regex::escape(prefix));
        let filter = bson::doc! { "_id": { "$regex": pattern } };
        self.runtime.block_on(async {
            let mut cursor = self
                .collection
                .find(filter)
                .projection(bson::doc! { "content": 0 })
                .await
                .map_err(|error| format!("MongoDB list failed: {error}"))?;
            let mut keys = Vec::new();
            while let Some(document) = cursor.next().await {
                let document = document.map_err(|error| format!("MongoDB list failed: {error}"))?;
                if let Some(bson::Bson::String(key)) = document.get("_id") {
                    keys.push(key.clone());
                }
            }
            keys.sort();
            Ok(keys)
        })
    }
}

/// Reads try the primary backend and fall back to the local JSON files, so a
/// network hiccup never blanks the UI; writes go to the primary only.
pub struct WithFallbackStore {
    primary: Arc<dyn DocumentStore>,
    fallback: JsonFileStore,
}

impl WithFallbackStore {
    pub fn new(primary: Arc<dyn DocumentStore>, fallback: JsonFileStore) -> Self {
        Self { primary, fallback }
    }
}

impl DocumentStore for WithFallbackStore {
    fn read(&self, relative: &str) -> Result<Option<String>, String> {
        match self.primary.read(relative) {
            Ok(Some(content)) => Ok(Some(content)),
            Ok(None) => match self.fallback.read(relative)? {
                Some(content) => Ok(Some(content)),
                None => Ok(None),
            },
            Err(primary_error) => match self.fallback.read(relative) {
                Ok(content) => Ok(content),
                Err(_) => Err(primary_error),
            },
        }
    }

    fn write(&self, relative: &str, content: &str) -> Result<(), String> {
        self.primary.write(relative, content)
    }

    fn delete(&self, relative: &str) -> Result<(), String> {
        self.primary.delete(relative)
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>, String> {
        self.primary.list(prefix)
    }
}

// ---------------------------------------------------------------- migration

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    #[serde(default)]
    pub migrated: Vec<String>,
    #[serde(default)]
    pub failed: Vec<MigrationFailure>,
    #[serde(default)]
    pub target_documents: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MigrationFailure {
    pub key: String,
    pub reason: String,
}

/// Copy every document from `from` to `to` (upsert). Source files stay in place
/// as the backup of record.
pub fn migrate_store(from: &dyn DocumentStore, to: &dyn DocumentStore) -> Result<MigrationReport, String> {
    let keys = from.list("")?;
    let mut report = MigrationReport::default();
    for key in keys {
        let content = match from.read(&key) {
            Ok(Some(content)) => content,
            Ok(None) => continue, // vanished between list and read
            Err(error) => {
                report.failed.push(MigrationFailure { key: key.clone(), reason: error });
                continue;
            }
        };
        match to.write(&key, &content) {
            Ok(()) => report.migrated.push(key),
            Err(error) => report.failed.push(MigrationFailure { key: key.clone(), reason: error }),
        }
    }
    report.target_documents = to.list("")?.len() as u64;
    Ok(report)
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

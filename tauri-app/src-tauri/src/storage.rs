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
    /// Active backend id: `local` (default), `mongodb` or `firestore`.
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
        "firestore" => {
            let cache = app.state::<StoreCache>();
            let mut cached = cache.0.lock().map_err(|_| "Store cache is poisoned".to_string())?;
            if let Some(store) = cached.as_ref() {
                return Ok(store.clone());
            }
            let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
            let store: Arc<dyn DocumentStore> = Arc::new(WithFallbackStore::new(
                Arc::new(FirestoreStore::new(FIRESTORE_PROJECT_ID, FIRESTORE_DATABASE_ID, FIRESTORE_API_KEY)?),
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

// --------------------------------------------------------------- Firestore

/// Hardcoded Firebase settings (user request: ship the project and its web API
/// key in the binary - the key only identifies the app to Google, real access
/// control is done by the Firestore security rules).
pub const FIRESTORE_PROJECT_ID: &str = "project-f8cc5d3d-f29a-43ed-b7e";
pub const FIRESTORE_API_KEY: &str = "AIzaSyAApVXlQFEKtq9Nd5lhgqytrxVUMtVmjP0";
/// The user created a named Firestore database (not `(default)`).
pub const FIRESTORE_DATABASE_ID: &str = "dmtafviparse0923";

const FIRESTORE_COLLECTION: &str = "documents";

/// Firestore caps one document at 1 MiB. Model snapshots can exceed that, so
/// oversized content is split into chunks: the main document holds chunk 0
/// plus the `total` field, chunks 1..n live in `<id>__part<n>` documents of
/// the same collection (field `chunkIndex` marks them; list() skips them).
const FIRESTORE_MAX_CHUNK_BYTES: usize = 700_000;

/// Firestore backend over the REST API: one document per record in the
/// `documents` collection, field `key` = the relative key of the file store,
/// field `content` = the JSON document text - the same layout as MongoDB.
pub struct FirestoreStore {
    client: reqwest::blocking::Client,
    base: String,
    api_key: String,
}

/// Splits into char-boundary-safe chunks of at most `max_bytes` (UTF-8).
fn split_chunks(content: &str, max_bytes: usize) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut start = 0usize;
    let mut length = 0usize;
    for (index, ch) in content.char_indices() {
        if length + ch.len_utf8() > max_bytes && index > start {
            chunks.push(&content[start..index]);
            start = index;
            length = ch.len_utf8();
        } else {
            length += ch.len_utf8();
        }
    }
    chunks.push(&content[start..]);
    chunks
}

impl FirestoreStore {
    pub fn new(project_id: &str, database_id: &str, api_key: &str) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|error| format!("Cannot create the HTTP client: {error}"))?;
        Ok(FirestoreStore {
            client,
            base: format!("https://firestore.googleapis.com/v1/projects/{project_id}/databases/{database_id}/documents"),
            api_key: api_key.to_string(),
        })
    }

    pub fn count_documents(&self) -> Result<usize, String> {
        Ok(self.list("")?.len())
    }

    /// Firestore document ids cannot contain `/`, so the relative key's slashes
    /// become `__`; the original key also travels in the `key` field, which
    /// list() reads back (the encoding is never decoded - no collisions).
    fn firestore_id(relative: &str) -> String {
        relative.replace('/', "__")
    }

    /// Turns a Google API failure into a readable message. A bare HTML 404 page
    /// (no JSON body) means the request never reached a Firestore backend - the
    /// project has no Firestore database yet.
    fn describe_error(status: reqwest::StatusCode, body: &str) -> String {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
            if let Some(message) = value["error"]["message"].as_str() {
                return format!("Firestore error {status}: {message}");
            }
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return "Firestore: the project has no Firestore database yet - create one in the Firebase console (Native mode).".into();
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return "Firestore: access denied - publish permissive (test mode) security rules or check the API key.".into();
        }
        format!("Firestore error {status}: {}", body.chars().take(300).collect::<String>())
    }

    fn check(response: reqwest::blocking::Response) -> Result<(), String> {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if status.is_success() {
            return Ok(());
        }
        Err(Self::describe_error(status, &body))
    }

    /// PATCH with one retry - large chunk uploads on a shaky line deserve a
    /// second attempt; HTTP-level API errors are not retried.
    fn patch_with_retry(&self, url: String, body: &serde_json::Value) -> Result<(), String> {
        let mut last_error = String::new();
        for attempt in 0..2 {
            match self.client.patch(&url).query(&[("key", self.api_key.as_str())]).json(body).send() {
                Ok(response) => match Self::check(response) {
                    Ok(()) => return Ok(()),
                    Err(error) => return Err(error),
                },
                Err(error) => {
                    last_error = format!("Cannot reach Firestore: {error}");
                    if attempt == 0 {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                    }
                }
            }
        }
        Err(last_error)
    }

    /// GETs one chunk document and returns its content field.
    fn read_field_chunk(&self, id: &str) -> Result<String, String> {
        let response = self
            .client
            .get(format!("{}/{FIRESTORE_COLLECTION}/{id}", self.base))
            .query(&[("key", self.api_key.as_str())])
            .send()
            .map_err(|error| format!("Cannot reach Firestore: {error}"))?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if !status.is_success() {
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(format!("Firestore: chunk document {id} is missing - migrate the data again."));
            }
            return Err(Self::describe_error(status, &body));
        }
        let value: serde_json::Value = serde_json::from_str(&body)
            .map_err(|error| format!("Firestore returned invalid JSON: {error}"))?;
        value["fields"]["content"]["stringValue"].as_str().map(|s| s.to_string())
            .ok_or_else(|| format!("Firestore: chunk document {id} has no content field."))
    }

    /// GETs a document and returns its `fields` object; Ok(None) when missing.
    fn get_document_fields(&self, id: &str) -> Result<Option<serde_json::Value>, String> {
        let response = self
            .client
            .get(format!("{}/{FIRESTORE_COLLECTION}/{id}", self.base))
            .query(&[("key", self.api_key.as_str())])
            .send()
            .map_err(|error| format!("Cannot reach Firestore: {error}"))?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND && !body.trim_start().starts_with('<') {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(Self::describe_error(status, &body));
        }
        let value: serde_json::Value = serde_json::from_str(&body)
            .map_err(|error| format!("Firestore returned invalid JSON: {error}"))?;
        Ok(Some(value["fields"].clone()))
    }

    fn delete_document(&self, id: &str) -> Result<(), String> {
        let response = self
            .client
            .delete(format!("{}/{FIRESTORE_COLLECTION}/{id}", self.base))
            .query(&[("key", self.api_key.as_str())])
            .send()
            .map_err(|error| format!("Cannot reach Firestore: {error}"))?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(()); // already gone - same as the file store
        }
        if !status.is_success() {
            return Err(Self::describe_error(status, &body));
        }
        Ok(())
    }
}

impl DocumentStore for FirestoreStore {
    fn read(&self, relative: &str) -> Result<Option<String>, String> {
        let id = Self::firestore_id(relative);
        let response = self
            .client
            .get(format!("{}/{FIRESTORE_COLLECTION}/{id}", self.base))
            .query(&[("key", self.api_key.as_str())])
            .send()
            .map_err(|error| format!("Cannot reach Firestore: {error}"))?;
        let status = response.status();
        let body = response.text().unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND && !body.trim_start().starts_with('<') {
            // JSON NOT_FOUND: "document not found" - the regular missing case
            return Ok(None);
        }
        if !status.is_success() {
            return Err(Self::describe_error(status, &body));
        }
        let value: serde_json::Value = serde_json::from_str(&body)
            .map_err(|error| format!("Firestore returned invalid JSON: {error}"))?;
        let Some(mut full) = value["fields"]["content"]["stringValue"].as_str().map(|s| s.to_string()) else {
            return Ok(None);
        };
        // reassemble the remaining chunks of an oversized document
        let total = value["fields"]["total"]["stringValue"].as_str().and_then(|t| t.parse::<usize>().ok()).unwrap_or(1);
        for index in 1..total {
            let chunk = self.read_field_chunk(&format!("{id}__part{index}"))?;
            full.push_str(&chunk);
        }
        Ok(Some(full))
    }

    fn write(&self, relative: &str, content: &str) -> Result<(), String> {
        let id = Self::firestore_id(relative);
        let chunks = split_chunks(content, FIRESTORE_MAX_CHUNK_BYTES);
        let total = chunks.len().to_string();
        // trailing chunks go first and the main document (chunk 0 + `total`)
        // last, so a crash mid-write leaves the previous version intact
        for (index, chunk) in chunks.iter().enumerate().skip(1) {
            let body = serde_json::json!({
                "fields": {
                    "key": { "stringValue": relative },
                    "content": { "stringValue": chunk },
                    "total": { "stringValue": total },
                    "chunkIndex": { "stringValue": index.to_string() }
                }
            });
            self.patch_with_retry(format!("{}/{FIRESTORE_COLLECTION}/{id}__part{index}", self.base), &body)?;
        }
        let mut fields = serde_json::json!({
            "content": { "stringValue": chunks[0] },
            "key": { "stringValue": relative }
        });
        if chunks.len() > 1 {
            fields["total"] = serde_json::json!({ "stringValue": total });
            fields["chunkIndex"] = serde_json::json!({ "stringValue": "0" });
        }
        let body = serde_json::json!({ "fields": fields });
        // PATCH to a not-yet-existing document path creates it (upsert)
        self.patch_with_retry(format!("{}/{FIRESTORE_COLLECTION}/{id}", self.base), &body)
    }

    fn delete(&self, relative: &str) -> Result<(), String> {
        let id = Self::firestore_id(relative);
        // read the main document first: chunked documents have follow-up parts
        let total = match self.get_document_fields(&id)? {
            Some(fields) => fields["total"]["stringValue"].as_str().and_then(|t| t.parse::<usize>().ok()).unwrap_or(1),
            None => return Ok(()), // main document does not exist
        };
        for index in 1..total {
            // a stuck part must not block the delete
            let _ = self.delete_document(&format!("{id}__part{index}"));
        }
        self.delete_document(&id)
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>, String> {
        let mut keys = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut request = self
                .client
                .get(format!("{}/{}", self.base, FIRESTORE_COLLECTION))
                .query(&[("key", self.api_key.as_str()), ("pageSize", "300"), ("showMissing", "false")]);
            if let Some(token) = page_token.as_deref() {
                request = request.query(&[("pageToken", token)]);
            }
            let response = request
                .send()
                .map_err(|error| format!("Cannot reach Firestore: {error}"))?;
            let status = response.status();
            let body = response.text().unwrap_or_default();
            if !status.is_success() {
                return Err(Self::describe_error(status, &body));
            }
            let value: serde_json::Value = serde_json::from_str(&body)
                .map_err(|error| format!("Firestore returned invalid JSON: {error}"))?;
            if let Some(documents) = value["documents"].as_array() {
                for document in documents {
                    // chunks 1..n of oversized documents carry chunkIndex > 0
                    // and belong to their main document - never list them
                    let chunk_index = document["fields"]["chunkIndex"]["stringValue"].as_str().and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
                    if chunk_index > 0 {
                        continue;
                    }
                    let key = document["fields"]["key"]["stringValue"].as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| {
                            // documents written before the `key` field existed
                            let name = document["name"].as_str().unwrap_or("");
                            name.rsplit('/').next().unwrap_or("").replace("__", "/")
                        });
                    if key.starts_with(prefix) {
                        keys.push(key);
                    }
                }
            }
            match value["nextPageToken"].as_str() {
                Some(token) if !token.is_empty() => page_token = Some(token.to_string()),
                _ => break,
            }
        }
        keys.sort();
        Ok(keys)
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
        match self.primary.write(relative, content) {
            Ok(()) => Ok(()),
            Err(primary_error) => {
                // never lose operator input (GV values, export config): park it
                // in the local files, the next migration pushes it to the primary
                self.fallback.write(relative, content)?;
                Err(primary_error)
            }
        }
    }

    fn delete(&self, relative: &str) -> Result<(), String> {
        self.primary.delete(relative)?;
        self.fallback.delete(relative)
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

    #[test]
    fn chunks_split_on_char_boundaries() {
        // Korean text: 3 bytes per char, so a byte limit may split mid-character
        let content = "가".repeat(1_000_000);
        let chunks = split_chunks(&content, 700_000);
        assert!(chunks.len() >= 2, "expected several chunks");
        assert!(chunks.iter().all(|chunk| chunk.len() <= 700_000), "chunk exceeds the byte limit");
        assert_eq!(chunks.concat(), content, "chunks must reassemble exactly");
    }

    #[test]
    fn short_content_stays_one_chunk() {
        assert_eq!(split_chunks("abc", 700_000).len(), 1);
        assert_eq!(split_chunks(&"x".repeat(700_000), 700_000).len(), 1);
        assert_eq!(split_chunks(&"x".repeat(700_001), 700_000).len(), 2);
        assert_eq!(split_chunks("", 700_000), vec![""]);
    }
}

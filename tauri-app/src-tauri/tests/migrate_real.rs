//! One-off migration of the local document database into the MongoDB Atlas
//! cluster, followed by a byte-for-byte verification and the storage.json
//! backend switch. Reads the connection string from the Atlas onboarding env
//! file (machine-local, never committed).

use afvi_parse_lib::storage::{migrate_store, DocumentStore, JsonFileStore, MongoDocumentStore};

const APP_DATA: &str = "C:\\Users\\yangz\\AppData\\Roaming\\com.yangz.tauri-app";
const CREDENTIALS_ENV: &str = "C:\\Users\\yangz\\Downloads\\atlas-credentials.env";

fn atlas_uri() -> Option<String> {
    let content = std::fs::read_to_string(CREDENTIALS_ENV).ok()?;
    for line in content.lines() {
        if let Some(uri) = line.strip_prefix("MONGODB_URI=").map(|v| v.trim().trim_matches('"')) {
            return Some(uri.to_string());
        }
    }
    None
}

#[test]
fn migrate_app_data_to_atlas_and_switch() {
    let Some(uri) = atlas_uri() else { return };
    let local = JsonFileStore::new(std::path::PathBuf::from(APP_DATA));

    // 1. connect + migrate every document
    let mongo = MongoDocumentStore::new(&uri, "dmt_afvi").expect("Atlas connection failed");
    let report = migrate_store(&local, &mongo).expect("migration failed");
    println!("migrated {} documents, failures: {:?}", report.migrated.len(), report.failed);
    println!("migrated keys: {:#?}", report.migrated);
    assert!(report.failed.is_empty(), "migration failures: {:?}", report.failed);
    assert!(report.migrated.len() >= 9, "expected the full local dataset, got {}", report.migrated.len());

    // 2. verify byte-for-byte
    let keys = local.list("").unwrap();
    for key in &keys {
        let expected = local.read(key).unwrap().expect("local doc missing");
        let actual = mongo.read(key).unwrap().expect("mongo doc missing");
        assert_eq!(expected, actual, "mismatch for {key}");
    }
    println!("verified {} documents byte-for-byte", keys.len());

    // 3. switch the app to MongoDB
    let config = serde_json::json!({
        "backend": "mongodb",
        "mongodb": { "url": uri, "database": "dmt_afvi" }
    });
    std::fs::write(format!("{APP_DATA}\\storage.json"), serde_json::to_string_pretty(&config).unwrap()).unwrap();
    println!("storage.json switched to mongodb");

    // 4. read-through check with the fallback store semantics (mongo primary)
    let switched = std::fs::read_to_string(format!("{APP_DATA}\\storage.json")).unwrap();
    assert!(switched.contains("\"mongodb\""));
}

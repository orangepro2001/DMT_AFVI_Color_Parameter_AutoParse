//! One-off end-to-end check of the Firestore backend against the live
//! `dmtafviparse0923` database. Firestore caps a single document at 1 MiB, so
//! oversized records are chunked - this verifies the chunked write/read/delete
//! paths, then migrates the local app-data and verifies it byte-for-byte.
//!
//! GATED: runs only with `FIRESTORE_E2E=1` - plain `cargo test` / builds never
//! touch the live database or the app-data configuration.

use afvi_parse_lib::storage::{migrate_store, DocumentStore, FirestoreStore, JsonFileStore, FIRESTORE_API_KEY, FIRESTORE_DATABASE_ID, FIRESTORE_PROJECT_ID};

const APP_DATA: &str = "C:\\Users\\yangz\\AppData\\Roaming\\com.afvi.parse";

#[test]
fn firestore_roundtrip_and_migrate_app_data() {
    if std::env::var("FIRESTORE_E2E").unwrap_or_default() != "1" {
        return; // gated: never touch the live database from a plain cargo test
    }
    let local = JsonFileStore::new(std::path::PathBuf::from(APP_DATA));
    let store = FirestoreStore::new(FIRESTORE_PROJECT_ID, FIRESTORE_DATABASE_ID, FIRESTORE_API_KEY)
        .expect("FirestoreStore::new failed");

    // 1. oversized document roundtrip - exceeds Firestore's 1 MiB document cap
    //    and mixes ASCII with multi-byte Korean text to stress chunk boundaries
    let oversized = format!("{{\"schemaVersion\":2,\"payload\":\"{}\"}}", "AFVI검사".repeat(300_000));
    let big_key = "models/probe/oversized-roundtrip.json";
    store.write(big_key, &oversized).expect("chunked Firestore write failed");
    assert_eq!(
        store.read(big_key).unwrap().as_deref(),
        Some(oversized.as_str()),
        "chunked roundtrip is not byte-for-byte"
    );
    println!("chunked roundtrip of {} bytes verified", oversized.len());
    store.delete(big_key).unwrap();
    assert_eq!(store.read(big_key).unwrap(), None, "chunked document must be gone after delete");
    println!("chunked delete verified");

    // 2. small documents stay plain single documents
    store.write("probe/test-roundtrip.json", "{\"ok\":true}").unwrap();
    assert_eq!(store.read("probe/test-roundtrip.json").unwrap().as_deref(), Some("{\"ok\":true}"));
    assert!(store.list("probe/").unwrap().contains(&"probe/test-roundtrip.json".to_string()));
    store.delete("probe/test-roundtrip.json").unwrap();
    assert_eq!(store.read("probe/test-roundtrip.json").unwrap(), None);
    println!("small-document roundtrip verified");

    // 3. migrate the local app-data (upsert, idempotent) and verify all keys
    let report = migrate_store(&local, &store).expect("migration failed");
    println!("migrated {} documents, failures: {:?}", report.migrated.len(), report.failed);
    assert!(report.failed.is_empty(), "migration failures: {:?}", report.failed);

    let keys = local.list("").unwrap();
    for key in &keys {
        let expected = local.read(key).unwrap().expect("local doc missing");
        let actual = store.read(key).unwrap().expect("firestore doc missing");
        assert_eq!(expected, actual, "mismatch for {key}");
    }
    println!("verified {} documents byte-for-byte", keys.len());
}

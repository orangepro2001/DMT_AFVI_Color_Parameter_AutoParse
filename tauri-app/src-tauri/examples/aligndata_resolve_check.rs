//! Real-data verification of the Plan 07 resolver chain against the live
//! shares: PxRepository model dir root > PxRepository\AlignData >
//! PxInventory\INSPECT_SPEC\<model>-00\AlignData > safe Missing, plus one
//! end-to-end identity compose from the resolved 25fbo015-15 trio.
//!
//!   cargo run --release --example aligndata_resolve_check

use afvi_parse_lib::align::{resolve_aligndata_tifs, AlignDataLookup};

const REPO: &str = r"\\192.168.1.61\PxRepository";
const INVENTORY: &str = r"\\192.168.1.61\PxInventory";
const OUT: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan\aligndata_25fbo015_overlay.png";

fn probe(tag: &str, repo: &str, inventory: Option<&str>, model: &str) -> Option<std::sync::Arc<afvi_parse_lib::align::AlignDataLayers>> {
    match resolve_aligndata_tifs(repo, inventory, model) {
        Ok(AlignDataLookup::Found(layers)) => {
            println!("{tag}: FOUND source={} open={}", layers.source, layers.open.is_some());
            println!("  metal {}", layers.metal.display());
            Some(std::sync::Arc::new(*layers))
        }
        Ok(AlignDataLookup::Missing { searched }) => {
            println!("{tag}: MISSING (safe empty state), probed {} location(s):", searched.len());
            for s in &searched {
                println!("  - {s}");
            }
            None
        }
        Err(error) => {
            println!("{tag}: HARD ERROR - {error}");
            None
        }
    }
}

fn main() {
    // 1. newest drop layout: trio directly in the PxRepository model dir
    let _ = probe("repo-root 25fbo015-15", REPO, Some(INVENTORY), "25fbo015-15");
    // 2. trio in the model's AlignData subfolder (7M99-631 layout)
    let _ = probe("repo-sub 7M99-631   ", REPO, Some(INVENTORY), "7M99-631");
    // 2b. trio at the INSPECT_SPEC dir root next to its AlignData folder -
    //     the shallow root pair must win the breadth-first scan
    let empty_repo = std::env::temp_dir().join("afvi_resolve_check_empty");
    std::fs::create_dir_all(&empty_repo).unwrap();
    let _ = probe("inv-root  7M99-631   ", empty_repo.to_str().unwrap(), Some(INVENTORY), "7M99-631");
    // 3. model without the trio anywhere -> safe Missing, never an error
    let _ = probe("none      danny      ", REPO, Some(INVENTORY), "danny");
    // 4. repository without the model + real inventory -> inventory wins
    let _ = probe("inv-only  25fbo015-15", empty_repo.to_str().unwrap(), Some(INVENTORY), "25fbo015-15");

    // 5. end-to-end: identity compose from the resolved trio (real 23 MB tifs)
    if let Some(layers) = probe("compose   25fbo015-15", REPO, Some(INVENTORY), "25fbo015-15") {
        let started = std::time::Instant::now();
        let metal = image::open(&layers.metal).expect("metal").to_luma8();
        let sr = image::open(&layers.sr).expect("sr").to_luma8();
        println!("  decoded {}x{} + {}x{} in {:?}", metal.width(), metal.height(), sr.width(), sr.height(), started.elapsed());
        let composite = afvi_parse_lib::align::overlay::compose_identity(&sr, &metal, 4096).expect("compose");
        composite.save(OUT).expect("save");
        println!("  composed {}x{} -> {OUT}", composite.width(), composite.height());
    }
}

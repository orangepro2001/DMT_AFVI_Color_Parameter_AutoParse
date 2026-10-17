//! Real-data check for the median+Metal align simulation (Plan 07): verifies
//! the "MEDIAN is one unit on the AlignData grid" assumption and renders the
//! yellow overlay for the eyeball check.
//!
//!   cargo run --release --example median_metal_check

use afvi_parse_lib::align::{overlay::compose_median_metal, resolve_aligndata_tifs, AlignDataLookup};

const MEDIAN: &str = r"\\192.168.1.61\PxRepository\25fbo015-15\2.0\Line\Top\Layer\MEDIAN\Median_0_1_0.tif";
const REPO: &str = r"\\192.168.1.61\PxRepository";
const INVENTORY: &str = r"\\192.168.1.61\PxInventory";
const OUT: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\docs\aligndata_median_metal.png";

fn main() {
    let started = std::time::Instant::now();
    let median = image::open(std::path::Path::new(MEDIAN)).expect("median").to_luma8();
    println!("median {}x{} ({:?})", median.width(), median.height(), started.elapsed());

    let metal = match resolve_aligndata_tifs(REPO, Some(INVENTORY), "25fbo015-15") {
        Ok(AlignDataLookup::Found(layers)) => {
            println!("metal {} source={}", layers.metal.display(), layers.source);
            image::open(&layers.metal).expect("metal").to_luma8()
        }
        _ => panic!("no AlignData trio"),
    };
    println!("metal {}x{} ({:?})", metal.width(), metal.height(), started.elapsed());

    let composite = compose_median_metal(&median, &metal, 4096).expect("compose");
    composite.save(OUT).expect("save");
    println!("composed {}x{} -> {OUT} ({:?})", composite.width(), composite.height(), started.elapsed());
}

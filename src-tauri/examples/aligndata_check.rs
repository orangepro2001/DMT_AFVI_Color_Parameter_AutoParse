//! One-off verification: can the `AlignData` trio (Metal/Open/SR) compose the
//! Align/ROI overlay? Prints layer metadata, then runs the real
//! `align::overlay::compose_overlay` pipeline on the pairs and saves the
//! composites for the eyeball check.
//!
//!   cargo run --release --example aligndata_check

use image::imageops;

const DIR: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tools\aligndata_7M99-631";
const OUT_DIR: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan";

fn report(name: &str) -> image::GrayImage {
    let path = std::path::Path::new(DIR).join(format!("{name}.tif"));
    let img = image::open(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
    println!(
        "{name}: {}x{} color={:?}",
        img.width(),
        img.height(),
        img.color()
    );
    let luma = img.to_luma8();
    let white = luma.pixels().filter(|p| p.0[0] >= 128).count();
    println!("{name}: white {:.2}%", 100.0 * white as f64 / luma.pixels().len() as f64);
    luma
}

fn try_compose(tag: &str, sr: &image::GrayImage, metal: &image::GrayImage) {
    match afvi_parse_lib::align::overlay::compose_overlay(sr, metal) {
        Ok(out) => {
            let path = std::path::Path::new(OUT_DIR).join(format!("aligndata_overlay_{tag}.png"));
            out.save(&path).expect("save");
            println!(
                "compose {tag}: OK {}x{} -> {}",
                out.width(),
                out.height(),
                path.display()
            );
            // 2x zoom on the top-left fiducial (registration anchor).
            let corner = imageops::crop_imm(&out, 0, 0, 468, 468).to_image();
            imageops::resize(&corner, 936, 936, imageops::FilterType::Nearest)
                .save(std::path::Path::new(OUT_DIR).join(format!("aligndata_corner_{tag}.png")))
                .ok();
        }
        Err(error) => println!("compose {tag}: FAILED - {error}"),
    }
}

fn main() {
    let metal = report("Metal");
    let open = report("Open");
    let sr = report("SR");
    try_compose("sr_metal", &sr, &metal);
    try_compose("sr_open", &sr, &open);
    try_compose("metal_open", &metal, &open);
}

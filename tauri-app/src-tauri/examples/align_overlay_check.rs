//! Renders the colored Align/ROI overlay from the real layer tifs in
//! `tools/real_masks/` (see `Plan/ALIGN_OVERLAY_DEV_NOTES.md` for the full
//! method) and saves the full composite plus fiducial/BGA zoom crops for the
//! eyeball check. The pipeline itself lives in `align::overlay` - this example
//! is just the harness that re-tunes its display parameters on real data.
//!
//!   cargo run --release --example align_overlay_check

use image::imageops;

const REAL_DIR: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tools\real_masks";
const OUT_DIR: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan";

fn main() {
    let sr = image::open(std::path::Path::new(REAL_DIR).join("UNIT_0.tif"))
        .expect("UNIT_0.tif")
        .to_luma8();
    let metal = image::open(std::path::Path::new(REAL_DIR).join("Pattern.tif"))
        .expect("Pattern.tif")
        .to_luma8();
    println!("sr {}x{}, metal {}x{}", sr.width(), sr.height(), metal.width(), metal.height());

    // Candidates for the display compensation (working-grid px at 4096).
    // x compensation is the etch-shrink fix the user flagged ("横向太短");
    // y stays minimal.
    for dilate_x in [2u32, 4u32, 6u32] {
        let out = afvi_parse_lib::align::overlay::compose_overlay_with(&sr, &metal, 4096, dilate_x, 1)
            .unwrap_or_else(|error| panic!("compose failed: {error}"));
        let out_path = std::path::Path::new(OUT_DIR).join(format!("align_overlay_demo_dx{dilate_x}.png"));
        out.save(&out_path).expect("save demo");
        println!("dilate x{dilate_x}/y1: {}x{} -> {}", out.width(), out.height(), out_path.display());

        // 2x zoom on the BGA band to judge edge alignment and trace width.
        let zoom = imageops::crop_imm(&out, 819, 1053, 1405, 702).to_image();
        imageops::resize(&zoom, 1405, 702, imageops::FilterType::Nearest)
            .save(std::path::Path::new(OUT_DIR).join(format!("debug_zoom_dx{dilate_x}.png")))
            .ok();
    }

    // 2x zoom on the top-left fiducial cross (the registration anchor).
    let full = image::open(std::path::Path::new(OUT_DIR).join("align_overlay_demo_dx4.png")).expect("demo");
    let corner = imageops::crop_imm(&full, 0, 0, 468, 468).to_image();
    imageops::resize(&corner, 936, 936, imageops::FilterType::Nearest)
        .save(std::path::Path::new(OUT_DIR).join("debug_corner_dx4.png"))
        .ok();
    println!("wrote zooms to {OUT_DIR}");
}

//! Diagnostic: are the AlignData layers pre-registered on one shared grid?
//! Composes SR+Metal with NO cross-layer registration (identity on the union
//! bbox) and prints each layer's white bbox, to compare against the real
//! machine's overlay screenshot.
//!
//!   cargo run --release --example aligndata_identity

use image::{imageops, GrayImage, Luma, Rgba, RgbaImage};

const DIR: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tools\aligndata_7M99-631";
const OUT: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\docs\aligndata_identity.png";

fn load(name: &str) -> (GrayImage, (u32, u32, u32, u32)) {
    let luma = image::open(std::path::Path::new(DIR).join(format!("{name}.tif")))
        .expect(name)
        .to_luma8();
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0u32, 0u32);
    for (x, y, p) in luma.enumerate_pixels() {
        if p.0[0] >= 128 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    println!("{name}: {}x{} white bbox=({x0},{y0})-({x1},{y1})", luma.width(), luma.height());
    (luma, (x0, y0, x1, y1))
}

fn main() {
    let (sr, sb) = load("SR");
    let (metal, mb) = load("Metal");

    let x0 = sb.0.min(mb.0);
    let y0 = sb.1.min(mb.1);
    let x1 = sb.2.max(mb.2);
    let y1 = sb.3.max(mb.3);
    let (w, h) = (x1 - x0 + 1, y1 - y0 + 1);
    println!("union bbox {w}x{h}");

    let crop = |img: &GrayImage, b: (u32, u32, u32, u32)| -> GrayImage {
        imageops::crop_imm(img, b.0, b.1, b.2 - b.0 + 1, b.3 - b.1 + 1).to_image()
    };
    let sr_c = crop(&sr, (x0, y0, x1, y1));
    let metal_c = crop(&metal, (x0, y0, x1, y1));

    let work_w = 2000;
    let work_h = (h as f64 / w as f64 * work_w as f64).round() as u32;
    let sr_s = imageops::resize(&sr_c, work_w, work_h, imageops::FilterType::Triangle);
    let metal_s = imageops::resize(&metal_c, work_w, work_h, imageops::FilterType::Triangle);
    let _ = Luma([0u8]);

    let mut out = RgbaImage::from_pixel(work_w, work_h, Rgba([0, 0, 0, 255]));
    for (x, y, p) in sr_s.enumerate_pixels() {
        if p.0[0] >= 128 {
            out.put_pixel(x, y, Rgba([26, 158, 40, 255]));
        }
    }
    for (x, y, p) in metal_s.enumerate_pixels() {
        if p.0[0] >= 128 {
            out.put_pixel(x, y, Rgba([255, 214, 0, 255]));
        }
    }
    let _ = Luma([0u8]);
    out.save(OUT).expect("save");
    println!("wrote {OUT}");
}

//! Inspect the real masks: render downscaled grayscale previews and print
//! level statistics to pin down each layer's polarity (white-on-black vs
//! black-on-white).
//!
//!   cargo run --release --example inspect_masks

use image::imageops;

fn main() {
    for name in ["UNIT_0.tif", "Pattern.tif"] {
        let path = std::path::Path::new(r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tools\real_masks").join(name);
        let img = image::open(&path).expect(name).to_luma8();
        let n = (img.width() as u64) * (img.height() as u64);
        let mut hist = [0u64; 8];
        for l in img.pixels() {
            hist[(l.0[0] / 32) as usize] += 1;
        }
        let buckets: Vec<String> = hist
            .iter()
            .enumerate()
            .map(|(i, c)| format!("{:0>3}-{:<3}:{:5.1}%", i * 32, i * 32 + 31, *c as f64 / n as f64 * 100.0))
            .collect();
        println!("{name}: {}x{}, levels {}", img.width(), img.height(), buckets.join("  "));

        let small = imageops::resize(&img, 1400, (img.height() as f64 / img.width() as f64 * 1400.0) as u32, imageops::FilterType::Triangle);
        let out = format!(r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan\debug_real_{}", name.replace(".tif", ".png"));
        small.save(&out).unwrap();
        println!("  wrote {out}");
    }
}

//! Diagnose the user's failed 5-box align (seed 6320): four boxes on the
//! corner fiducial crosses + one on a scan-only white mark. Prints per-box
//! NCC/located/residual so the failure mode is a number, not a guess.
//!
//!   cargo run --release --example metal_sim_debug

use afvi_parse_lib::align::ecc::Transform;
use afvi_parse_lib::align::fiducial::{verify_with_rois, FiducialConfig, RoiRectIn};
use afvi_parse_lib::align::metal_sim::{offset_from_seed, sim_config, warp_layer};
use image::GenericImageView;

const MEDIAN: &str = r"\\192.168.1.61\PxRepository\25fbo015-15\2.0\Line\Top\Layer\MEDIAN\Median_0_1_0.tif";
const REPO: &str = r"\\192.168.1.61\PxRepository";
const INVENTORY: &str = r"\\192.168.1.61\PxInventory";
const GRID_MAX: u32 = 3072;
const SEED: u64 = 6320;
/// Half-side of the boxes the "user" draws (300 px total, like the app).
const BOX: f64 = 150.0;

fn to_grid(img: image::GrayImage) -> image::GrayImage {
    let (w, h) = img.dimensions();
    let long = w.max(h);
    if long <= GRID_MAX {
        return img;
    }
    let scale = GRID_MAX as f64 / long as f64;
    image::imageops::resize(
        &img,
        (w as f64 * scale).round() as u32,
        (h as f64 * scale).round() as u32,
        image::imageops::FilterType::Triangle,
    )
}

/// Per-box patch stats on the displaced metal layer: white ratio + std,
/// so "featureless box" is visible before any NCC runs.
fn patch_stats(layer: &image::GrayImage, roi: &RoiRectIn) -> (f64, f64) {
    let (x0, y0) = (roi.x.max(0.0) as u32, roi.y.max(0.0) as u32);
    let x1 = (roi.x + roi.w).min(f64::from(layer.width())).max(0.0) as u32;
    let y1 = (roi.y + roi.h).min(f64::from(layer.height())).max(0.0) as u32;
    if x1 <= x0 || y1 <= y0 {
        return (0.0, 0.0);
    }
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    let mut white = 0u32;
    let mut n = 0u32;
    for y in y0..y1 {
        for x in x0..x1 {
            let v = f64::from(layer.get_pixel(x, y).0[0]);
            sum += v;
            sum_sq += v * v;
            if v >= 128.0 {
                white += 1;
            }
            n += 1;
        }
    }
    let mean = sum / f64::from(n);
    ((100 * white) as f64 / f64::from(n), (sum_sq / f64::from(n) - mean * mean).sqrt())
}

fn main() {
    let median = to_grid(image::open(std::path::Path::new(MEDIAN)).expect("median").to_luma8());
    let metal = match afvi_parse_lib::align::resolve_aligndata_tifs(REPO, Some(INVENTORY), "25fbo015-15") {
        Ok(afvi_parse_lib::align::AlignDataLookup::Found(layers)) => to_grid(image::open(&layers.metal).expect("metal").to_luma8()),
        _ => panic!("no trio"),
    };
    let offset = offset_from_seed(SEED, median.width(), median.height());
    println!("offset tx={:.1} ty={:.1} theta={:.3}", offset.tx, offset.ty, offset.theta_deg);
    let displaced = warp_layer(&metal, &offset);

    // approximated from the user's screenshot (grid px, 3072x2107)
    let rois = vec![
        RoiRectIn { name: "ROI-2-TLcross".into(), x: 22.0, y: 0.0, w: 143.0, h: 140.0 },
        RoiRectIn { name: "ROI-3-BLcross".into(), x: 16.0, y: 1992.0, w: 140.0, h: 155.0 },
        RoiRectIn { name: "ROI-4-BRcross".into(), x: 2836.0, y: 1960.0, w: 149.0, h: 171.0 },
        RoiRectIn { name: "ROI-5-whitemark".into(), x: 2623.0, y: 594.0, w: 146.0, h: 177.0 },
        RoiRectIn { name: "ROI-6-pad".into(), x: 1240.0, y: 840.0, w: 180.0, h: 180.0 },
    ];
    for roi in &rois {
        let (white, std) = patch_stats(&displaced, roi);
        println!("{:>16}: white {white:5.1}%  std {std:6.1}", roi.name);
    }

    // the shipped config on the approximated boxes, then the honest sweep:
    // each seed's boxes are placed on the features AS SEEN AT THAT SEED'S
    // offset (what a user drawing on the view actually does)
    let config = sim_config();
    let report = verify_with_rois(&displaced, &median, &rois, &config, Transform::default()).expect("verify");
    println!("== seed {SEED}: verdict={} inliers={}/{}", report.verdict.level, report.inliers, report.matches.len());

    // nominal (undisplaced) positions of four corner crosses + one pad,
    // detected from the original metal layer: brightest white cluster within
    // each corner region
    let nominal = cross_nominals(&metal);
    println!("nominal crosses: {:?}", nominal);

    let mut failed = 0usize;
    let mut worst_located = 5usize;
    for seed in 0..400u64 {
        let seed = seed * 7919 + 13;
        let offset = offset_from_seed(seed, median.width(), median.height());
        let displaced = warp_layer(&metal, &offset);
        let placed: Vec<RoiRectIn> = nominal
            .iter()
            .chain(std::iter::once(&(1240.0 + 90.0, 840.0 + 90.0)))
            .enumerate()
            .map(|(i, (cx, cy))| RoiRectIn {
                name: format!("ROI-{i}"),
                x: cx + offset.tx - BOX,
                y: cy + offset.ty - BOX,
                w: BOX * 2.0,
                h: BOX * 2.0,
            })
            .collect();
        let r = verify_with_rois(&displaced, &median, &placed, &config, Transform::default()).unwrap();
        let located = r.matches.iter().filter(|m| m.located).count();
        worst_located = worst_located.min(located);
        if r.verdict.level != "ok" {
            failed += 1;
            if failed <= 5 {
                println!(
                    "  FAIL seed {:>8}: tx={:+6.1} ty={:+6.1} located={located} verdict={} {}",
                    seed,
                    offset.tx,
                    offset.ty,
                    r.verdict.level,
                    r.verdict.reasons.join(" | ")
                );
            }
        }
    }
    println!("honest sweep: {failed}/400 verdicts not-ok; worst located={worst_located}/5");
}

/// Centroid of the white blob nearest each canvas corner (within 400 px) on
/// the ORIGINAL metal layer - the four corner fiducial crosses.
fn cross_nominals(metal: &image::GrayImage) -> Vec<(f64, f64)> {
    let (w, h) = (metal.width() as i64, metal.height() as i64);
    let corners = [(0i64, 0i64), (0, h - 1), (w - 1, h - 1), (w - 1, 0)];
    corners
        .iter()
        .map(|(cx, cy)| {
            let (mut sx, mut sy, mut n) = (0f64, 0f64, 0u32);
            for y in (cy - 400).max(0)..=(cy + 400).min(h - 1) {
                for x in (cx - 400).max(0)..=(cx + 400).min(w - 1) {
                    if metal.get_pixel(x as u32, y as u32).0[0] >= 128 {
                        sx += x as f64;
                        sy += y as f64;
                        n += 1;
                    }
                }
            }
            (sx / f64::from(n), sy / f64::from(n))
        })
        .collect()
}

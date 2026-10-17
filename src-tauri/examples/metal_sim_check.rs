//! Real-data check for the ROI-driven align simulation (Plan 07 C): seed a
//! misalignment on the 25fbo015-15 pair, then run the REAL M5 ROI pipeline
//! (verify_with_rois) with (a) auto-picked feature-rich boxes - must align,
//! and (b) deliberately featureless boxes - must fail the verdict.
//!
//!   cargo run --release --example metal_sim_check

use afvi_parse_lib::align::ecc::Transform;
use afvi_parse_lib::align::fiducial::{verify_with_rois, RoiRectIn};
use afvi_parse_lib::align::metal_sim::{invert, offset_from_seed, sim_config, warp_layer};
use afvi_parse_lib::align::overlay::compose_median_metal;
use image::{GrayImage, GenericImageView};

const MEDIAN: &str = r"\\192.168.1.61\PxRepository\25fbo015-15\2.0\Line\Top\Layer\MEDIAN\Median_0_1_0.tif";
const REPO: &str = r"\\192.168.1.61\PxRepository";
const INVENTORY: &str = r"\\192.168.1.61\PxInventory";
const OUT_DIR: &str = r"C:\develop\DMT_AFVI_Color_Parameter_AutoParse\Plan";
const GRID_MAX: u32 = 3072;
const BOX: f64 = 180.0;
const SEED: u64 = 42;

fn to_grid(img: GrayImage) -> GrayImage {
    let (w, h) = img.dimensions();
    if w.max(h) <= GRID_MAX {
        return img;
    }
    let scale = GRID_MAX as f64 / w.max(h) as f64;
    image::imageops::resize(
        &img,
        (w as f64 * scale).round() as u32,
        (h as f64 * scale).round() as u32,
        image::imageops::FilterType::Triangle,
    )
}

/// The brightest / dimmest BOX-sized window per quadrant: brightest = marks
/// (feature-rich, what a user SHOULD draw), dimmest = blank board (the trap).
fn pick_windows(displaced: &GrayImage, brightest: bool) -> Vec<RoiRectIn> {
    let (w, h) = (displaced.width() as i64, displaced.height() as i64);
    let (bw, bh) = (BOX as i64, BOX as i64);
    let quads = [
        (0i64, 0i64, w / 2, h / 2),
        (w / 2, 0, w - bw, h / 2),
        (0, h / 2, w / 2, h - bh),
        (w / 2, h / 2, w - bw, h - bh),
    ];
    let mut rois = Vec::new();
    for (qi, (x0, y0, x1, y1)) in quads.iter().enumerate() {
        let mut best: Option<(f64, i64, i64)> = None;
        let mut y = *y0;
        while y + bh <= *y1 {
            let mut x = *x0;
            while x + bw <= *x1 {
                let mut sum = 0.0f64;
                for yy in (y..y + bh).step_by(4) {
                    for xx in (x..x + bw).step_by(4) {
                        sum += f64::from(displaced.get_pixel(xx as u32, yy as u32).0[0]);
                    }
                }
                let better = match best {
                    None => true,
                    Some((best_sum, _, _)) => if brightest { sum > best_sum } else { sum < best_sum },
                };
                if better {
                    best = Some((sum, x, y));
                }
                x += 40;
            }
            y += 40;
        }
        let (_, x, y) = best.expect("quadrant non-empty");
        rois.push(RoiRectIn {
            name: format!("ROI-{}", qi + 1),
            x: x as f64,
            y: y as f64,
            w: BOX,
            h: BOX,
        });
    }
    rois
}

fn main() {
    let started = std::time::Instant::now();
    let median = to_grid(image::open(std::path::Path::new(MEDIAN)).expect("median").to_luma8());
    let metal = match afvi_parse_lib::align::resolve_aligndata_tifs(REPO, Some(INVENTORY), "25fbo015-15") {
        Ok(afvi_parse_lib::align::AlignDataLookup::Found(layers)) => {
            to_grid(image::open(&layers.metal).expect("metal").to_luma8())
        }
        _ => panic!("no AlignData trio"),
    };
    println!("grid {}x{} ({:?})", median.width(), median.height(), started.elapsed());

    let offset = offset_from_seed(SEED, median.width(), median.height());
    println!("simulated offset tx={:.1} ty={:.1} theta={:.3}deg", offset.tx, offset.ty, offset.theta_deg);
    let truth = invert(&offset); // what the fit should recover
    println!("expected fit    tx={:.1} ty={:.1} theta={:.3}deg", truth.tx, truth.ty, truth.theta_deg);
    let displaced = warp_layer(&metal, &offset);
    compose_median_metal(&median, &displaced, GRID_MAX)
        .unwrap()
        .save(std::path::Path::new(OUT_DIR).join("metal_sim_offset.png"))
        .unwrap();

    for (tag, brightest) in [("good-ROIs", true), ("bad-ROIs", false)] {
        let rois = pick_windows(&displaced, brightest);
        for r in &rois {
            print!("  {} ({},{},{},{}) ", r.name, r.x, r.y, r.w, r.h);
        }
        println!();
        let report = verify_with_rois(&displaced, &median, &rois, &sim_config(), Transform::default()).expect("verify");
        println!(
            "{tag}: verdict={} inliers={}/{} mean_ncc={:.3} resid_rms={:.2} fit tx={:.1} ty={:.1} theta={:.3} ({:?})",
            report.verdict.level,
            report.inliers,
            report.matches.len(),
            report.mean_ncc,
            report.residual_rms,
            report.fit.tx,
            report.fit.ty,
            report.fit.theta_deg,
            report.verdict.reasons
        );
        let corrected = warp_layer(&displaced, &report.fit);
        compose_median_metal(&median, &corrected, GRID_MAX)
            .unwrap()
            .save(std::path::Path::new(OUT_DIR).join(format!("metal_sim_{tag}.png")))
            .unwrap();
    }
    println!("done ({:?})", started.elapsed());
}

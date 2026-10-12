//! Plan 07 C: simulated pre-align offset + real ROI-driven correction.
//!
//! The Metal layer is deterministically displaced (seeded translation + small
//! rotation) to fake the machine's pre-align state. The user draws ROI boxes
//! on the displaced view; the correction is computed by the REAL M5 pipeline
//! (`fiducial::verify_with_rois` - per-ROI NCC + RANSAC/Umeyama + verdict),
//! so featureless or inconsistent boxes genuinely fail. Nothing here leaks
//! the simulated truth into the fit: the seed only displaces the layer, the
//! aligner never sees it.

use super::ecc::{forward, Transform};
use super::fiducial::FiducialConfig;
use image::{GrayImage, Luma};

/// Simulated shift magnitude cap, as a fraction of the grid's short side,
/// per axis. Big enough to be obvious at a glance, small enough that one
/// ROI's local NCC search can still recover it (with the corner fiducials
/// partially clipping at the canvas edge, 3% of 2107 px measurably outran
/// the coarse match - 2% keeps the offset honest but findable).
pub const MAX_SHIFT_FRAC: f64 = 0.02;
/// Simulated rotation cap, degrees.
pub const MAX_THETA_DEG: f64 = 0.25;

/// Verdict config for CROSS-LAYER ROI matching (metal render vs median scan):
/// looser than the same-layer M5 defaults because the two modalities never
/// correlate perfectly (true-match NCC measures 0.70-0.83 on 25fbo015-15,
/// wrong-feature peaks land 0.41-0.60), but every NG gate stays - featureless
/// or inconsistent boxes still fail honestly.
pub fn sim_config() -> FiducialConfig {
    FiducialConfig {
        // covers MAX_SHIFT_FRAC plus the rotation swing at the corners
        local_search_px: 128,
        ncc_min: 0.6,
        ncc_ok: 0.7,
        ncc_ng: 0.35,
        resid_ok_px: 2.0,
        resid_ng_px: 6.0,
        ransac_inlier_px: 3.0,
        ..FiducialConfig::default()
    }
}

/// Deterministic misalignment for `seed` on a `w`×`h` grid (grid px). The
/// same seed always regenerates the same offset, so the frontend can ask for
/// "the view I let the user draw on" again when the align command runs.
/// Centre of the image is the rotation centre (same convention as
/// `ecc::forward` / the ROI fit).
pub fn offset_from_seed(seed: u64, w: u32, h: u32) -> Transform {
    let mut state = seed ^ 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    // -1.0 .. 1.0 per component (xorshift64 never yields 0, so % is unbiased enough)
    let unit = |next: &mut dyn FnMut() -> u64| ((next() % 2001) as f64 / 1000.0) - 1.0;
    let span = f64::from(w.min(h)) * MAX_SHIFT_FRAC;
    Transform {
        tx: unit(&mut next) * span,
        ty: unit(&mut next) * span,
        theta_deg: unit(&mut next) * MAX_THETA_DEG,
        scale: 1.0,
    }
}

/// Inverse of a similarity under the `ecc::forward` convention
/// (`q = c + s·R(θ)·(p−c) + t`), so `forward(invert(t), ·)` undoes `t`.
pub fn invert(t: &Transform) -> Transform {
    let theta = t.theta_deg.to_radians();
    let (sin, cos) = (theta.sin(), theta.cos());
    Transform {
        tx: -(t.tx * cos + t.ty * sin) / t.scale,
        ty: -(-t.tx * sin + t.ty * cos) / t.scale,
        theta_deg: -t.theta_deg,
        scale: 1.0 / t.scale,
    }
}

/// Displaces `layer` by `t` (content moves, canvas stays): output(q) samples
/// the layer at `forward(t)⁻¹(q)`, bilinear, black outside. This is both how
/// the simulated misalignment is produced and how the fitted correction is
/// applied afterwards (the fit maps displaced-layer coords -> median coords).
pub fn warp_layer(layer: &GrayImage, t: &Transform) -> GrayImage {
    let (w, h) = (layer.width() as usize, layer.height() as usize);
    let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
    let inv = invert(t);
    let buf = layer.as_raw().clone();
    let mut out = GrayImage::from_pixel(w as u32, h as u32, Luma([0]));
    for y in 0..h {
        for x in 0..w {
            let (sx, sy) = forward(&inv, cx, cy, x as f64, y as f64);
            if let Some(v) = sample_bilinear(&buf, w, h, sx, sy) {
                out.put_pixel(x as u32, y as u32, Luma([v]));
            }
        }
    }
    out
}

fn sample_bilinear(buf: &[u8], w: usize, h: usize, x: f64, y: f64) -> Option<u8> {
    if x < -1.0 || y < -1.0 || x > w as f64 || y > h as f64 {
        return None;
    }
    let (x0, y0) = (x.floor() as i64, y.floor() as i64);
    let (fx, fy) = (x - x0 as f64, y - y0 as f64);
    let at = |px: i64, py: i64| -> Option<f64> {
        if px < 0 || py < 0 || px >= w as i64 || py >= h as i64 {
            return None;
        }
        Some(f64::from(buf[py as usize * w + px as usize]))
    };
    let p00 = at(x0, y0)?;
    let p10 = at(x0 + 1, y0).unwrap_or(p00);
    let p01 = at(x0, y0 + 1).unwrap_or(p00);
    let p11 = at(x0 + 1, y0 + 1).unwrap_or(p00);
    let top = p00 * (1.0 - fx) + p10 * fx;
    let bottom = p01 * (1.0 - fx) + p11 * fx;
    Some((top * (1.0 - fy) + bottom * fy).round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dot_at(x: u32, y: u32) -> GrayImage {
        let mut img = GrayImage::from_pixel(100, 80, Luma([0]));
        img.put_pixel(x, y, Luma([255]));
        img
    }

    #[test]
    fn offset_is_deterministic_per_seed_and_bounded() {
        let a = offset_from_seed(42, 3072, 2117);
        let b = offset_from_seed(42, 3072, 2117);
        assert_eq!(a, b, "same seed, same offset");
        let others: Vec<_> = (0..20).map(|s| offset_from_seed(1000 + s, 3072, 2117)).collect();
        assert!(others.iter().any(|t| *t != a), "seeds actually vary");
        for t in [a].into_iter().chain(others) {
            assert!(t.tx.abs() <= 3072f64.min(2117f64) * MAX_SHIFT_FRAC + 1e-9);
            assert!(t.ty.abs() <= 3072f64.min(2117f64) * MAX_SHIFT_FRAC + 1e-9);
            assert!(t.theta_deg.abs() <= MAX_THETA_DEG + 1e-9);
        }
    }

    #[test]
    fn warp_moves_content_by_the_offset_and_correction_undoes_it() {
        // translate +10 x: the dot at (50,50) lands on (60,50)
        let off = Transform { tx: 10.0, ty: 0.0, theta_deg: 0.0, scale: 1.0 };
        let displaced = warp_layer(&dot_at(50, 50), &off);
        assert_eq!(displaced.get_pixel(60, 50).0[0], 255);
        assert_eq!(displaced.get_pixel(50, 50).0[0], 0);

        // the ROI fit maps displaced -> nominal, i.e. it is the INVERSE of the
        // simulated offset; applying it puts the dot back
        let corrected = warp_layer(&displaced, &invert(&off));
        assert_eq!(corrected.get_pixel(50, 50).0[0], 255);
        assert_eq!(corrected.get_pixel(60, 50).0[0], 0);
    }

    #[test]
    fn invert_twice_is_identity_and_rotation_warp_stays_sharp_enough() {
        let t = Transform { tx: 7.0, ty: -3.0, theta_deg: 0.4, scale: 1.0 };
        let back = invert(&invert(&t));
        assert!((back.tx - t.tx).abs() < 1e-9);
        assert!((back.ty - t.ty).abs() < 1e-9);
        assert!((back.theta_deg - t.theta_deg).abs() < 1e-9);

        // a solid block survives a max-strength warp with its centre white
        let mut block = GrayImage::from_pixel(200, 200, Luma([0]));
        for y in 80..120 {
            for x in 80..120 {
                block.put_pixel(x, y, Luma([255]));
            }
        }
        let off = offset_from_seed(7, 200, 200);
        let warped = warp_layer(&block, &off);
        assert_eq!(warped.get_pixel(100, 100).0[0], 255, "centre stays put under rotation about centre");
    }
}

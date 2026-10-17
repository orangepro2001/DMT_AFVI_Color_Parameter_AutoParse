//! M3 refinement aligner (Plan 05, spike option (a)): self-implemented ECC on
//! a 4-dof similarity transform, Gauss-Newton, pure Rust.
//!
//! The warp is the same forward map as the M1 generator's:
//! `W(x) = c + s·R(θ)·(x − c) + t` (template px -> input px), so a converged
//! solve reads out directly as the case truth. Each iteration:
//!
//! 1. sample the input at the current warp (bilinear); both images live as
//!    zero-mean/unit-std f64 buffers - the illumination robustness ECC is
//!    known for (design doc §6 L4);
//! 2. Jacobian rows `[gx, gy, gx·wx_θ + gy·wy_θ, gx·wx_s + gy·wy_s]` from
//!    precomputed central-difference gradient buffers sampled at W(x);
//! 3. Gauss-Newton step on the 4×4 normal equations, solved by a tiny
//!    hand-rolled pivoted solver (nalgebra arrives with M5's least squares -
//!    a 4x4 does not justify the dependency yet);
//! 4. the per-iteration Pearson correlation is recorded - M4 shows this curve
//!    as a teaching artifact.
//!
//! Pipeline (design doc §7 coarse-to-fine): the phase correlation supplies the
//! translation, then a 2-level pyramid runs Gauss-Newton at 1/4 resolution
//! first (wide basin for rotation/scale) and refines at full resolution.

use super::phase::phase_translation;
use super::{AlignResult, Aligner};
use image::GrayImage;

/// Pyramid levels as downsample factors, coarsest first. [4, 1] = one coarse
/// pass at quarter resolution, then the full-resolution refinement.
pub(crate) const PYRAMID_LEVELS: [u32; 2] = [4, 1];

/// Per-level iteration cap: Gauss-Newton converges quadratically, 30 is
/// already generous for a similarity warp with a translation seed.
pub(crate) const MAX_ITERATIONS: u32 = 30;

/// Stop when the correlation coefficient improves by less than this.
pub(crate) const CORRELATION_TOLERANCE: f64 = 1e-5;

pub struct EccAligner {
    /// PSR gate inherited from the coarse phase-correlation stage.
    pub psr_ok_threshold: f64,
}

impl Default for EccAligner {
    fn default() -> Self {
        // matches the M2 phase aligner's gate: the coarse stage must be
        // trustworthy before the refinement is allowed to start from it
        Self { psr_ok_threshold: super::phase::DEFAULT_PSR_OK_THRESHOLD }
    }
}

impl Aligner for EccAligner {
    fn name(&self) -> &str {
        "ecc-similarity"
    }

    fn align(&self, template: &GrayImage, input: &GrayImage) -> Result<AlignResult, String> {
        let started = std::time::Instant::now();
        if template.dimensions() != input.dimensions() {
            return Err(format!(
                "Grid mismatch: template {}x{} vs input {}x{}.",
                template.width(),
                template.height(),
                input.width(),
                input.height()
            ));
        }
        if template.width() == 0 || template.height() == 0 {
            return Err("Empty image.".into());
        }

        // Coarse stage: phase correlation pins the translation (and the PSR
        // confidence for the whole pipeline).
        let (tx, ty, psr) = phase_translation(template, input)?;
        let mut transform = Transform { tx, ty, theta_deg: 0.0, scale: 1.0 };

        // Refinement: coarse pyramid level first, then full resolution.
        let mut correlations: Vec<f64> = Vec::new();
        let mut converged = false;
        for &factor in PYRAMID_LEVELS.iter() {
            let (t_level, i_level) = if factor == 1 {
                (template.clone(), input.clone())
            } else {
                (downsample(template, factor), downsample(input, factor))
            };
            // truth px live on the full-res grid: scale the translation seed,
            // angles/scales are dimensionless and carry over as-is
            let seed = Transform { tx: transform.tx / f64::from(factor), ty: transform.ty / f64::from(factor), ..transform };
            let outcome = gauss_newton(&t_level, &i_level, seed, &mut correlations);
            // bring the level's px back to the full-res grid
            transform.tx = outcome.transform.tx * f64::from(factor);
            transform.ty = outcome.transform.ty * f64::from(factor);
            transform.theta_deg = outcome.transform.theta_deg;
            transform.scale = outcome.transform.scale;
            converged = outcome.converged || converged;
        }

        let final_corr = correlations.last().copied().unwrap_or(0.0);
        let mut result = AlignResult::new(self.name());
        result.tx_px = transform.tx;
        result.ty_px = transform.ty;
        result.theta_deg = transform.theta_deg;
        result.scale = transform.scale;
        result.score = final_corr;
        result.psr = psr;
        // OK needs both: coarse confidence AND a refinement that actually
        // converged (a hung iteration cap means "do not trust").
        result.ok = psr >= self.psr_ok_threshold && converged;
        result.elapsed_ms = started.elapsed().as_millis() as u64;
        result.message = format!(
            "PSR {psr:.1}, correlation {final_corr:.4}, {} iterations{}.",
            correlations.len(),
            if converged { "" } else { " - NO convergence (increase max_iterations?)" }
        );
        Ok(result)
    }
}

// ---- the warp model, shared with the M1 generator ----

/// Similar transform about the image center, identical to the generator's
/// forward map so truth comparison needs no convention bridging.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Transform {
    pub tx: f64,
    pub ty: f64,
    pub theta_deg: f64,
    pub scale: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Self { tx: 0.0, ty: 0.0, theta_deg: 0.0, scale: 1.0 }
    }
}

/// Maps template coordinates to input coordinates (the generator's forward).
pub(crate) fn forward(t: &Transform, cx: f64, cy: f64, x: f64, y: f64) -> (f64, f64) {
    let theta = t.theta_deg.to_radians();
    let (cos, sin) = (theta.cos(), theta.sin());
    let (u, v) = (x - cx, y - cy);
    (cx + t.scale * (u * cos - v * sin) + t.tx, cy + t.scale * (u * sin + v * cos) + t.ty)
}

pub(crate) struct GnOutcome {
    pub transform: Transform,
    pub converged: bool,
}

/// Gauss-Newton refinement of the similarity transform on one pyramid level.
/// Appends the per-iteration correlation to `correlations` (teaching curve).
pub(crate) fn gauss_newton(template: &GrayImage, input: &GrayImage, init: Transform, correlations: &mut Vec<f64>) -> GnOutcome {
    let (w, h) = (template.width() as usize, template.height() as usize);
    let (cx, cy) = ((w as f64 - 1.0) / 2.0, (h as f64 - 1.0) / 2.0);
    // Both images are smoothed before differentiation: our data is binary
    // masks / sharp camera blobs, and central differences on unblurred
    // step edges misestimate the local slope by large factors at the integer
    // kinks of the bilinear warp - enough to send Gauss-Newton uphill.
    let tsmooth = imageproc::filter::gaussian_blur_f32(template, 1.0);
    let ismooth = imageproc::filter::gaussian_blur_f32(input, 1.0);
    let tnorm = normalize(&tsmooth);
    let inorm = normalize(&ismooth);
    let (gx, gy) = gradients(&inorm, w, h);

    let mut p = init;
    let mut prev_corr = f64::MIN;
    let mut converged = false;

    for _ in 0..MAX_ITERATIONS {
        // Accumulate the normal equations over every template pixel.
        let mut h_mat = [0.0f64; 16];
        let mut b = [0.0f64; 4];
        let mut sse = 0.0f64;
        for y in 0..h {
            for x in 0..w {
                let (sx, sy) = forward(&p, cx, cy, x as f64, y as f64);
                let (Some(iv), Some(gxv), Some(gyv)) = (
                    sample(&inorm, w, h, sx, sy),
                    sample(&gx, w, h, sx, sy),
                    sample(&gy, w, h, sx, sy),
                ) else {
                    continue; // warped out of the canvas: no data term
                };
                let tv = tnorm[y * w + x];
                let e = iv - tv; // both zero-mean/unit-std: gain/offset gone

                // Jacobian of the warp w.r.t. (tx, ty, θ, s) at (x, y)
                let theta = p.theta_deg.to_radians();
                let (cos, sin) = (theta.cos(), theta.sin());
                let (u, v) = (x as f64 - cx, y as f64 - cy);
                let wx_theta = p.scale * (-u * sin - v * cos);
                let wy_theta = p.scale * (u * cos - v * sin);
                let wx_s = u * cos - v * sin;
                let wy_s = u * sin + v * cos;
                let j = [gxv, gyv, gxv * wx_theta + gyv * wy_theta, gxv * wx_s + gyv * wy_s];

                for r in 0..4 {
                    for c in 0..4 {
                        h_mat[r * 4 + c] += j[r] * j[c];
                    }
                    b[r] += j[r] * e;
                }
                sse += e * e;
            }
        }

        // Pearson r of two zero-mean unit-std signals: r = 1 - SSE / (2N).
        let n = (w * h) as f64;
        let corr = (1.0 - sse / (2.0 * n)).max(-1.0);
        correlations.push(corr);

        let Some(step) = solve4(&h_mat, &[-b[0], -b[1], -b[2], -b[3]]) else {
            return GnOutcome { transform: p, converged: false };
        };
        p.tx += step[0];
        p.ty += step[1];
        p.theta_deg += step[2].to_degrees();
        p.scale += step[3];

        if (corr - prev_corr).abs() < CORRELATION_TOLERANCE {
            converged = true;
            break;
        }
        prev_corr = corr;
    }

    GnOutcome { transform: p, converged }
}

/// Zero-mean / unit-std f64 copy - the ECC illumination normalization.
fn normalize(image: &GrayImage) -> Vec<f64> {
    let n = f64::from(image.width() * image.height());
    let mean = image.pixels().map(|p| f64::from(p.0[0])).sum::<f64>() / n;
    let var = image.pixels().map(|p| { let d = f64::from(p.0[0]) - mean; d * d }).sum::<f64>() / n;
    let std = var.sqrt().max(1e-9);
    image.pixels().map(|p| (f64::from(p.0[0]) - mean) / std).collect()
}

/// Central-difference gradients of an f64 buffer.
fn gradients(buf: &[f64], w: usize, h: usize) -> (Vec<f64>, Vec<f64>) {
    let at = |x: i64, y: i64| -> f64 {
        buf[y.clamp(0, h as i64 - 1) as usize * w + x.clamp(0, w as i64 - 1) as usize]
    };
    let mut gx = vec![0.0; w * h];
    let mut gy = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            gx[y * w + x] = (at(x as i64 + 1, y as i64) - at(x as i64 - 1, y as i64)) / 2.0;
            gy[y * w + x] = (at(x as i64, y as i64 + 1) - at(x as i64, y as i64 - 1)) / 2.0;
        }
    }
    (gx, gy)
}

pub(crate) fn sample(buf: &[f64], w: usize, h: usize, x: f64, y: f64) -> Option<f64> {
    if x < 0.0 || y < 0.0 || x > f64::from(w as u32 - 1) || y > f64::from(h as u32 - 1) {
        return None;
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let (fx, fy) = (x - x0 as f64, y - y0 as f64);
    let top = buf[y0 * w + x0] * (1.0 - fx) + buf[y0 * w + x1] * fx;
    let bottom = buf[y1 * w + x0] * (1.0 - fx) + buf[y1 * w + x1] * fx;
    Some(top * (1.0 - fy) + bottom * fy)
}

/// Solves a 4x4 system with partial pivoting. None when singular.
fn solve4(h: &[f64; 16], b: &[f64; 4]) -> Option<[f64; 4]> {
    let mut a = *h;
    let mut x = *b;
    for col in 0..4 {
        let pivot = (col..4).max_by(|r1, r2| a[r1 * 4 + col].abs().total_cmp(&a[r2 * 4 + col].abs()))?;
        if a[pivot * 4 + col].abs() < 1e-12 {
            return None;
        }
        // Row swap in the FLATTENED matrix: exchange whole rows, not scalars.
        if pivot != col {
            for c in 0..4 {
                a.swap(col * 4 + c, pivot * 4 + c);
            }
            x.swap(col, pivot);
        }
        let d = a[col * 4 + col];
        for r in 0..4 {
            if r == col {
                continue;
            }
            let f = a[r * 4 + col] / d;
            for c in col..4 {
                a[r * 4 + c] -= f * a[col * 4 + c];
            }
            x[r] -= f * x[col];
        }
    }
    let mut out = [0.0; 4];
    for r in 0..4 {
        out[r] = x[r] / a[r * 4 + r];
    }
    Some(out)
}

pub(crate) fn downsample(image: &GrayImage, factor: u32) -> GrayImage {
    if factor <= 1 {
        return image.clone();
    }
    let f = f64::from(factor);
    let dw = ((f64::from(image.width()) / f).round() as u32).max(1);
    let dh = ((f64::from(image.height()) / f).round() as u32).max(1);
    image::imageops::resize(image, dw, dh, image::imageops::FilterType::Triangle)
}

// ---- tests: the M3 acceptance criteria ----

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::generator::generate_case;
    use crate::align::{CaseParams, TruthTransform};
    use image::Luma;

    fn unique_base() -> GrayImage {
        let mut image = GrayImage::from_pixel(256, 256, Luma([40]));
        for y in 30..60 {
            for x in 40..90 {
                image.put_pixel(x, y, Luma([210]));
            }
        }
        for i in 0..12 {
            let x = 20 + i * 18;
            let len = 30 + i * 7;
            for y in 120..(120 + len).min(250) {
                image.put_pixel(x, y, Luma([180]));
            }
        }
        for y in 200..230 {
            for x in 180..230 {
                image.put_pixel(x, y, Luma([150]));
            }
        }
        image
    }

    const ALIGNER: EccAligner = EccAligner { psr_ok_threshold: super::super::phase::DEFAULT_PSR_OK_THRESHOLD };

    /// The M3 acceptance thresholds (spike decision (a)): sub-px translation,
    /// 0.1 deg rotation, 0.2 % scale on realistic synthetic cases.
    const TX_TOL: f64 = 0.5;
    const THETA_TOL: f64 = 0.1;
    const SCALE_TOL: f64 = 0.002;

    #[test]
    fn rotation_and_scale_cases_meet_the_m3_thresholds() {
        let base = unique_base();
        let cases = [
            (51u64, TruthTransform { tx_px: 8.0, ty_px: -5.0, theta_deg: 1.2, scale: 1.01 }),
            (52, TruthTransform { tx_px: -18.0, ty_px: 11.0, theta_deg: -0.8, scale: 0.99 }),
            (53, TruthTransform { tx_px: 3.0, ty_px: 14.0, theta_deg: 0.35, scale: 1.004 }),
        ];
        for (seed, truth) in cases {
            let params = CaseParams { noise_sigma: 2.0, gain: 1.1, offset: 6.0, blur_sigma: 0.6, occlusion_ratio: 0.0, downsample: 1 };
            let case = generate_case(&base, seed, Some(truth), &params);
            let r = ALIGNER.align(&case.template, &case.input).unwrap();
            assert!(r.ok, "seed {seed}: {}", r.message);
            assert!((r.tx_px - case.truth.tx_px).abs() <= TX_TOL, "seed {seed} tx {} vs {}", r.tx_px, case.truth.tx_px);
            assert!((r.ty_px - case.truth.ty_px).abs() <= TX_TOL, "seed {seed} ty {} vs {}", r.ty_px, case.truth.ty_px);
            assert!((r.theta_deg - case.truth.theta_deg).abs() <= THETA_TOL, "seed {seed} theta {} vs {}", r.theta_deg, case.truth.theta_deg);
            assert!((r.scale - case.truth.scale).abs() <= SCALE_TOL, "seed {seed} scale {} vs {}", r.scale, case.truth.scale);
        }
    }

    #[test]
    fn derived_cases_now_hit_the_full_similarity_thresholds() {
        // upgrade over M2: the whole derived range (theta <= 1.5 deg,
        // scale 1 +- 1 %) must land inside the M3 thresholds
        let base = unique_base();
        for seed in [101u64, 202, 303] {
            let params = CaseParams { noise_sigma: 2.5, blur_sigma: 0.5, ..CaseParams::default() };
            let case = generate_case(&base, seed, None, &params);
            let r = ALIGNER.align(&case.template, &case.input).unwrap();
            assert!(r.ok, "seed {seed}: {}", r.message);
            assert!((r.tx_px - case.truth.tx_px).abs() <= TX_TOL, "seed {seed} tx {}", r.tx_px - case.truth.tx_px);
            assert!((r.ty_px - case.truth.ty_px).abs() <= TX_TOL, "seed {seed} ty {}", r.ty_px - case.truth.ty_px);
            assert!((r.theta_deg - case.truth.theta_deg).abs() <= THETA_TOL, "seed {seed} theta {}", r.theta_deg - case.truth.theta_deg);
            assert!((r.scale - case.truth.scale).abs() <= SCALE_TOL, "seed {seed} scale {}", r.scale - case.truth.scale);
        }
    }

    #[test]
    fn pyramid_absorbs_rotations_beyond_the_generator_range() {
        // 4 deg / 3 % sits outside the generator's derived range: proves the
        // coarse pyramid level (not just fine-tuning) does real work
        let base = unique_base();
        let truth = TruthTransform { tx_px: -6.0, ty_px: 9.0, theta_deg: 4.0, scale: 1.03 };
        let case = generate_case(&base, 71, Some(truth), &CaseParams { noise_sigma: 2.0, blur_sigma: 0.5, ..CaseParams::default() });
        let r = ALIGNER.align(&case.template, &case.input).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!((r.tx_px - case.truth.tx_px).abs() <= TX_TOL, "tx {}", r.tx_px - case.truth.tx_px);
        assert!((r.theta_deg - case.truth.theta_deg).abs() <= THETA_TOL, "theta {}", r.theta_deg - case.truth.theta_deg);
        assert!((r.scale - case.truth.scale).abs() <= 0.005, "scale {}", r.scale - case.truth.scale);
    }

    #[test]
    fn correlation_curve_improves_and_converges() {
        // M4 will show this curve: it must actually go up and settle
        let base = unique_base();
        let truth = TruthTransform { tx_px: 10.0, ty_px: -7.0, theta_deg: 1.0, scale: 1.008 };
        let case = generate_case(&base, 81, Some(truth), &CaseParams { noise_sigma: 2.0, blur_sigma: 0.5, ..CaseParams::default() });
        let mut curve = Vec::new();
        let (tx, ty, _) = phase_translation(&case.template, &case.input).unwrap();
        let outcome = gauss_newton(&case.template, &case.input, Transform { tx, ty, theta_deg: 0.0, scale: 1.0 }, &mut curve);
        assert!(outcome.converged, "must converge, curve {curve:?}");
        assert!(curve.len() >= 2);
        assert!(curve.last().unwrap() > curve.first().unwrap(), "correlation must improve: {curve:?}");
        let settle = (curve.last().unwrap() - curve[curve.len() - 2]).abs();
        assert!(settle < 1e-3, "curve must settle, last delta {settle}");
    }

    #[test]
    fn illumination_change_does_not_break_the_refinement() {
        let base = unique_base();
        let truth = TruthTransform { tx_px: 6.0, ty_px: -9.0, theta_deg: 0.9, scale: 1.006 };
        let params = CaseParams { noise_sigma: 1.0, gain: 1.5, offset: 25.0, blur_sigma: 0.4, occlusion_ratio: 0.0, downsample: 1 };
        let case = generate_case(&base, 91, Some(truth), &params);
        let r = ALIGNER.align(&case.template, &case.input).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!((r.theta_deg - case.truth.theta_deg).abs() <= THETA_TOL);
        assert!((r.scale - case.truth.scale).abs() <= SCALE_TOL);
    }

    #[test]
    fn grid_mismatch_and_empty_images_error_out() {
        let a = GrayImage::from_pixel(8, 8, Luma([0]));
        let b = GrayImage::from_pixel(8, 4, Luma([0]));
        assert!(ALIGNER.align(&a, &b).is_err());
        let e = GrayImage::new(0, 0);
        assert!(ALIGNER.align(&e, &e).is_err());
    }

    #[test]
    fn solver_handles_pivoting_and_singular_systems() {
        // regression lock: the row swap used to exchange two SCALARS of the
        // flattened matrix instead of two rows, silently corrupting every
        // solve that needed pivoting - and sending Gauss-Newton uphill.
        let a = [2.0, 1.0, 0.0, 0.0, 1.0, 3.0, 1.0, 0.0, 0.0, 1.0, 2.0, 1.0, 0.0, 0.0, 1.0, 2.0];
        let x_true = [1.0, 2.0, 3.0, 4.0];
        let mut b = [0.0; 4];
        for r in 0..4 {
            for c in 0..4 {
                b[r] += a[r * 4 + c] * x_true[c];
            }
        }
        let solved = solve4(&a, &b).unwrap();
        for r in 0..4 {
            assert!((solved[r] - x_true[r]).abs() < 1e-9, "{solved:?}");
        }
        // a system that needs pivoting: zeros on the diagonal
        let pivoting = [0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 2.0, 0.0];
        let solved = solve4(&pivoting, &[1.0, 2.0, 3.0, 4.0]).unwrap();
        assert!((solved[0] - 2.0).abs() < 1e-12 && (solved[1] - 1.0).abs() < 1e-12);
        assert!((solved[2] - 2.0).abs() < 1e-12 && (solved[3] - 1.5).abs() < 1e-12);
        // singular -> None, never garbage
        assert!(solve4(&[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &[1.0, 0.0, 0.0, 0.0]).is_none());
    }
}

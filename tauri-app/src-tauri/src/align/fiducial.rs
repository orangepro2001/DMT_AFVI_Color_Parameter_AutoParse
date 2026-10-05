//! M5 fiducial verification (Plan 05): the "is the transform trustworthy?"
//! layer on top of the M2+M3 pipeline.
//!
//! The machine's own teaching philosophy: global solvers can be silently
//! wrong (periodic ambiguity, scale drift), but distinctive fiducial patches
//! matched independently give ground-truth correspondences to check against.
//!
//! Pipeline:
//! 1. **select** K high-variance template patches (the stand-in for the real
//!    MK pads/crosses - on real teaching data these would be the machine's
//!    fiducial marks);
//! 2. **locate** each patch in the input: NCC coarse match at 1/4 resolution
//!    over the whole image, then a full-resolution local refine
//!    (`imageproc::template_matching::match_template`, normalized);
//! 3. **fit** the similarity transform with Umeyama (nalgebra SVD), RANSAC
//!    when N>=4 to survive wrong matches;
//! 4. **judge** with the confidence system: mean NCC, coarse PSR, residual
//!    RMS, and the *distance consistency* of the fiducial pairs - the one
//!    metric that catches a scale error a translation-only solver cannot see
//!    (the pair distances on the input are simply larger/smaller).
//!
//! All thresholds are configurable; the verdict is OK / manual / NG.

use super::ecc::{forward, Transform};
use super::generator::SeededRng;
use super::phase::phase_translation;
use image::{GrayImage, Luma};
use imageproc::template_matching::{match_template, MatchTemplateMethod};
use nalgebra::{Matrix2, SVD, Vector2};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FiducialConfig {
    /// How many patches to select.
    pub num_fiducials: usize,
    /// Patch side in px (working grid).
    pub patch: u32,
    /// Local search half-width around the prior's prediction, px. Must cover
    /// the prior's expected error (translation-only prior + rotation/scale
    /// truth needs a few px on teaching-size boards).
    pub local_search_px: i64,
    /// Minimum NCC score to accept a match.
    pub ncc_min: f64,
    /// Verdict thresholds (all configurable - Plan 05 M5).
    pub psr_ok: f64,
    pub ncc_ok: f64,
    pub ncc_ng: f64,
    pub resid_ok_px: f64,
    pub resid_ng_px: f64,
    /// |mean distance ratio - 1| above this flags a scale error.
    pub scale_tol: f64,
    /// RANSAC inlier residual, px.
    pub ransac_inlier_px: f64,
    pub min_matches: usize,
}

impl Default for FiducialConfig {
    fn default() -> Self {
        Self {
            num_fiducials: 9,
            patch: 24,
            local_search_px: 12,
            ncc_min: 0.7,
            psr_ok: super::phase::DEFAULT_PSR_OK_THRESHOLD,
            ncc_ok: 0.85,
            ncc_ng: 0.5,
            resid_ok_px: 1.0,
            resid_ng_px: 3.0,
            scale_tol: 0.005,
            ransac_inlier_px: 1.5,
            min_matches: 3,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FiducialMatch {
    pub template: (f64, f64),
    pub input: (f64, f64),
    pub ncc: f64,
    /// Distance from the fitted transform's prediction to the located point.
    pub residual_px: f64,
    pub inlier: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DistanceConsistency {
    /// Mean of |input pair distance| / |template pair distance| over all
    /// fiducial pairs - ~1.0 unless the two images live on different scales.
    pub mean_ratio: f64,
    pub std_ratio: f64,
    pub scale_flagged: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Verdict {
    /// "ok" | "manual" | "ng"
    pub level: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FiducialReport {
    pub matches: Vec<FiducialMatch>,
    /// Umeyama similarity fit over the inliers (template -> input).
    pub fit: Transform,
    pub residual_rms: f64,
    pub mean_ncc: f64,
    pub psr: f64,
    pub distance: DistanceConsistency,
    pub inliers: usize,
    pub verdict: Verdict,
}

/// Full fiducial verification of one case's image pair. `prior` is the
/// global transform to verify (the phase/ECC solver output); with `None` the
/// identity is used and every patch is searched around its template position.
pub fn verify(template: &GrayImage, input: &GrayImage, config: &FiducialConfig, prior: Transform) -> Result<FiducialReport, String> {
    if template.dimensions() != input.dimensions() {
        return Err(format!(
            "Grid mismatch: template {}x{} vs input {}x{}.",
            template.width(),
            template.height(),
            input.width(),
            input.height()
        ));
    }
    if template.width() < config.patch + 2 || template.height() < config.patch + 2 {
        return Err("Image too small for the fiducial patch size.".into());
    }
    let center = center_of(template);

    // 1+2: select patches and locate them around the prior's prediction.
    let centers = select_fiducials(template, config.num_fiducials, config.patch);
    let mut matches: Vec<FiducialMatch> = Vec::new();
    for c in &centers {
        let predicted = forward(&prior, center.0, center.1, c.0, c.1);
        if let Some(m) = locate_patch(template, input, *c, predicted, config) {
            matches.push(m);
        }
    }

    // 3: similarity fit with RANSAC (deterministic seed - D4).
    let center = center_of(template);
    let mut rng = SeededRng::new(0x4F1D);
    let (fit, inlier_flags) = fit_with_ransac(&matches, &mut rng, config, center);
    for (m, inlier) in matches.iter_mut().zip(inlier_flags.iter()) {
        m.inlier = *inlier;
        let predicted = forward(&fit, center.0, center.1, m.template.0, m.template.1);
        m.residual_px = (predicted.0 - m.input.0).hypot(predicted.1 - m.input.1);
    }
    let inliers: Vec<&FiducialMatch> = matches.iter().filter(|m| m.inlier).collect();
    let inlier_count = inliers.len();
    let residual_rms = if inliers.is_empty() {
        f64::INFINITY
    } else {
        (inliers.iter().map(|m| m.residual_px * m.residual_px).sum::<f64>() / inliers.len() as f64).sqrt()
    };
    let mean_ncc = if matches.is_empty() {
        0.0
    } else {
        matches.iter().map(|m| m.ncc).sum::<f64>() / matches.len() as f64
    };

    // 4: distance consistency - the scale catcher. The coarse PSR is a
    // soft input: on heavily degraded images the phase correlation may not
    // produce a usable surface at all, which is a confidence signal (0), not
    // a reason to abort the verification.
    let psr = phase_translation(template, input).map(|(_, _, p)| p).unwrap_or(0.0);
    let distance = distance_consistency(&matches, config);

    let verdict = judge(config, matches.len(), inlier_count, mean_ncc, psr, residual_rms, &distance);
    Ok(FiducialReport { matches, fit, residual_rms, mean_ncc, psr, distance, inliers: inlier_count, verdict })
}

// ---- stage 1: patch selection (Shi-Tomasi) ----

/// Picks the K most "corner-like" patch centers (Shi-Tomasi: the smaller
/// eigenvalue of the structure tensor). High variance alone is a trap - it
/// selects long straight edges, and sliding an NCC patch along an edge keeps
/// the score near-perfect at every position. A corner (cross, L, block
/// corner) has gradients in two orientations, so its min eigenvalue is large
/// while a straight edge's stays near zero.
fn select_fiducials(template: &GrayImage, k: usize, patch: u32) -> Vec<(f64, f64)> {
    let (w, h) = (template.width(), template.height());
    let half = patch / 2;
    let mut candidates: Vec<(f64, f64, f64)> = Vec::new(); // (x, y, min eigenvalue)
    let step = patch.max(8);
    let mut y = half;
    while y + half < h {
        let mut x = half;
        while x + half < w {
            let score = shi_tomasi(template, x, y, patch);
            if score > 50.0 {
                candidates.push((f64::from(x), f64::from(y), score));
            }
            x += step;
        }
        y += step;
    }
    candidates.sort_by(|a, b| b.2.total_cmp(&a.2));
    let min_sep = f64::from(patch * 2);
    let mut picked: Vec<(f64, f64)> = Vec::new();
    for (x, y, _) in candidates {
        if picked.len() >= k {
            break;
        }
        if picked.iter().all(|(px, py)| (px - x).hypot(py - y) >= min_sep) {
            picked.push((x, y));
        }
    }
    picked
}

/// Smaller eigenvalue of the windowed structure tensor (Shi-Tomasi score).
fn shi_tomasi(image: &GrayImage, cx: u32, cy: u32, patch: u32) -> f64 {
    let (w, h) = (image.width() as i64, image.height() as i64);
    let half = (patch / 2) as i64;
    let grad = |x: i64, y: i64| -> (f64, f64) {
        let cl = |v: i64, max: i64| v.clamp(0, max - 1) as u32;
        let at = |xx: i64, yy: i64| f64::from(image.get_pixel(cl(xx, w), cl(yy, h)).0[0]);
        ((at(x + 1, y) - at(x - 1, y)) / 2.0, (at(x, y + 1) - at(x, y - 1)) / 2.0)
    };
    let (mut a, mut b, mut c) = (0.0, 0.0, 0.0);
    for yy in cy as i64 - half..cy as i64 + half {
        for xx in cx as i64 - half..cx as i64 + half {
            let (gx, gy) = grad(xx, yy);
            a += gx * gx;
            b += gx * gy;
            c += gy * gy;
        }
    }
    let mean = (a + c) / 2.0;
    let root = (((a - c) / 2.0).powi(2) + b * b).sqrt();
    (mean - root).max(0.0)
}

// ---- stage 2: patch location (coarse NCC + full-res refine) ----

fn locate_patch(template: &GrayImage, input: &GrayImage, center: (f64, f64), predicted: (f64, f64), config: &FiducialConfig) -> Option<FiducialMatch> {
    let patch = config.patch;
    let half = patch / 2;
    let cx = center.0.clamp(f64::from(half), f64::from(template.width() - 1 - half));
    let cy = center.1.clamp(f64::from(half), f64::from(template.height() - 1 - half));
    let px = cx as u32 - half;
    let py = cy as u32 - half;
    let patch_img = image::imageops::crop_imm(template, px, py, patch, patch).to_image();

    // Local search window around the predicted position (prior-based
    // verification). The window must stay strictly larger than the patch.
    // A garbage prior (heavily degraded input) can push the prediction far
    // outside the canvas - clamp in i64 so the u32 math cannot underflow.
    let search = config.local_search_px as f64;
    let iw = i64::from(input.width());
    let ih = i64::from(input.height());
    let wx0 = ((predicted.0 - f64::from(half) - search).floor().max(0.0) as i64).min(iw - 1);
    let wy0 = ((predicted.1 - f64::from(half) - search).floor().max(0.0) as i64).min(ih - 1);
    let wx1 = ((predicted.0 + f64::from(half) + search).ceil().max(1.0) as i64).min(iw);
    let wy1 = ((predicted.1 + f64::from(half) + search).ceil().max(1.0) as i64).min(ih);
    if wx1 - wx0 <= i64::from(patch) || wy1 - wy0 <= i64::from(patch) {
        return None;
    }
    let window = image::imageops::crop_imm(input, wx0 as u32, wy0 as u32, (wx1 - wx0) as u32, (wy1 - wy0) as u32).to_image();
    let refined = match_template(&window, &patch_img, MatchTemplateMethod::CrossCorrelationNormalized);
    let (rx, ry) = argmax_finite(&refined)?;
    let ncc = refined.get_pixel(rx, ry).0[0] as f64;
    if !ncc.is_finite() || ncc < config.ncc_min {
        return None;
    }
    // Parabolic sub-pixel refinement of the NCC peak (same trick as the M2
    // phase correlation): integer peaks quantize point positions to +-0.5px,
    // which inflates every pair-distance ratio measurement.
    let at = |x: i64, y: i64| -> f64 {
        let cl = |v: i64, max: i64| v.clamp(0, max) as u32;
        f64::from(refined.get_pixel(cl(x, refined.width() as i64 - 1), cl(y, refined.height() as i64 - 1)).0[0])
    };
    let sub = |l: f64, c: f64, r: f64| -> f64 {
        let denom = l - 2.0 * c + r;
        if denom.abs() < 1e-12 { 0.0 } else { (0.5 * (l - r) / denom).clamp(-0.5, 0.5) }
    };
    let fx = sub(at(rx as i64 - 1, ry as i64), f64::from(rx), at(rx as i64 + 1, ry as i64));
    let fy = sub(at(rx as i64, ry as i64 - 1), f64::from(ry), at(rx as i64, ry as i64 + 1));
    let input_point = (wx0 as f64 + f64::from(rx) + f64::from(half) + fx, wy0 as f64 + f64::from(ry) + f64::from(half) + fy);
    Some(FiducialMatch { template: (cx, cy), input: input_point, ncc, residual_px: 0.0, inlier: true })
}

fn argmax_finite(map: &image::ImageBuffer<Luma<f32>, Vec<f32>>) -> Option<(u32, u32)> {
    let mut best = f32::MIN;
    let mut at = None;
    for (x, y, p) in map.enumerate_pixels() {
        let v = p.0[0];
        if v.is_finite() && v > best {
            best = v;
            at = Some((x, y));
        }
    }
    at
}

// ---- stage 3: Umeyama + RANSAC ----

/// Umeyama similarity fit: `dst = s·R·src + t0`. Returns (scale, theta_deg, t0).
/// The reflection branch (det<0) is resolved with the standard S correction.
fn umeyama(src: &[(f64, f64)], dst: &[(f64, f64)]) -> Option<(f64, f64, (f64, f64))> {
    let n = src.len();
    if n < 2 {
        return None;
    }
    let mu_s = Vector2::new(src.iter().map(|p| p.0).sum::<f64>() / n as f64, src.iter().map(|p| p.1).sum::<f64>() / n as f64);
    let mu_d = Vector2::new(dst.iter().map(|p| p.0).sum::<f64>() / n as f64, dst.iter().map(|p| p.1).sum::<f64>() / n as f64);
    let mut cov = Matrix2::zeros();
    let mut sig2 = 0.0;
    for (s, d) in src.iter().zip(dst.iter()) {
        let sv = Vector2::new(s.0 - mu_s.x, s.1 - mu_s.y);
        let dv = Vector2::new(d.0 - mu_d.x, d.1 - mu_d.y);
        cov += dv * sv.transpose();
        sig2 += sv.norm_squared();
    }
    cov /= n as f64;
    sig2 /= n as f64;
    if sig2 < 1e-9 {
        return None; // degenerate: all template points coincide
    }
    let svd: SVD<f64, nalgebra::U2, nalgebra::U2> = cov.svd(true, true);
    let u = svd.u?;
    // v holds Vᵀ from the SVD of cov = Σ d·sᵀ; the rotation taking src onto
    // dst is R = U·S·Vᵀ - with the plain product the angle comes back
    // mirrored, which passes every magnitude check and fails every sign.
    let v = svd.v_t?;
    let d = svd.singular_values;
    let mut s_mat = Matrix2::identity();
    if u.determinant() * v.determinant() < 0.0 {
        s_mat[(1, 1)] = -1.0;
    }
    let r = u * s_mat * v;
    let scale = (d[0] * s_mat[(0, 0)] + d[1] * s_mat[(1, 1)]) / sig2;
    if scale <= 1e-6 {
        return None;
    }
    let t0 = mu_d - scale * r * mu_s;
    Some((scale, r[(1, 0)].atan2(r[(0, 0)]), (t0.x, t0.y)))
}

/// The Umeyama fit expressed as our [`Transform`]: forward is
/// `q = c + s·R(θ)·(p − c) + t` about the image center `c`, so an arbitrary
/// `dst = s·R·src + t0` converts with `t = t0 − c + s·R·c`.
fn umeyama_transform(src: &[(f64, f64)], dst: &[(f64, f64)], center: (f64, f64)) -> Option<Transform> {
    let (scale, theta, t0) = umeyama(src, dst)?;
    let (cx, cy) = center;
    let (cos, sin) = (theta.cos(), theta.sin());
    Some(Transform {
        tx: t0.0 - cx + scale * (cos * cx - sin * cy),
        ty: t0.1 - cy + scale * (sin * cx + cos * cy),
        theta_deg: theta.to_degrees(),
        scale,
    })
}

/// RANSAC over the point pairs (2-point minimal sample), then a refit on the
/// inliers. With fewer than 4 pairs it fits everything (nothing to vote out).
/// The returned Transform is parametrized about `center`.
fn fit_with_ransac(matches: &[FiducialMatch], rng: &mut SeededRng, config: &FiducialConfig, center: (f64, f64)) -> (Transform, Vec<bool>) {
    let fit_flags = |flags: &[bool]| -> Option<Transform> {
        let src: Vec<(f64, f64)> = matches.iter().zip(flags).filter(|(_, f)| **f).map(|(m, _)| m.template).collect();
        let dst: Vec<(f64, f64)> = matches.iter().zip(flags).filter(|(_, f)| **f).map(|(m, _)| m.input).collect();
        umeyama_transform(&src, &dst, center)
    };
    let residual = |fit: &Transform, m: &FiducialMatch| {
        let p = forward(fit, center.0, center.1, m.template.0, m.template.1);
        (p.0 - m.input.0).hypot(p.1 - m.input.1)
    };

    if matches.len() < 4 {
        let flags = vec![true; matches.len()];
        let fit = fit_flags(&flags).unwrap_or(Transform::default());
        return (fit, flags);
    }

    let mut best_flags = vec![true; matches.len()];
    let mut best_count = 0usize;
    for _ in 0..30 {
        let i = (rng.next_f64() * matches.len() as f64) as usize % matches.len();
        let mut j = (rng.next_f64() * matches.len() as f64) as usize % matches.len();
        while j == i {
            j = (j + 1) % matches.len();
        }
        if (matches[i].template.0 - matches[j].template.0).hypot(matches[i].template.1 - matches[j].template.1) < 1e-6 {
            continue;
        }
        let sample_flags: Vec<bool> = (0..matches.len()).map(|k| k == i || k == j).collect();
        let Some(candidate) = fit_flags(&sample_flags) else { continue };
        let count = matches.iter().filter(|m| residual(&candidate, m) <= config.ransac_inlier_px).count();
        if count > best_count {
            best_count = count;
            best_flags = matches.iter().map(|m| residual(&candidate, m) <= config.ransac_inlier_px).collect();
        }
    }
    if best_count < 2 {
        best_flags = vec![true; matches.len()];
    }
    // Refit on the inlier set and re-flag: the 2-point consensus sample is
    // noisy (point quantization), a refit from 5+ points pins the transform
    // down and stops borderline matches from flickering in and out.
    let mut fit = fit_flags(&best_flags).unwrap_or(Transform::default());
    for _ in 0..3 {
        let flags: Vec<bool> = matches.iter().map(|m| residual(&fit, m) <= config.ransac_inlier_px).collect();
        if flags == best_flags {
            break;
        }
        best_flags = flags;
        fit = fit_flags(&best_flags).unwrap_or(fit);
    }
    (fit, best_flags)
}

fn center_of(image: &GrayImage) -> (f64, f64) {
    ((f64::from(image.width()) - 1.0) / 2.0, (f64::from(image.height()) - 1.0) / 2.0)
}

// ---- stage 4: distance consistency + verdict ----

fn distance_consistency(matches: &[FiducialMatch], config: &FiducialConfig) -> DistanceConsistency {
    let n = matches.len();
    if n < 2 {
        return DistanceConsistency { mean_ratio: 1.0, std_ratio: 0.0, scale_flagged: false };
    }
    let mut ratios = Vec::new();
    for i in 0..n {
        for j in i + 1..n {
            let d_src = (matches[i].template.0 - matches[j].template.0).hypot(matches[i].template.1 - matches[j].template.1);
            let d_dst = (matches[i].input.0 - matches[j].input.0).hypot(matches[i].input.1 - matches[j].input.1);
            if d_src > 1e-6 {
                ratios.push(d_dst / d_src);
            }
        }
    }
    if ratios.is_empty() {
        return DistanceConsistency { mean_ratio: 1.0, std_ratio: 0.0, scale_flagged: false };
    }
    let mean = ratios.iter().sum::<f64>() / ratios.len() as f64;
    let std = (ratios.iter().map(|r| (r - mean) * (r - mean)).sum::<f64>() / ratios.len() as f64).sqrt();
    let scale_flagged = (mean - 1.0).abs() > config.scale_tol;
    DistanceConsistency { mean_ratio: mean, std_ratio: std, scale_flagged }
}

fn judge(
    config: &FiducialConfig,
    matches: usize,
    inliers: usize,
    mean_ncc: f64,
    psr: f64,
    residual_rms: f64,
    distance: &DistanceConsistency,
) -> Verdict {
    let mut reasons = Vec::new();
    let mut level = "ok";

    let mut flag = |cond: bool, ng: bool, reason: String| {
        if cond {
            reasons.push(reason.clone());
            if ng {
                level = "ng";
            } else if level == "ok" {
                level = "manual";
            }
        }
    };

    flag(matches < config.min_matches, true, format!("有效基准点 {matches} 不足（需 {}）", config.min_matches));
    flag(inliers < config.min_matches, true, format!("RANSAC 内点 {inliers} 不足，匹配可能不可靠"));
    flag(mean_ncc < config.ncc_ng, true, format!("平均 NCC {mean_ncc:.2} 低于 NG 门 {}", config.ncc_ng));
    flag(residual_rms > config.resid_ng_px, true, format!("残差 RMS {residual_rms:.2}px 超过 NG 门 {}px", config.resid_ng_px));
    flag(distance.scale_flagged, true, format!(
        "距离一致性比值 {:.4} 偏离 1 超过 {}（尺度错误嫌疑——纯平移求解器看不见的那类）",
        distance.mean_ratio, config.scale_tol
    ));
    flag(psr < config.psr_ok, false, format!("粗对齐 PSR {psr:.1} 低于 {}", config.psr_ok));
    flag(mean_ncc < config.ncc_ok, false, format!("平均 NCC {mean_ncc:.2} 低于 OK 门 {}", config.ncc_ok));
    flag(residual_rms > config.resid_ok_px, false, format!("残差 RMS {residual_rms:.2}px 超过 OK 门 {}px", config.resid_ok_px));

    Verdict { level: level.into(), reasons }
}

// ---- tests: the M5 acceptance criteria ----

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::generator::generate_case;
    use crate::align::{CaseParams, TruthTransform};
    use image::Luma;

    fn base() -> GrayImage {
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
        // Machine-style unique fiducial marks: designed to be distinctive,
        // exactly like the real MK crosses (a fiducial that looks like
        // somewhere else is not a fiducial - the uniqueness filter enforces
        // this and the fixture must honor it).
        for i in -10..=10 {
            // cross
            image.put_pixel((150 + i) as u32, 40 as u32, Luma([240]));
            image.put_pixel(150 as u32, (40 + i) as u32, Luma([240]));
            // L mark
            if i >= -10 {
                image.put_pixel((100 + i) as u32, 90 as u32, Luma([240]));
            }
            image.put_pixel(100, (90 + i + 10) as u32, Luma([240]));
            // diagonal
            image.put_pixel((60 + i + 10) as u32, (140 + i + 10) as u32, Luma([240]));
        }
        image
    }

    /// The teaching prior: the phase-correlation solve (translation-only, the
    /// M2 baseline the fiducial layer verifies).
    fn phase_prior(template: &GrayImage, input: &GrayImage) -> Transform {
        let r = crate::align::Aligner::align(&crate::align::phase::PhaseCorrelateAligner::default(), template, input).unwrap();
        Transform { tx: r.tx_px, ty: r.ty_px, theta_deg: 0.0, scale: 1.0 }
    }

    fn verify_case(seed: u64, truth: TruthTransform, params: CaseParams) -> (FiducialReport, TruthTransform) {
        let case = generate_case(&base(), seed, Some(truth), &params);
        let prior = phase_prior(&case.template, &case.input);
        let report = verify(&case.template, &case.input, &FiducialConfig::default(), prior).unwrap();
        (report, case.truth)
    }

    #[test]
    fn scale_difference_case_is_caught_by_distance_consistency() {
        // M5 acceptance: the metric a translation-only solver cannot see.
        // A 2% scale error lifts every pair-distance ratio to ~1.02.
        let (report, truth) = verify_case(61, TruthTransform { tx_px: 5.0, ty_px: -3.0, theta_deg: 0.0, scale: 1.02 }, CaseParams { noise_sigma: 1.5, blur_sigma: 0.4, ..CaseParams::default() });
        assert!((truth.scale - 1.02).abs() < 1e-9);
        assert!(
            (report.distance.mean_ratio - 1.02).abs() <= 0.01,
            "mean ratio {} should sit at ~1.02",
            report.distance.mean_ratio
        );
        assert!(report.distance.scale_flagged, "distance consistency must flag the scale error");
        assert_ne!(report.verdict.level, "ok", "{:?}", report.verdict.reasons);
    }

    #[test]
    fn clean_translation_case_is_consistent_and_ok() {
        let (report, truth) = verify_case(62, TruthTransform { tx_px: 7.0, ty_px: -11.0, theta_deg: 0.0, scale: 1.0 }, CaseParams { noise_sigma: 1.5, blur_sigma: 0.4, ..CaseParams::default() });
        assert!((report.distance.mean_ratio - 1.0).abs() <= 0.005, "ratio {}", report.distance.mean_ratio);
        assert!(!report.distance.scale_flagged);
        // the Umeyama fit should agree with the truth translation
        assert!((report.fit.tx - truth.tx_px).abs() <= 1.0, "fit tx {} vs {}", report.fit.tx, truth.tx_px);
        assert!((report.fit.ty - truth.ty_px).abs() <= 1.0);
        assert!(report.verdict.level == "ok", "{:?}", report.verdict.reasons);
    }

    #[test]
    fn umeyama_fit_recovers_rotation_and_scale() {
        // M5: the fit itself must land near the truth for a similarity case
        let (report, truth) = verify_case(63, TruthTransform { tx_px: 6.0, ty_px: 9.0, theta_deg: 0.9, scale: 1.006 }, CaseParams { noise_sigma: 1.5, blur_sigma: 0.4, ..CaseParams::default() });
        assert!((report.fit.theta_deg - truth.theta_deg).abs() <= 0.15, "theta {} vs {}", report.fit.theta_deg, truth.theta_deg);
        assert!((report.fit.scale - truth.scale).abs() <= 0.003, "scale {} vs {}", report.fit.scale, truth.scale);
        assert!(report.fit.scale > 1.0);
    }

    #[test]
    fn synthetic_umeyama_is_exact() {
        // pure geometry check, no images: exact similarity is recovered
        let truth = Transform { tx: 4.0, ty: -7.0, theta_deg: 12.0, scale: 1.13 };
        let src: Vec<(f64, f64)> = (0..6).map(|i| (f64::from(i) * 13.0 + 3.0, f64::from(i * i) * 7.0)).collect();
        let dst: Vec<(f64, f64)> = src.iter().map(|p| forward(&truth, 0.0, 0.0, p.0, p.1)).collect();
        let (scale, theta, t0) = umeyama(&src, &dst).unwrap();
        assert!((scale - truth.scale).abs() < 1e-9);
        assert!((theta.to_degrees() - truth.theta_deg).abs() < 1e-9);
        assert!((t0.0 - truth.tx).abs() < 1e-9 && (t0.1 - truth.ty).abs() < 1e-9);
    }

    #[test]
    fn ransac_survives_one_wrong_match() {
        // verify a clean case, corrupt one located point, refit: the outlier
        // must be voted out and the fit stay accurate
        let case = generate_case(&base(), 64, Some(TruthTransform { tx_px: 8.0, ty_px: 5.0, theta_deg: 0.0, scale: 1.0 }), &CaseParams { noise_sigma: 1.5, blur_sigma: 0.4, ..CaseParams::default() });
        let prior = phase_prior(&case.template, &case.input);
        let mut report = verify(&case.template, &case.input, &FiducialConfig::default(), prior).unwrap();
        assert!(report.matches.len() >= 4, "only {} matches", report.matches.len());
        report.matches[0].input.0 += 25.0;
        report.matches[0].input.1 -= 18.0;
        let mut rng = SeededRng::new(0x4F1D);
        let (fit, flags) = fit_with_ransac(&report.matches, &mut rng, &FiducialConfig::default(), center_of(&case.template));
        assert!(!flags[0], "the corrupted match must be voted out");
        assert_eq!(flags.iter().filter(|f| **f).count(), report.matches.len() - 1);
        assert!(fit.theta_deg.abs() < 0.15, "theta {}", fit.theta_deg);
        assert!((fit.scale - 1.0).abs() < 0.003, "scale {}", fit.scale);
        assert!((fit.tx - 8.0).abs() <= 1.0 && (fit.ty - 5.0).abs() <= 1.0, "t ({}, {})", fit.tx, fit.ty);
    }

    #[test]
    fn verdict_thresholds_are_configurable() {
        // the same clean case flips to "manual" when the OK bar is raised
        let case = generate_case(&base(), 65, Some(TruthTransform { tx_px: 3.0, ty_px: 2.0, theta_deg: 0.0, scale: 1.0 }), &CaseParams { noise_sigma: 1.0, blur_sigma: 0.3, ..CaseParams::default() });
        let prior = phase_prior(&case.template, &case.input);
        let mut strict = FiducialConfig::default();
        strict.ncc_ok = 0.999;
        strict.resid_ok_px = 0.0;
        let report = verify(&case.template, &case.input, &strict, prior).unwrap();
        assert_eq!(report.verdict.level, "manual", "{:?}", report.verdict.reasons);
        assert!(!report.verdict.reasons.is_empty());
    }

    #[test]
    fn degraded_case_does_not_pass_as_ok() {
        let (report, _) = verify_case(66, TruthTransform { tx_px: 6.0, ty_px: -4.0, theta_deg: 0.3, scale: 1.0 }, CaseParams { noise_sigma: 25.0, blur_sigma: 2.5, occlusion_ratio: 0.3, ..CaseParams::default() });
        assert_ne!(report.verdict.level, "ok", "{:?}", report.verdict.reasons);
    }
}

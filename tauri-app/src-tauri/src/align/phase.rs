//! M2 phase correlation aligner (Plan 05): the first real `Aligner`.
//!
//! Cross-power spectrum phase correlation (Reddy & Chatterji): both images go
//! through a 2D FFT (row/column passes of rustfft's 1D planners), the
//! amplitude-normalized cross spectrum is inverted, and the peak of the
//! correlation surface is the global translation. Amplitude normalization is
//! exactly why this method ignores illumination differences (design doc §6 L1).
//!
//! Teaching notes baked into the implementation:
//! - a Hann window suppresses the circular-wraparound contamination of FFT
//!   correlation (the borders would otherwise correlate with the opposite edge);
//! - the peak is refined to sub-pixel with a parabolic fit on the surface;
//! - PSR (peak-to-sidelobe ratio) is the confidence number - periodic
//!   structures (BGA arrays!) produce several comparable peaks, which shows up
//!   as a low PSR. That ambiguity is a feature of the lesson, not a bug to fix
//!   (Plan 05 M2 acceptance: record it, don't repair it).

use super::{AlignResult, Aligner};
use image::GrayImage;
use rustfft::num_complex::Complex;
use rustfft::{FftPlanner, Fft};

/// PSR above this means "locked on". Deliberately conservative: periodic
/// patterns sit far below it, which is the M2 teaching moment.
pub const DEFAULT_PSR_OK_THRESHOLD: f64 = 10.0;

/// Half-size of the square exclusion window around the peak when computing
/// the sidewall statistics (an 11x11 window at 5 - the textbook number).
const PEAK_EXCLUSION: i64 = 5;

pub struct PhaseCorrelateAligner {
    pub psr_ok_threshold: f64,
}

impl Default for PhaseCorrelateAligner {
    fn default() -> Self {
        Self { psr_ok_threshold: DEFAULT_PSR_OK_THRESHOLD }
    }
}

impl Aligner for PhaseCorrelateAligner {
    fn name(&self) -> &str {
        "phase-correlate"
    }

    /// Recovers the global translation (tx, ty) in working-grid px; rotation
    /// and scale stay at the identity values until M3. The sign convention is
    /// pinned by the M1 generator contract test: the reported (tx, ty) is the
    /// truth that maps template -> input (`input(q) = template(q - t)`).
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

        let (tx, ty, psr) = phase_translation(template, input)?;

        let mut result = AlignResult::new(self.name());
        result.score = psr;
        result.psr = psr;
        result.ok = psr >= self.psr_ok_threshold;
        result.elapsed_ms = started.elapsed().as_millis() as u64;
        result.tx_px = tx;
        result.ty_px = ty;
        result.message = if result.ok {
            format!("PSR {psr:.1} - translation locked.")
        } else {
            format!("PSR {psr:.1} below the ok threshold - low-confidence (noise, occlusion or periodic ambiguity?).")
        };
        Ok(result)
    }
}

/// The raw phase-correlation translation plus its PSR - shared by the M2
/// aligner and as the coarse initialization of the M3 ECC pipeline. Sign
/// convention (M1 contract): input = template shifted by (tx, ty).
pub fn phase_translation(template: &GrayImage, input: &GrayImage) -> Result<(f64, f64, f64), String> {
    let (w, h) = (template.width() as usize, template.height() as usize);
    if template.dimensions() != input.dimensions() {
        return Err(format!(
            "Grid mismatch: template {}x{} vs input {}x{}.",
            template.width(),
            template.height(),
            input.width(),
            input.height()
        ));
    }
    if w == 0 || h == 0 {
        return Err("Empty image.".into());
    }

    let surface = correlation_surface(template, input);
    let Some((peak_x, peak_y, peak_value)) = argmax(&surface, w, h) else {
        return Err("Degenerate correlation surface (constant).".into());
    };
    let psr = psr(&surface, w, h, peak_x, peak_y, peak_value);

    // Sub-pixel parabolic refinement around the integer peak, then the
    // wraparound fold (a shift larger than half the canvas is indistinguishable
    // from its negative alias). The sign is the M1 contract: the surface
    // peak sits at -t mod N for input = template shifted by t.
    let at = |x: usize, y: usize| surface[y * w + x].re;
    let sub_x = parabolic(at((peak_x + w - 1) % w, peak_y), at(peak_x, peak_y), at((peak_x + 1) % w, peak_y));
    let sub_y = parabolic(at(peak_x, (peak_y + h - 1) % h), at(peak_x, peak_y), at(peak_x, (peak_y + 1) % h));
    let mut dx = -(peak_x as f64 + sub_x);
    let mut dy = -(peak_y as f64 + sub_y);
    if dx <= -(w as f64) / 2.0 {
        dx += w as f64;
    }
    if dy <= -(h as f64) / 2.0 {
        dy += h as f64;
    }
    Ok((dx, dy, psr))
}

// ---- pipeline steps, each small enough to be shown on its own in M4 ----

/// Pads to the next power of two (cheap FFT sizes), applies a Hann window to
/// both images, and returns the 2D cross-power-spectrum correlation surface
/// (real part), normalized so PSR numbers are comparable across cases.
fn correlation_surface(template: &GrayImage, input: &GrayImage) -> Vec<Complex<f32>> {
    let (w, h) = (template.width() as usize, input.height() as usize);
    let (fw, fh) = (next_pow2(w), next_pow2(h));
    let n = fw * fh;

    let mut planner = FftPlanner::<f32>::new();
    let fft_row = planner.plan_fft_forward(fw);
    let fft_col = planner.plan_fft_forward(fh);
    let ifft_row = planner.plan_fft_inverse(fw);
    let ifft_col = planner.plan_fft_inverse(fh);

    let mut fa = to_frequency(template, fw, fh, &fft_row, &fft_col);
    let fb = to_frequency(input, fw, fh, &fft_row, &fft_col);

    // Cross-power spectrum: amplitude-normalized product => illumination-proof.
    for (a, b) in fa.iter_mut().zip(fb.iter()) {
        let cross = *a * b.conj();
        let norm = cross.norm().max(1e-12);
        *a = cross / norm;
    }
    inverse_2d(&mut fa, &ifft_row, &ifft_col, fw, fh);
    debug_assert_eq!(fa.len(), n);
    fa
}

/// Forward 2D FFT of the Hann-windowed image, zero-padded to `fw x fh`.
fn to_frequency(
    image: &GrayImage,
    fw: usize,
    fh: usize,
    fft_row: &std::sync::Arc<dyn Fft<f32>>,
    fft_col: &std::sync::Arc<dyn Fft<f32>>,
) -> Vec<Complex<f32>> {
    let (w, h) = (image.width() as usize, image.height() as usize);
    let mut data = vec![Complex::new(0.0, 0.0); fw * fh];
    for y in 0..h {
        // Hann window per row over the ORIGINAL width (not the padded one).
        let wy = 0.5 * (1.0 - (2.0 * std::f64::consts::PI * y as f64 / (h as f64 - 1.0)).cos());
        for x in 0..w {
            let wx = 0.5 * (1.0 - (2.0 * std::f64::consts::PI * x as f64 / (w as f64 - 1.0)).cos());
            data[y * fw + x] = Complex::new((f64::from(image.get_pixel(x as u32, y as u32).0[0]) * wx * wy) as f32, 0.0);
        }
    }
    for y in 0..h {
        fft_row.process(&mut data[y * fw..(y + 1) * fw]);
    }
    let mut column = vec![Complex::new(0.0, 0.0); fh];
    for x in 0..fw {
        for y in 0..fh {
            column[y] = data[y * fw + x];
        }
        fft_col.process(&mut column);
        for y in 0..fh {
            data[y * fw + x] = column[y];
        }
    }
    data
}

fn inverse_2d(data: &mut [Complex<f32>], ifft_row: &std::sync::Arc<dyn Fft<f32>>, ifft_col: &std::sync::Arc<dyn Fft<f32>>, fw: usize, fh: usize) {
    for y in 0..fh {
        ifft_row.process(&mut data[y * fw..(y + 1) * fw]);
    }
    let mut column = vec![Complex::new(0.0, 0.0); fh];
    for x in 0..fw {
        for y in 0..fh {
            column[y] = data[y * fw + x];
        }
        ifft_col.process(&mut column);
        for y in 0..fh {
            data[y * fw + x] = column[y];
        }
    }
}

/// Peak-to-sidelobe ratio: (peak - mean) / std over the surface minus an
/// 11x11 exclusion window around the peak. Other candidate peaks land in the
/// sidewall and drag the PSR down - that is how periodic ambiguity becomes a
/// number instead of a vibe.
fn psr(surface: &[Complex<f32>], w: usize, h: usize, peak_x: usize, peak_y: usize, peak: f32) -> f64 {
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    let mut count = 0u64;
    for y in 0..h {
        let dy = (y as i64 - peak_y as i64).abs();
        for x in 0..w {
            if (x as i64 - peak_x as i64).abs() <= PEAK_EXCLUSION && dy <= PEAK_EXCLUSION {
                continue;
            }
            let v = surface[y * w + x].re as f64;
            sum += v;
            sum_sq += v * v;
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    let mean = sum / count as f64;
    let variance = (sum_sq / count as f64 - mean * mean).max(0.0);
    let std = variance.sqrt().max(1e-12);
    ((peak as f64 - mean) / std).max(0.0)
}

fn argmax(surface: &[Complex<f32>], w: usize, h: usize) -> Option<(usize, usize, f32)> {
    let mut best = f32::MIN;
    let mut at = None;
    for y in 0..h {
        for x in 0..w {
            let v = surface[y * w + x].re;
            if v > best {
                best = v;
                at = Some((x, y));
            }
        }
    }
    at.map(|(x, y)| (x, y, best))
}

/// Parabolic sub-pixel offset of the true peak relative to the integer one.
/// A maximum is concave, so the denominator is negative - never clamp it
/// positive (that would blow the offset up to ~1e12 on flat neighborhoods).
fn parabolic(left: f32, center: f32, right: f32) -> f64 {
    let denom = (left - 2.0 * center + right) as f64;
    if denom.abs() < 1e-12 {
        return 0.0;
    }
    0.5 * (left - right) as f64 / denom
}

fn next_pow2(v: usize) -> usize {
    v.next_power_of_two().max(2)
}

// ---- tests: the M2 acceptance criteria, fed by the M1 generator ----

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::generator::generate_case;
    use crate::align::{CaseParams, TruthTransform};
    use image::Luma;

    const ALIGNER: PhaseCorrelateAligner = PhaseCorrelateAligner { psr_ok_threshold: DEFAULT_PSR_OK_THRESHOLD };

    /// A unique-texture base (blob + broken stripes): no periodic ambiguity.
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

    /// BGA-like pad matrix: the textbook periodic-ambiguity case.
    fn periodic_base() -> GrayImage {
        let mut image = GrayImage::from_pixel(256, 256, Luma([30]));
        for py in 0..8 {
            for px in 0..8 {
                let cx = 28 + px * 28;
                let cy = 28 + py * 28;
                for y in (cy - 8).max(0)..(cy + 8).min(256) {
                    for x in (cx - 8).max(0)..(cx + 8).min(256) {
                        image.put_pixel(x, y, Luma([200]));
                    }
                }
            }
        }
        image
    }

    #[test]
    fn translation_cases_are_recovered_within_half_px() {
        // M2 acceptance: M1 library translation cases land within 0.5 px.
        let base = unique_base();
        for (seed, tx, ty) in [(1u64, 12.3f64, -7.7f64), (2, -30.0, 18.5), (3, 5.0, 5.0)] {
            let truth = TruthTransform { tx_px: tx, ty_px: ty, theta_deg: 0.0, scale: 1.0 };
            let params = CaseParams { noise_sigma: 2.0, gain: 1.1, offset: 4.0, blur_sigma: 0.6, occlusion_ratio: 0.0, downsample: 1 };
            let case = generate_case(&base, seed, Some(truth), &params);
            let result = ALIGNER.align(&case.template, &case.input).unwrap();
            assert!(result.ok, "seed {seed}: {}", result.message);
            assert!((result.tx_px - tx).abs() <= 0.5, "seed {seed}: tx {} vs {tx}", result.tx_px);
            assert!((result.ty_px - ty).abs() <= 0.5, "seed {seed}: ty {} vs {ty}", result.ty_px);
            assert_eq!(result.theta_deg, 0.0);
            assert_eq!(result.scale, 1.0);
        }
    }

    #[test]
    fn illumination_gain_does_not_disturb_the_lock() {
        // the amplitude-normalized spectrum is the whole point (design doc §6)
        let base = unique_base();
        let truth = TruthTransform { tx_px: -15.0, ty_px: 22.0, theta_deg: 0.0, scale: 1.0 };
        let params = CaseParams { noise_sigma: 0.0, gain: 1.6, offset: 30.0, blur_sigma: 0.0, occlusion_ratio: 0.0, downsample: 1 };
        let case = generate_case(&base, 11, Some(truth), &params);
        let result = ALIGNER.align(&case.template, &case.input).unwrap();
        assert!(result.ok, "{}", result.message);
        assert!((result.tx_px + 15.0).abs() <= 0.5 && (result.ty_px - 22.0).abs() <= 0.5);
    }

    #[test]
    fn degradation_drags_psr_down() {
        // confidence must be observable: clean >> occluded + noisy
        let base = unique_base();
        let truth = || TruthTransform { tx_px: 9.0, ty_px: -4.0, theta_deg: 0.0, scale: 1.0 };
        let clean = generate_case(&base, 21, Some(truth()), &CaseParams::default());
        let dirty = generate_case(
            &base,
            21,
            Some(truth()),
            &CaseParams { noise_sigma: 35.0, gain: 1.0, offset: 0.0, blur_sigma: 3.0, occlusion_ratio: 0.5, downsample: 1 },
        );
        let r_clean = ALIGNER.align(&clean.template, &clean.input).unwrap();
        let r_dirty = ALIGNER.align(&dirty.template, &dirty.input).unwrap();
        assert!(r_clean.psr > r_dirty.psr * 2.0, "clean {} vs dirty {}", r_clean.psr, r_dirty.psr);
        assert!(!r_dirty.ok, "degraded case must fall below the ok gate: psr {}", r_dirty.psr);
    }

    #[test]
    fn periodic_pattern_shows_the_teaching_ambiguity() {
        // M2 acceptance: BGA-periodic cases expose the multi-peak problem and
        // it stays unfixed - the PSR is the honest witness. The shift is one
        // FULL period, so "locked" and "locked one period off" correlate
        // equally well: the ambiguity is physical, not an implementation bug.
        let base = periodic_base();
        let period = 28.0f64;
        let case = generate_case(&base, 31, Some(TruthTransform { tx_px: period, ty_px: 0.0, theta_deg: 0.0, scale: 1.0 }), &CaseParams { noise_sigma: 3.0, ..CaseParams::default() });
        let periodic = ALIGNER.align(&case.template, &case.input).unwrap();

        let unique = generate_case(&unique_base(), 32, Some(TruthTransform { tx_px: period, ty_px: 0.0, theta_deg: 0.0, scale: 1.0 }), &CaseParams { noise_sigma: 3.0, ..CaseParams::default() });
        let unique = ALIGNER.align(&unique.template, &unique.input).unwrap();

        assert!(
            periodic.psr < unique.psr / 2.0,
            "periodic PSR {} should collapse vs unique {} - the ambiguity is not showing",
            periodic.psr,
            unique.psr
        );
        // and the ambiguity is physical: it either reports a period-multiple
        // (wrong by exactly one pad pitch) or honestly refuses (low PSR)
        let wrong_lock = (periodic.tx_px - period).abs() > 0.5 || !periodic.ok;
        assert!(wrong_lock, "a full-period shift must not be confidently recovered as-is on a pure pad matrix");
    }

    #[test]
    fn derived_cases_error_is_explained_by_the_rotation_residual() {
        // Phase correlation solves translation only (M2 scope): derived truths
        // carry theta/scale, so the observed error must be bounded by the
        // translation floor plus the worst-case rotation/scale displacement at
        // the farthest corner - never more.
        let base = unique_base();
        let half_diagonal = {
            let (w, h) = (f64::from(base.width()), f64::from(base.height()));
            ((w / 2.0).powi(2) + (h / 2.0).powi(2)).sqrt()
        };
        for seed in [101u64, 202, 303] {
            let params = CaseParams { noise_sigma: 2.5, blur_sigma: 0.5, ..CaseParams::default() };
            let case = generate_case(&base, seed, None, &params);
            let result = ALIGNER.align(&case.template, &case.input).unwrap();
            let err_x = (result.tx_px - case.truth.tx_px).abs();
            let err_y = (result.ty_px - case.truth.ty_px).abs();
            let rotation_rad = case.truth.theta_deg.abs().to_radians();
            let bound = 0.5 + half_diagonal * (rotation_rad + (case.truth.scale - 1.0).abs()) + 1.0;
            assert!(
                err_x <= bound && err_y <= bound,
                "seed {seed}: err ({err_x:.3}, {err_y:.3}) exceeds the rotation-residual bound {bound:.3} (truth {:?})",
                case.truth
            );
        }
    }

    #[test]
    fn grid_mismatch_is_an_error_not_a_peak() {
        let a = GrayImage::from_pixel(8, 8, Luma([0]));
        let b = GrayImage::from_pixel(8, 4, Luma([0]));
        assert!(ALIGNER.align(&a, &b).is_err());
    }
}

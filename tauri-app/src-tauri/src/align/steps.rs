//! M4 pipeline step-through (Plan 05): every pipeline stage exposes its
//! inputs, outputs and numbers as teaching artifacts.
//!
//! This module re-runs the M2+M3 pipeline piece by piece and packages each
//! stage's intermediates for IPC: preview JPEGs (working-grid images
//! downsampled to [`STEP_PREVIEW_MAX_SIDE`] - the D3 rule applies to
//! artifacts too), number tables and the ECC correlation curve. The frontend
//! renders one step at a time; the explanations live there, this side only
//! produces the evidence.

use super::ecc::{downsample, forward, gauss_newton, sample, PYRAMID_LEVELS, Transform};
use super::phase::{cross_power_with_surface, argmax, phase_translation, psr};
use base64::Engine as _;
use image::GrayImage;
use image::ImageEncoder as _;
use rustfft::num_complex::Complex;

/// Longest side of a step-artifact preview. The working grid is already ≤2K,
/// so this is about IPC weight, not fidelity.
pub const STEP_PREVIEW_MAX_SIDE: u32 = 1024;

#[derive(serde::Serialize)]
pub struct StepImage {
    pub label: String,
    pub width: u32,
    pub height: u32,
    /// Base64 JPEG preview.
    pub data: String,
}

#[derive(serde::Serialize)]
pub struct StepOut {
    /// Stable id the frontend keys its explanations on.
    pub id: String,
    pub title: String,
    pub subtitle: String,
    /// (label, value) pairs, rendered as a table.
    pub numbers: Vec<(String, String)>,
    /// The ECC correlation-per-iteration curve (step "ecc" only).
    pub curve: Option<Vec<f64>>,
    pub images: Vec<StepImage>,
}

/// Runs the full teaching pipeline on one case's images and returns one
/// [`StepOut`] per stage, in pipeline order.
pub fn run_steps(template: &GrayImage, input: &GrayImage) -> Result<Vec<StepOut>, String> {
    if template.dimensions() != input.dimensions() {
        return Err(format!(
            "Grid mismatch: template {}x{} vs input {}x{}.",
            template.width(),
            template.height(),
            input.width(),
            input.height()
        ));
    }
    let (w, h) = (template.width(), template.height());
    if w == 0 || h == 0 {
        return Err("Empty image.".into());
    }

    // ---- step 1: preprocess (what the aligner actually sees) ----
    let (t_mean, t_std) = mean_std(template);
    let (i_mean, i_std) = mean_std(input);
    let preprocess = StepOut {
        id: "preprocess".into(),
        title: "① 预处理".into(),
        subtitle: "灰度化后的两侧原图。ECC 阶段还会做零均值/单位方差归一化，光照增益与偏移在这一步被吃掉。".into(),
        numbers: vec![
            ("工作网格".into(), format!("{w} × {h} px")),
            ("Template 均值 / σ".into(), format!("{t_mean:.1} / {t_std:.1}")),
            ("Input 均值 / σ".into(), format!("{i_mean:.1} / {i_std:.1}")),
        ],
        curve: None,
        images: vec![
            StepImage { label: "Template（理想图）".into(), ..preview(template)? },
            StepImage { label: "Input（真值变换 + 退化）".into(), ..preview(input)? },
        ],
    };

    // ---- step 2: phase correlation (frequency domain) ----
    let (spectrum, surface, fw, fh) = cross_power_with_surface(template, input);
    let Some((peak_x, peak_y, peak_value)) = argmax(&surface, fw, fh) else {
        return Err("Degenerate correlation surface.".into());
    };
    let surface_psr = psr(&surface, fw, fh, peak_x, peak_y, peak_value);
    let (tx, ty, _psr) = phase_translation(template, input)?;
    let phase_step = StepOut {
        id: "phase".into(),
        title: "② 相位相关（粗对齐）".into(),
        subtitle: "左：互功率谱的相位角（携带位移信息的部分，幅度已被归一化掉）。右：逆 FFT 后的相关面，白点即平移峰。".into(),
        numbers: vec![
            ("FFT 尺寸".into(), format!("{fw} × {fh}（含补零）")),
            ("整数峰位置".into(), format!("({peak_x}, {peak_y})")),
            ("解出平移".into(), format!("tx {tx:.2}, ty {ty:.2} px")),
            ("PSR".into(), format!("{surface_psr:.1}")),
        ],
        curve: None,
        images: vec![
            StepImage { label: "互功率谱相位角".into(), ..preview(&phase_image(&spectrum, fw, fh))? },
            StepImage { label: "相关面（√压缩）".into(), ..preview(&surface_image(&surface, fw, fh))? },
        ],
    };

    // ---- step 3: ECC refinement (pyramid + Gauss-Newton) ----
    let mut curve = Vec::new();
    let mut transform = Transform { tx, ty, theta_deg: 0.0, scale: 1.0 };
    let mut converged = false;
    for &factor in PYRAMID_LEVELS.iter() {
        let (t_level, i_level) = if factor == 1 {
            (template.clone(), input.clone())
        } else {
            (downsample(template, factor), downsample(input, factor))
        };
        let seed = Transform { tx: transform.tx / f64::from(factor), ty: transform.ty / f64::from(factor), ..transform };
        let outcome = gauss_newton(&t_level, &i_level, seed, &mut curve);
        transform = Transform {
            tx: outcome.transform.tx * f64::from(factor),
            ty: outcome.transform.ty * f64::from(factor),
            theta_deg: outcome.transform.theta_deg,
            scale: outcome.transform.scale,
        };
        converged = outcome.converged || converged;
    }
    let final_corr = curve.last().copied().unwrap_or(0.0);
    let coarse = downsample(template, PYRAMID_LEVELS[0]);
    let ecc_step = StepOut {
        id: "ecc".into(),
        title: "③ ECC 精对齐（金字塔 + Gauss-Newton）".into(),
        subtitle: "以相位相关的平移为初值，1/4 分辨率粗修旋转/尺度（宽收敛域），全分辨率细修。曲线是每次迭代的Pearson相关——M4 教学核心产物。".into(),
        numbers: vec![
            ("金字塔层级".into(), format!("{:?}", PYRAMID_LEVELS)),
            ("迭代次数".into(), format!("{}", curve.len())),
            ("收敛".into(), if converged { "是".into() } else { "否（不可信）".into() }),
            ("最终相关系数".into(), format!("{final_corr:.4}")),
        ],
        curve: Some(curve),
        images: vec![
            StepImage { label: format!("粗层 Template（1/{}）", PYRAMID_LEVELS[0]), ..preview(&coarse)? },
        ],
    };

    // ---- step 4: verification (warp back + difference) ----
    let aligned = warp_back(template, input, transform);
    let difference = diff_image(template, &aligned);
    let (cx, cy) = (f64::from(w - 1) / 2.0, f64::from(h - 1) / 2.0);
    let (_, _, psr_final) = phase_translation(&aligned, template)?;
    let result_step = StepOut {
        id: "result".into(),
        title: "④ 结果校验".into(),
        subtitle: "按解出的变换把 Input 拉回 Template 坐标系（warp back），与理想图做差。差异图越黑 = 对得越齐；边缘残影 = 残余误差。".into(),
        numbers: vec![
            ("求解变换".into(), format!("tx {:+.2}, ty {:+.2}, θ {:+.3}°, s {:.4}", transform.tx, transform.ty, transform.theta_deg, transform.scale)),
            ("相关系数".into(), format!("{final_corr:.4}")),
            ("PSR（校验粗对齐）".into(), format!("{psr_final:.1}")),
            ("warp 中心".into(), format!("({cx:.1}, {cy:.1})")),
        ],
        curve: None,
        images: vec![
            StepImage { label: "Aligned（Input 拉回后）".into(), ..preview(&aligned)? },
            StepImage { label: "|差异| ×8".into(), ..preview(&difference)? },
        ],
    };

    Ok(vec![preprocess, phase_step, ecc_step, result_step])
}

// ---- artifact helpers ----

fn preview(image: &GrayImage) -> Result<StepImage, String> {
    let view = if image.width().max(image.height()) > STEP_PREVIEW_MAX_SIDE {
        let f = f64::from(STEP_PREVIEW_MAX_SIDE) / f64::from(image.width().max(image.height()));
        let nw = ((f64::from(image.width()) * f).round() as u32).max(1);
        let nh = ((f64::from(image.height()) * f).round() as u32).max(1);
        image::imageops::thumbnail(image, nw, nh)
    } else {
        image.clone()
    };
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .write_image(view.as_raw(), view.width(), view.height(), image::ExtendedColorType::L8)
        .map_err(|error| format!("Cannot encode the step preview: {error}"))?;
    Ok(StepImage {
        label: String::new(),
        width: view.width(),
        height: view.height(),
        data: base64::engine::general_purpose::STANDARD.encode(&jpeg),
    })
}

/// Cross-power spectrum phase angle rendered as grayscale: the translation
/// lives in the PHASE (the amplitude is normalized to 1 everywhere), so this
/// is the image that actually carries the answer.
fn phase_image(spectrum: &[Complex<f32>], w: usize, h: usize) -> GrayImage {
    let mut out = GrayImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let c = spectrum[y * w + x];
            let angle = c.arg(); // -π..π
            let v = ((angle + std::f32::consts::PI) / (2.0 * std::f32::consts::PI) * 255.0) as u8;
            out.put_pixel(x as u32, y as u32, image::Luma([v]));
        }
    }
    out
}

/// Correlation surface with sqrt compression: the peak is orders of magnitude
/// above the noise floor, linear mapping would render everything else black.
fn surface_image(surface: &[Complex<f32>], w: usize, h: usize) -> GrayImage {
    let mut min = f32::MAX;
    let mut max = f32::MIN;
    for c in surface {
        let v = c.re;
        min = min.min(v);
        max = max.max(v);
    }
    let range = (max - min).max(1e-12);
    let mut out = GrayImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let v = ((surface[y * w + x].re - min) / range).max(0.0).sqrt();
            out.put_pixel(x as u32, y as u32, image::Luma([(v * 255.0) as u8]));
        }
    }
    out
}

/// Samples the input at the solved warp for every template pixel - the
/// "warp back" of the verification step.
fn warp_back(template: &GrayImage, input: &GrayImage, t: Transform) -> GrayImage {
    let (w, h) = (template.width() as usize, template.height() as usize);
    let (cx, cy) = ((w as f64 - 1.0) / 2.0, (h as f64 - 1.0) / 2.0);
    let inorm: Vec<f64> = input.pixels().map(|p| f64::from(p.0[0])).collect();
    let mut out = GrayImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let (sx, sy) = forward(&t, cx, cy, x as f64, y as f64);
            let v = sample(&inorm, w, h, sx, sy).unwrap_or(0.0);
            out.put_pixel(x as u32, y as u32, image::Luma([v.round().clamp(0.0, 255.0) as u8]));
        }
    }
    out
}

/// |template − aligned| scaled ×8 so sub-pixel residuals are visible.
fn diff_image(template: &GrayImage, aligned: &GrayImage) -> GrayImage {
    let mut out = template.clone();
    for (p, q) in out.pixels_mut().zip(aligned.pixels()) {
        let d = (i16::from(p.0[0]) - i16::from(q.0[0])).abs();
        p.0[0] = (d * 8).min(255) as u8;
    }
    out
}

fn mean_std(image: &GrayImage) -> (f64, f64) {
    let n = f64::from(image.width() * image.height());
    let mean = image.pixels().map(|p| f64::from(p.0[0])).sum::<f64>() / n;
    let var = image.pixels().map(|p| { let d = f64::from(p.0[0]) - mean; d * d }).sum::<f64>() / n;
    (mean, var.sqrt())
}

// ---- tests: every step carries its evidence (M4 acceptance groundwork) ----

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::generator::generate_case;
    use crate::align::{CaseParams, TruthTransform};
    use image::Luma;

    fn base() -> GrayImage {
        let mut image = GrayImage::from_pixel(128, 128, Luma([40]));
        for y in 15..30 {
            for x in 20..45 {
                image.put_pixel(x, y, Luma([210]));
            }
        }
        for y in 60..110 {
            for x in (10..120).step_by(9) {
                image.put_pixel(x, y, Luma([180]));
            }
        }
        image
    }

    #[test]
    fn every_step_shows_images_numbers_and_the_curve_lands_on_ecc() {
        let case = generate_case(&base(), 5, Some(TruthTransform { tx_px: 6.0, ty_px: -4.0, theta_deg: 0.8, scale: 1.005 }), &CaseParams { noise_sigma: 2.0, blur_sigma: 0.5, ..CaseParams::default() });
        let steps = run_steps(&case.template, &case.input).unwrap();

        assert_eq!(steps.len(), 4);
        assert_eq!([steps[0].id.as_str(), steps[1].id.as_str(), steps[2].id.as_str(), steps[3].id.as_str()], ["preprocess", "phase", "ecc", "result"]);
        for step in &steps {
            assert!(!step.numbers.is_empty(), "step {} has no numbers", step.id);
            assert!(!step.images.is_empty(), "step {} has no images (M4: every step shows its evidence)", step.id);
            for image in &step.images {
                assert!(image.width > 0 && !image.data.is_empty());
            }
        }
        // the ECC step carries the correlation curve; it improves
        let curve = steps[2].curve.as_ref().expect("ecc step must carry the curve");
        assert!(curve.len() >= 2 && curve.last().unwrap() > curve.first().unwrap(), "{curve:?}");
        // the result step's warp solved the case within M3 thresholds
        let numbers = &steps[3].numbers;
        let solved = &numbers[0].1;
        let theta: f64 = solved.split("θ ").nth(1).unwrap().split('°').next().unwrap().trim().parse().unwrap();
        assert!((theta - 0.8).abs() <= 0.1, "{solved}");
    }

    #[test]
    fn surface_and_phase_visualizations_have_contrast() {
        // a flat artifact (all black) would mean the compression is broken
        let case = generate_case(&base(), 7, Some(TruthTransform { tx_px: 4.0, ty_px: 0.0, theta_deg: 0.0, scale: 1.0 }), &CaseParams::default());
        let (_spectrum, surface, fw, fh) = cross_power_with_surface(&case.template, &case.input);
        let vis = surface_image(&surface, fw, fh);
        let mut distinct = std::collections::HashSet::new();
        for p in vis.pixels() {
            distinct.insert(p.0[0]);
        }
        assert!(distinct.len() > 8, "surface visualization is nearly flat: {distinct:?}");
    }

    #[test]
    fn grid_mismatch_errors() {
        let a = GrayImage::from_pixel(8, 8, Luma([0]));
        let b = GrayImage::from_pixel(8, 4, Luma([0]));
        assert!(run_steps(&a, &b).is_err());
    }
}

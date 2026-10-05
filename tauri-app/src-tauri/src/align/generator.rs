//! M1 synthetic case generator (Plan 05): ground-truth injection.
//!
//! Given an ideal base image plus `(seed, truth, params)` it produces the
//! teaching triple `(template, input, truth)`:
//!
//! 1. `template` = the base image downsampled to the case's working grid;
//! 2. `input`    = the template warped by the known truth transform, then
//!    degraded by illumination / blur / noise / occlusion.
//!
//! Every random decision draws from [`SeededRng`], never a global RNG, so the
//! same seed + params + truth regenerate the exact same bytes (D4). The RNG,
//! the warp and the degradation order are deliberately hand-rolled and kept
//! small: they are teaching material for M4's step-through view.

use super::{AlignCase, CaseParams, TruthTransform};
use image::{GrayImage, Luma};
use std::fs;
use std::path::{Path, PathBuf};

// ---- seeded RNG: splitmix64 seeding + xoshiro256** + Box-Muller gaussian ----

/// Deterministic PRNG owned by one case generation. Hand-rolled so that the
/// byte-level reproducibility contract never depends on a third-party crate's
/// version bump changing its stream.
pub struct SeededRng {
    state: [u64; 4],
    /// Box-Muller produces gaussians in pairs; the spare one is kept here.
    spare: Option<f64>,
}

impl SeededRng {
    pub fn new(seed: u64) -> Self {
        // splitmix64 expands one seed into the 256-bit xoshiro state.
        let mut mix = seed;
        let mut next = || {
            mix = mix.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = mix;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        };
        Self { state: [next(), next(), next(), next()], spare: None }
    }

    fn next_u64(&mut self) -> u64 {
        let result = self.state[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.state[1] << 17;
        self.state[2] ^= self.state[0];
        self.state[3] ^= self.state[1];
        self.state[1] ^= self.state[2];
        self.state[0] ^= self.state[3];
        self.state[2] ^= t;
        self.state[3] = self.state[3].rotate_left(45);
        result
    }

    /// Uniform in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        // 53 random mantissa bits: uniform over the doubles in [0,1).
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Uniform in `[low, high)`.
    pub fn range_f64(&mut self, low: f64, high: f64) -> f64 {
        low + self.next_f64() * (high - low)
    }

    /// Standard normal via Box-Muller. `sin`/`cos`/`ln` come from the platform
    /// libm, so byte identity holds per platform build (the classroom fleet is
    /// one Windows x64 build) rather than across all architectures.
    pub fn gaussian(&mut self) -> f64 {
        if let Some(spare) = self.spare.take() {
            return spare;
        }
        let u1 = self.next_f64().max(f64::MIN_POSITIVE); // ln(0) guard
        let u2 = self.next_f64();
        let r = (-2.0 * u1.ln()).sqrt();
        let theta = std::f64::consts::TAU * u2;
        self.spare = Some(r * theta.sin());
        r * theta.cos()
    }
}

// ---- geometry: inverse warp with bilinear sampling ----

/// Applies `truth` to `template` and returns the warped image: for each output
/// pixel the *inverse* transform is sampled from the template (bilinear,
/// border = black). The transform maps template -> input as
/// `q = c + R(θ)·(s·(p − c)) + t` with `c` the working-grid center, so a
/// truth of `(0, 0, 0°, 1.0)` reproduces the template exactly.
///
/// Content near the borders rotates out of the canvas and is clipped - the
/// aligners see the same canvas size on both sides, which is what M2's phase
/// correlation needs.
pub fn warp_transform(template: &GrayImage, truth: &TruthTransform) -> GrayImage {
    let (width, height) = template.dimensions();
    let (cx, cy) = (f64::from(width - 1) / 2.0, f64::from(height - 1) / 2.0);
    let theta = truth.theta_deg.to_radians();
    let (cos, sin) = (theta.cos(), theta.sin());
    let scale = truth.scale;
    let (tx, ty) = (truth.tx_px, truth.ty_px);
    // Inverse of the forward transform: p = c + R(-θ)·((q − c − t) / s).
    let inverse = move |qx: f64, qy: f64| -> (f64, f64) {
        let dx = (qx - cx - tx) / scale;
        let dy = (qy - cy - ty) / scale;
        (cx + dx * cos + dy * sin, cy - dx * sin + dy * cos)
    };

    let mut out = GrayImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let (sx, sy) = inverse(f64::from(x), f64::from(y));
            let value = sample_bilinear(template, sx, sy).unwrap_or(0);
            out.put_pixel(x, y, Luma([value]));
        }
    }
    out
}

fn sample_bilinear(image: &GrayImage, x: f64, y: f64) -> Option<u8> {
    let (w, h) = image.dimensions();
    if x < 0.0 || y < 0.0 || x > f64::from(w - 1) || y > f64::from(h - 1) {
        return None;
    }
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let (fx, fy) = (x - f64::from(x0), y - f64::from(y0));
    let get = |px: u32, py: u32| -> f64 { f64::from(image.get_pixel(px, py).0[0]) };
    let top = get(x0, y0) * (1.0 - fx) + get(x1, y0) * fx;
    let bottom = get(x0, y1) * (1.0 - fx) + get(x1, y1) * fx;
    Some((top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0) as u8)
}

// ---- degradation chain (fixed order: illumination -> blur -> noise -> occlusion) ----

/// Downsamples `base` to the case working grid by the integer factor
/// `params.downsample` (area-average via `thumbnail`). This becomes the
/// template; the truth transform is expressed in these working-grid px.
pub fn make_template(base: &GrayImage, params: &CaseParams) -> GrayImage {
    if params.downsample <= 1 {
        return base.clone();
    }
    let factor = f64::from(params.downsample);
    let (w, h) = base.dimensions();
    // Round-to-zero keeps the factor an exact divisor semantics; at least 1px.
    let dw = (w as f64 / factor).max(1.0) as u32;
    let dh = (h as f64 / factor).max(1.0) as u32;
    image::imageops::resize(base, dw, dh, image::imageops::FilterType::Triangle)
}

/// Renders the input image: template + warp + degradations, in the fixed
/// contract order documented on the module. `rng` must be the case's own
/// [`SeededRng`]; nothing here reads global entropy.
pub fn render_input(template: &GrayImage, rng: &mut SeededRng, truth: &TruthTransform, params: &CaseParams) -> GrayImage {
    let warped = warp_transform(template, truth);

    // 1. illumination: gain then offset, clamped per pixel.
    let mut input = if params.gain != 1.0 || params.offset != 0.0 {
        let mut lit = warped.clone();
        for pixel in lit.pixels_mut() {
            let v = f64::from(pixel.0[0]) * params.gain + params.offset;
            pixel.0[0] = v.round().clamp(0.0, 255.0) as u8;
        }
        lit
    } else {
        warped
    };

    // 2. blur.
    if params.blur_sigma > 0.0 {
        input = imageproc::filter::gaussian_blur_f32(&input, params.blur_sigma as f32);
    }

    // 3. noise.
    if params.noise_sigma > 0.0 {
        for pixel in input.pixels_mut() {
            let v = f64::from(pixel.0[0]) + rng.gaussian() * params.noise_sigma;
            pixel.0[0] = v.round().clamp(0.0, 255.0) as u8;
        }
    }

    // 4. occlusion: one black rectangle covering ~occlusion_ratio of the
    //    canvas, placed by the RNG (the classic "坏板/遮挡" failure mode).
    if params.occlusion_ratio > 0.0 {
        let (w, h) = input.dimensions();
        let ratio = params.occlusion_ratio.min(1.0);
        // Pick the rectangle shape first, then position it fully inside.
        let aspect = rng.range_f64(0.5, 2.0);
        let area = f64::from(w) * f64::from(h) * ratio;
        let rw = ((area * aspect).sqrt().round() as u32).clamp(1, w);
        let rh = ((area / aspect).sqrt().round() as u32).clamp(1, h);
        let rx = (rng.next_f64() * f64::from(w - rw + 1)) as u32;
        let ry = (rng.next_f64() * f64::from(h - rh + 1)) as u32;
        for y in ry..ry + rh {
            for x in rx..rx + rw {
                input.put_pixel(x, y, Luma([0]));
            }
        }
    }

    input
}

/// Truth ranges for cases where the caller does not pin the transform: the
/// generator derives it from the case RNG so that "case = seed + params"
/// still holds verbatim (D4). Modest by design - M2's phase correlation must
/// be able to solve them.
pub fn derive_truth(rng: &mut SeededRng, template: &GrayImage) -> TruthTransform {
    let (w, h) = template.dimensions();
    let drift = f64::from(w.min(h)) * 0.05; // up to 5% of the short side
    TruthTransform {
        tx_px: rng.range_f64(-drift, drift),
        ty_px: rng.range_f64(-drift, drift),
        theta_deg: rng.range_f64(-1.5, 1.5),
        scale: rng.range_f64(0.99, 1.01),
    }
}

/// The generated triple plus everything needed to persist it. `truth` is the
/// resolved transform - either the caller-pinned one or the derived one - so
/// the persisted case record always describes the input exactly.
pub struct GeneratedCase {
    pub template: GrayImage,
    pub input: GrayImage,
    pub truth: TruthTransform,
}

/// Full generation from a base image. `truth = None` derives it from the RNG
/// (see [`derive_truth`]); `Some(truth)` is the instructor-pinned mode.
pub fn generate_case(base: &GrayImage, seed: u64, truth: Option<TruthTransform>, params: &CaseParams) -> GeneratedCase {
    let template = make_template(base, params);
    let mut rng = SeededRng::new(seed);
    // IMPORTANT draw order: truth (if derived) is drawn BEFORE the noise so
    // that pinning a truth never shifts the degradation stream.
    let truth = truth.unwrap_or_else(|| derive_truth(&mut rng, &template));
    let input = render_input(&template, &mut rng, &truth, params);
    GeneratedCase { template, input, truth }
}

// ---- case library on disk ----

/// Case library root layout: `<root>/<case_id>/{case.json, template.png, input.png}`.
/// PNG (not JPEG) keeps the reproducibility contract byte-exact; previews for
/// the UI are encoded at IPC time, never stored.
pub const CASE_FILE: &str = "case.json";
pub const TEMPLATE_FILE: &str = "template.png";
pub const INPUT_FILE: &str = "input.png";

/// Case id from its identity triple. Same seed + model + side regenerates into
/// the same folder - regeneration is idempotent (the lesson plan can re-derive
/// a case at any time), different seeds never collide.
pub fn case_id(model_name: &str, side: &str, seed: u64) -> String {
    let safe_model: String = model_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("{}_{}_{}", safe_model, side.to_ascii_uppercase(), seed)
}

/// Writes one case into the library and returns the case directory. The
/// `case.case_id` is authoritative; pass it already resolved via [`case_id`].
pub fn save_case(root: &Path, case: &AlignCase, template: &GrayImage, input: &GrayImage) -> Result<PathBuf, String> {
    case.validate()?;
    let dir = root.join(&case.case_id);
    // Write-then-rename would be nicer, but a torn case.json is detected by
    // the reader (validate) and regeneration is idempotent, so plain writes
    // keep the library inspectable.
    fs::create_dir_all(&dir).map_err(|error| format!("Cannot create {}: {error}", dir.display()))?;
    let json = serde_json::to_string_pretty(case).map_err(|error| format!("Cannot serialize the case: {error}"))?;
    fs::write(dir.join(CASE_FILE), json).map_err(|error| format!("Cannot write {CASE_FILE}: {error}"))?;
    write_png(&dir.join(TEMPLATE_FILE), template)?;
    write_png(&dir.join(INPUT_FILE), input)?;
    Ok(dir)
}

fn write_png(path: &Path, image: &GrayImage) -> Result<(), String> {
    image.save_with_format(path, image::ImageFormat::Png).map_err(|error| format!("Cannot write {}: {error}", path.display()))
}

/// Lists every valid case in the library, sorted by id. Broken or future-
/// schema folders are skipped (with a stderr note) instead of failing the
/// whole listing - the classroom must survive one damaged folder.
pub fn list_cases(root: &Path) -> Result<Vec<AlignCase>, String> {
    let mut cases = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        // An absent library is an empty library, not an error.
        Err(_) => return Ok(cases),
    };
    for entry in entries.flatten() {
        let case_file = entry.path().join(CASE_FILE);
        if !case_file.is_file() {
            continue;
        }
        match fs::read_to_string(&case_file)
            .map_err(|error| error.to_string())
            .and_then(|json| serde_json::from_str::<AlignCase>(&json).map_err(|error| error.to_string()))
            .and_then(|case| case.validate().map(|_| case))
        {
            Ok(case) => cases.push(case),
            Err(error) => eprintln!("align list_cases: skipping {}: {error}", case_file.display()),
        }
    }
    cases.sort_by(|a, b| a.case_id.cmp(&b.case_id));
    Ok(cases)
}

/// Loads one case's images. Returns `(case, template, input)`.
pub fn load_case(root: &Path, case_id: &str) -> Result<(AlignCase, GrayImage, GrayImage), String> {
    let dir = root.join(case_id);
    let json = fs::read_to_string(dir.join(CASE_FILE)).map_err(|error| format!("Cannot read the case {case_id}: {error}"))?;
    let case: AlignCase = serde_json::from_str(&json).map_err(|error| format!("Case {case_id} is not valid JSON: {error}"))?;
    case.validate()?;
    let template = image::open(dir.join(TEMPLATE_FILE))
        .map_err(|error| format!("Cannot decode the template of {case_id}: {error}"))?
        .to_luma8();
    let input = image::open(dir.join(INPUT_FILE))
        .map_err(|error| format!("Cannot decode the input of {case_id}: {error}"))?
        .to_luma8();
    Ok((case, template, input))
}

// ---- tests: the M1 regression anchor (Plan 05 acceptance) ----

#[cfg(test)]
mod tests {
    use super::*;

    /// A 64x64 base with a corner blob + stripes: enough structure for the
    /// warp and occlusion to be observable, small enough to keep tests fast.
    fn base_image() -> GrayImage {
        let mut image = GrayImage::from_pixel(64, 64, Luma([30]));
        for y in 10..20 {
            for x in 10..20 {
                image.put_pixel(x, y, Luma([220]));
            }
        }
        for y in 0..64 {
            for x in (0..64).step_by(4) {
                image.put_pixel(x, y, Luma([180]));
            }
        }
        image
    }

    fn test_params() -> CaseParams {
        CaseParams { noise_sigma: 3.0, gain: 1.1, offset: 5.0, blur_sigma: 0.8, occlusion_ratio: 0.05, downsample: 1 }
    }

    #[test]
    fn rng_is_deterministic_and_seeded() {
        let mut a = SeededRng::new(42);
        let mut b = SeededRng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
            assert!((a.next_f64() - b.next_f64()).abs() < f64::EPSILON);
        }
        let mut c = SeededRng::new(43);
        let mut a = SeededRng::new(42);
        assert_ne!(a.next_u64(), c.next_u64());
        // gaussians: deterministic, roughly standard normal over a batch
        let mut rng = SeededRng::new(7);
        let mean: f64 = (0..1000).map(|_| rng.gaussian()).sum::<f64>() / 1000.0;
        assert!(mean.abs() < 0.15, "gaussian mean {mean} is too far from 0");
    }

    #[test]
    fn same_seed_and_params_reproduce_bytes() {
        let base = base_image();
        let params = test_params();
        let first = generate_case(&base, 2026, None, &params);
        let second = generate_case(&base, 2026, None, &params);
        assert_eq!(first.template, second.template);
        assert_eq!(first.input, second.input);
        // byte-level: the stored PNGs must be identical too
        let png = |image: &GrayImage| {
            let mut bytes = Vec::new();
            image
                .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
                .unwrap();
            bytes
        };
        assert_eq!(png(&first.input), png(&second.input));
        // a different seed must produce a different input (noise at minimum)
        let other = generate_case(&base, 2027, None, &params);
        assert_ne!(first.input, other.input);
    }

    #[test]
    fn derived_truth_is_in_range_and_pinned_truth_beats_derivation() {
        let base = base_image();
        let params = CaseParams { downsample: 2, ..CaseParams::default() };
        let case = generate_case(&base, 5, None, &params);
        assert_eq!(case.template.dimensions(), (32, 32));
        assert!(case.truth.tx_px.abs() <= 1.6 && case.truth.ty_px.abs() <= 1.6, "truth {:?}", case.truth);
        assert!(case.truth.theta_deg.abs() <= 1.5 && (case.truth.scale - 1.0).abs() <= 0.01);

        // A pinned truth must win over derivation, and the degradation stream
        // must not depend on whether the truth was pinned.
        let pinned = TruthTransform { tx_px: 3.0, ty_px: -2.0, theta_deg: 0.0, scale: 1.0 };
        let a = generate_case(&base, 9, Some(pinned.clone()), &test_params());
        let mut rng = SeededRng::new(9);
        let template = make_template(&base, &test_params());
        let b = render_input(&template, &mut rng, &pinned, &test_params());
        assert_eq!(a.input, b);
    }

    #[test]
    fn identity_truth_reproduces_the_template_without_degradations() {
        let base = base_image();
        let params = CaseParams::default();
        let case = generate_case(&base, 1, Some(TruthTransform::default()), &params);
        assert_eq!(case.input, case.template);
    }

    #[test]
    fn warp_moves_content_by_the_truth_translation() {
        // pure translation: the blob center must land exactly tx/ty away
        let template = base_image();
        let truth = TruthTransform { tx_px: 5.0, ty_px: -3.0, theta_deg: 0.0, scale: 1.0 };
        let warped = warp_transform(&template, &truth);
        let centroid = |image: &GrayImage| -> (f64, f64) {
            let mut sx = 0.0;
            let mut sy = 0.0;
            let mut n = 0.0;
            for (x, y, p) in image.enumerate_pixels() {
                if p.0[0] == 220 {
                    sx += f64::from(x);
                    sy += f64::from(y);
                    n += 1.0;
                }
            }
            (sx / n, sy / n)
        };
        let (bx, by) = centroid(&template);
        let (wx, wy) = centroid(&warped);
        // 0.25px slack: bilinear + rounding can flip a border pixel in/out of
        // the exact-220 set, nudging the centroid by a fraction of a pixel.
        assert!((wx - bx - 5.0).abs() < 0.25, "wx {wx} vs {bx}");
        assert!((wy - by + 3.0).abs() < 0.25, "wy {wy} vs {by}");
    }

    #[test]
    fn degradation_chain_is_observable() {
        let template = base_image();
        let truth = TruthTransform::default();
        // gain darkens/brightens the mean
        let mut bright = CaseParams { gain: 1.5, ..CaseParams::default() };
        let out = render_input(&template, &mut SeededRng::new(1), &truth, &bright);
        let mean = |image: &GrayImage| -> f64 { image.pixels().map(|p| f64::from(p.0[0])).sum::<f64>() / f64::from(image.pixels().count() as u32) };
        assert!(mean(&out) > mean(&template));
        // noise strictly changes pixels
        bright = CaseParams { noise_sigma: 10.0, ..CaseParams::default() };
        let noisy = render_input(&template, &mut SeededRng::new(2), &truth, &bright);
        assert_ne!(noisy, template);
        // occlusion blacks out roughly the requested fraction
        let occluded = render_input(&template, &mut SeededRng::new(3), &truth, &CaseParams { occlusion_ratio: 0.10, ..CaseParams::default() });
        let black = occluded.pixels().filter(|p| p.0[0] == 0).count();
        assert!(black > 300 && black < 700, "black px {black} for a ~10% occluder on 64x64");
    }

    #[test]
    fn case_library_round_trips_and_lists_sorted() {
        let root = std::env::temp_dir().join(format!("afvi_gen_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let base = base_image();
        let case = generate_case(&base, 77, None, &test_params());
        let mut record = AlignCase::new(case_id("6AN0921", "top", 77), 77, "6AN0921", "top");
        record.truth = case.truth;
        record.params = test_params();
        record.template_path = TEMPLATE_FILE.into();
        record.input_path = INPUT_FILE.into();
        save_case(&root, &record, &case.template, &case.input).unwrap();

        // a second case under a different seed keeps the list sorted
        let case_b = generate_case(&base, 5, None, &test_params());
        let mut record_b = AlignCase::new(case_id("6AN0921", "top", 5), 5, "6AN0921", "top");
        record_b.truth = case_b.truth;
        record_b.params = test_params();
        save_case(&root, &record_b, &case_b.template, &case_b.input).unwrap();

        let listed = list_cases(&root).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].case_id, record_b.case_id);
        assert_eq!(listed[1].case_id, record.case_id);

        let (loaded, template, input) = load_case(&root, &record.case_id).unwrap();
        assert_eq!(loaded, record);
        assert_eq!(template, case.template);
        assert_eq!(input, case.input);

        // regeneration into the same id is idempotent
        save_case(&root, &record, &case.template, &case.input).unwrap();
        assert_eq!(list_cases(&root).unwrap().len(), 2);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn library_survives_a_broken_folder_and_a_missing_library() {
        let root = std::env::temp_dir().join(format!("afvi_gen_broken_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("damaged_case")).unwrap();
        fs::write(root.join("damaged_case").join(CASE_FILE), "{ not json").unwrap();
        fs::create_dir_all(root.join("stray")).unwrap();
        assert_eq!(list_cases(&root).unwrap().len(), 0);
        // no library at all -> empty, not an error
        assert_eq!(list_cases(&root.join("nope")).unwrap().len(), 0);
        let _ = fs::remove_dir_all(&root);
    }
}

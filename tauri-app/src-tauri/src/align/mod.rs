//! ALIGN: offline alignment simulation core (Plan 05, M0 scaffolding).
//!
//! Everything algorithmic lives behind [`Aligner`]; M2 adds the first real
//! implementation (phase correlation). The AlignCase schema is the contract
//! between the M1 generator, the case library and the graders, so it is
//! versioned and serde-stable from day one.

use dmt_copy_core::find_model_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub mod ecc;
pub mod generator;
pub mod overlay;
pub mod phase;

// ---- AlignCase: seed + parameters + truth, the reproducible case unit ----

/// The geometric truth injected by the M1 generator: input = template warped
/// by this transform (px on the case's working grid, i.e. after downsampling).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TruthTransform {
    pub tx_px: f64,
    pub ty_px: f64,
    pub theta_deg: f64,
    pub scale: f64,
}

impl Default for TruthTransform {
    fn default() -> Self {
        Self { tx_px: 0.0, ty_px: 0.0, theta_deg: 0.0, scale: 1.0 }
    }
}

/// Degradation parameters the generator applies on top of the warp. All
/// randomness derives from `seed`, never from a global RNG.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CaseParams {
    pub noise_sigma: f64,
    pub gain: f64,
    pub offset: f64,
    pub blur_sigma: f64,
    /// Fraction of the image covered by the synthetic occluder (0 = none).
    pub occlusion_ratio: f64,
    /// Working-grid downsample factor relative to the source tif.
    pub downsample: u32,
}

impl Default for CaseParams {
    fn default() -> Self {
        Self { noise_sigma: 0.0, gain: 1.0, offset: 0.0, blur_sigma: 0.0, occlusion_ratio: 0.0, downsample: 1 }
    }
}

/// One reproducible exercise: `(template, input, truth)` plus how the input
/// was derived. `schema_version` gates the case library on disk (Plan 05 M0).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlignCase {
    pub schema_version: u32,
    pub case_id: String,
    pub seed: u64,
    pub model_name: String,
    /// "TOP" | "BOTTOM" - which side strip the images come from.
    pub side: String,
    pub template_path: String,
    pub input_path: String,
    pub truth: TruthTransform,
    pub params: CaseParams,
}

impl AlignCase {
    pub const SCHEMA_VERSION: u32 = 1;

    pub fn new(case_id: impl Into<String>, seed: u64, model_name: impl Into<String>, side: &str) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            case_id: case_id.into(),
            seed,
            model_name: model_name.into(),
            side: side.to_ascii_uppercase(),
            template_path: String::new(),
            input_path: String::new(),
            truth: TruthTransform::default(),
            params: CaseParams::default(),
        }
    }

    /// Cases from an older schema are refused instead of half-interpreted.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != Self::SCHEMA_VERSION {
            return Err(format!(
                "Case schema v{} is not supported - expected v{}.",
                self.schema_version,
                Self::SCHEMA_VERSION
            ));
        }
        if self.case_id.trim().is_empty() {
            return Err("Case id must not be empty.".into());
        }
        match self.side.as_str() {
            "TOP" | "BOTTOM" => Ok(()),
            other => Err(format!("Unknown side {other} - expected TOP or BOTTOM.")),
        }
    }
}

// ---- Aligner trait + result ----

/// What an aligner reports for one run. Angles in degrees, translations in
/// working-grid px; `score`/`psr` are unitless confidence numbers.
#[derive(Debug, Clone, Serialize)]
pub struct AlignResult {
    pub aligner: String,
    pub tx_px: f64,
    pub ty_px: f64,
    pub theta_deg: f64,
    pub scale: f64,
    pub score: f64,
    pub psr: f64,
    pub ok: bool,
    pub elapsed_ms: u64,
    /// Human-readable note (failure reason, teaching hint, ...).
    pub message: String,
}

impl AlignResult {
    pub fn new(aligner: impl Into<String>) -> Self {
        Self {
            aligner: aligner.into(),
            tx_px: 0.0,
            ty_px: 0.0,
            theta_deg: 0.0,
            scale: 1.0,
            score: 0.0,
            psr: 0.0,
            ok: false,
            elapsed_ms: 0,
            message: String::new(),
        }
    }
}

/// The single algorithm seam (decision D1): every alignment approach - phase
/// correlation, ECC, pyramid variants - implements this and nothing else is
/// allowed to hardcode an algorithm.
pub trait Aligner: Send + Sync {
    fn name(&self) -> &str;

    /// `template` and `input` must already be on the same working grid
    /// (same downsample, same px scale) - grid normalization is M0/M1 data
    /// preparation, not an aligner concern (design doc §5.1).
    fn align(&self, template: &image::GrayImage, input: &image::GrayImage) -> Result<AlignResult, String>;
}

/// Test/stub aligner: reports a zero transform. Keeps the trait exercised
/// until M2 lands the real phase-correlation implementation.
pub struct IdentityAligner;

impl Aligner for IdentityAligner {
    fn name(&self) -> &str {
        "identity"
    }

    fn align(&self, template: &image::GrayImage, input: &image::GrayImage) -> Result<AlignResult, String> {
        if template.dimensions() != input.dimensions() {
            return Err(format!(
                "Grid mismatch: template {}x{} vs input {}x{}.",
                template.width(),
                template.height(),
                input.width(),
                input.height()
            ));
        }
        Ok(AlignResult::new(self.name()))
    }
}

// ---- MasterData path resolution (Q1 spike groundwork) ----

/// Where the master data for one side lives. `Found.path` may be a directory
/// (the M0 probe only lists locations; file-level layout is a Q1 deliverable).
#[derive(Debug)]
pub enum MasterDataLookup {
    Found { path: PathBuf, version: String },
    Missing { searched: Vec<String> },
}

/// Side string -> (canonical, directory name under `Line\`).
fn align_side(side: &str) -> Result<(&'static str, &'static str), String> {
    match side.trim().to_ascii_uppercase().as_str() {
        "TOP" => Ok(("TOP", "Top")),
        "BOTTOM" | "BTM" => Ok(("BOTTOM", "Bottom")),
        _ => Err(format!("Unknown side {side} - expected TOP or BOTTOM.")),
    }
}

/// Locate the MasterData folder under the model's version folders, mirroring
/// `resolve_median_tif`'s semantics: an unreachable share root is a hard
/// error, a missing folder is a `Missing` with the probed locations (D6 - the
/// generator falls back to an already-aligned MedianImage as the base map).
///
/// Q1 is still open (the real on-site layout is unconfirmed), so the probe
/// accepts both `Line\<Side>\Layer\MasterData` and `<version>\MasterData`,
/// case-insensitively; the first hit wins. When the Q1 spike pins the real
/// layout down, tighten this to exactly that layout.
pub fn resolve_master_data(repository_base: &str, model_name: &str, side: &str) -> Result<MasterDataLookup, String> {
    let (_, side_dir) = align_side(side)?;
    let trimmed = repository_base.trim();
    if trimmed.is_empty() {
        return Err("No PxRepository share is configured for this side.".into());
    }
    let base = Path::new(trimmed);
    fs::read_dir(base).map_err(|error| {
        format!("Cannot reach {} - check the network credentials and share access: {error}", base.display())
    })?;

    let mut searched = Vec::new();
    let model_dir = {
        let mut found = None;
        for root in [base.join("PxRepository"), base.to_path_buf()] {
            match find_model_dir(&root, model_name) {
                Ok(dir) => {
                    found = Some(dir);
                    break;
                }
                Err(error) => searched.push(error),
            }
        }
        found
    };
    let Some(model_dir) = model_dir else {
        return Ok(MasterDataLookup::Missing { searched });
    };

    let layer_relative = Path::new("Line").join(side_dir).join("Layer");
    for entry in fs::read_dir(&model_dir)
        .map_err(|error| format!("Cannot read {}: {error}", model_dir.display()))?
        .flatten()
    {
        if !entry.path().is_dir() {
            continue;
        }
        let version = entry.file_name().to_string_lossy().to_string();
        // layout A: ...\Line\<Side>\Layer\MasterData (next to the MEDIAN folder)
        for candidate in [entry.path().join(&layer_relative).join("MasterData"), entry.path().join("MasterData")] {
            if candidate.is_dir() {
                return Ok(MasterDataLookup::Found { path: candidate, version });
            }
        }
    }
    searched.push(format!(
        "No version folder under {} contains a MasterData folder next to Layer or at version root.",
        model_dir.display()
    ));
    Ok(MasterDataLookup::Missing { searched })
}

// ---- Pattern.tif: the Gerber render that overlays the MEDIAN strip (Q1) ----

/// Result of locating a versioned file under the model's version folders.
#[derive(Debug)]
pub enum FileLookup {
    Found { path: PathBuf, version: String },
    Missing { searched: Vec<String> },
}

/// Preferred version folder per side (matches the installed Vision software
/// versions; any sibling version with the same relative path is accepted).
fn preferred_version(side: &str) -> Result<(&'static str, &'static str), String> {
    match side.trim().to_ascii_uppercase().as_str() {
        "TOP" => Ok(("TOP", "2.0")),
        "BOTTOM" | "BTM" => Ok(("BOTTOM", "3.5")),
        _ => Err(format!("Unknown side {side} - expected TOP or BOTTOM.")),
    }
}

/// Locate a layer tif `\<repo\>\[PxRepository\]\<model>\<version>\<relative>` with the same
/// semantics as the MEDIAN resolver: unreachable share root is a hard error,
/// a missing file is a `Missing` carrying the probed locations. The preferred
/// version folder wins; any sibling version with the same relative path is
/// accepted.
fn resolve_layer_tif(repository_base: &str, model_name: &str, side: &str, relative: &Path) -> Result<FileLookup, String> {
    let (_, preferred) = preferred_version(side)?;
    let trimmed = repository_base.trim();
    if trimmed.is_empty() {
        return Err("No PxRepository share is configured for this side.".into());
    }
    let base = Path::new(trimmed);
    fs::read_dir(base).map_err(|error| {
        format!("Cannot reach {} - check the network credentials and share access: {error}", base.display())
    })?;

    let mut searched = Vec::new();
    let model_dir = {
        let mut found = None;
        for root in [base.join("PxRepository"), base.to_path_buf()] {
            match find_model_dir(&root, model_name) {
                Ok(dir) => {
                    found = Some(dir);
                    break;
                }
                Err(error) => searched.push(error),
            }
        }
        found
    };
    let Some(model_dir) = model_dir else {
        return Ok(FileLookup::Missing { searched });
    };

    let mut fallback: Option<(PathBuf, String)> = None;
    for entry in fs::read_dir(&model_dir)
        .map_err(|error| format!("Cannot read {}: {error}", model_dir.display()))?
        .flatten()
    {
        if !entry.path().is_dir() {
            continue;
        }
        let version = entry.file_name().to_string_lossy().to_string();
        let tif = entry.path().join(relative);
        if tif.is_file() {
            if version.eq_ignore_ascii_case(preferred) {
                return Ok(FileLookup::Found { path: tif, version });
            }
            fallback.get_or_insert((tif, version));
        }
    }
    match fallback {
        Some((path, version)) => Ok(FileLookup::Found { path, version }),
        None => {
            searched.push(format!("No version folder under {} contains {}", model_dir.display(), relative.display()));
            Ok(FileLookup::Missing { searched })
        }
    }
}

fn layer_relative(side: &str, sub_path: &[&str]) -> Result<PathBuf, String> {
    let (canonical_side, _) = preferred_version(side)?;
    let side_dir = if canonical_side == "TOP" { "Top" } else { "Bottom" };
    let mut relative = Path::new("Line").join(side_dir).join("Layer");
    for part in sub_path {
        relative = relative.join(part);
    }
    Ok(relative)
}

/// Locate the side's metal-marks layer `...\Line\<Side>\Layer\GB\Pattern.tif`
/// (rendered yellow in the Align/ROI view).
pub fn resolve_pattern_tif(repository_base: &str, model_name: &str, side: &str) -> Result<FileLookup, String> {
    resolve_layer_tif(repository_base, model_name, side, &layer_relative(side, &["GB", "Pattern.tif"])?)
}

/// Locate the side's SR board-body layer `...\Line\<Side>\Layer\L01\UNIT_0.tif`
/// (rendered green in the Align/ROI view).
pub fn resolve_unit0_tif(repository_base: &str, model_name: &str, side: &str) -> Result<FileLookup, String> {
    resolve_layer_tif(repository_base, model_name, side, &layer_relative(side, &["L01", "UNIT_0.tif"])?)
}

// ---- tests: schema stability + resolver semantics (the M0 regression seed) ----

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("afvi_align_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn align_case_json_round_trips_and_validates() {
        let mut case = AlignCase::new("case-001", 42, "6AN0921", "top");
        case.template_path = "T/template.png".into();
        case.input_path = "T/input.png".into();
        case.truth = TruthTransform { tx_px: 12.5, ty_px: -3.25, theta_deg: 0.4, scale: 1.002 };
        case.params = CaseParams { noise_sigma: 4.0, ..CaseParams::default() };

        let json = serde_json::to_string(&case).unwrap();
        let back: AlignCase = serde_json::from_str(&json).unwrap();
        assert_eq!(back, case);
        assert_eq!(back.schema_version, 1);
        assert_eq!(back.side, "TOP");
        back.validate().unwrap();

        let mut stale = back.clone();
        stale.schema_version = 99;
        assert!(stale.validate().is_err());
    }

    #[test]
    fn identity_aligner_accepts_same_grid_and_rejects_mismatch() {
        let a = image::GrayImage::from_raw(8, 8, vec![0u8; 64]).unwrap();
        assert_eq!(IdentityAligner.align(&a, &a).unwrap().aligner, "identity");
        let b = image::GrayImage::from_raw(8, 4, vec![0u8; 32]).unwrap();
        assert!(IdentityAligner.align(&a, &b).is_err());
    }

    fn write_master(root: &Path, model: &str, version: &str, side_dir: &str) {
        let dir = root.join("PxRepository").join(model).join(version).join("Line").join(side_dir).join("Layer").join("MasterData");
        fs::create_dir_all(&dir).unwrap();
    }

    #[test]
    fn master_data_is_found_via_pxrepository_layout() {
        let root = temp_dir("md_found");
        write_master(&root, "6AN0921", "2.0", "Top");
        match resolve_master_data(root.to_str().unwrap(), "6AN0921", "TOP").unwrap() {
            MasterDataLookup::Found { path, version } => {
                assert!(path.is_dir());
                assert_eq!(version, "2.0");
            }
            MasterDataLookup::Missing { searched } => panic!("expected Found, got Missing ({searched:?})"),
        }
    }

    #[test]
    fn master_data_sides_do_not_leak_and_missing_is_not_an_error() {
        let root = temp_dir("md_missing");
        write_master(&root, "6AN0921", "2.0", "Top");
        let result = resolve_master_data(root.to_str().unwrap(), "6AN0921", "BOTTOM").unwrap();
        assert!(matches!(result, MasterDataLookup::Missing { ref searched } if !searched.is_empty()));

        let no_model = resolve_master_data(root.to_str().unwrap(), "NOSUCH", "TOP").unwrap();
        assert!(matches!(no_model, MasterDataLookup::Missing { .. }));
    }

    #[test]
    fn master_data_unreachable_share_is_a_hard_error() {
        let missing = temp_dir("md_gone").join("no_such_share");
        let error = resolve_master_data(missing.to_str().unwrap(), "6AN0921", "TOP").unwrap_err();
        assert!(error.contains("Cannot reach"), "{error}");
    }

    #[test]
    fn master_data_rejects_unknown_side_and_empty_base() {
        assert!(resolve_master_data("C:\\tmp", "M", "LEFT").is_err());
        assert!(resolve_master_data("  ", "M", "TOP").is_err());
    }

    fn write_pattern(root: &Path, model: &str, version: &str, side_dir: &str) -> PathBuf {
        let tif = root.join("PxRepository").join(model).join(version).join("Line").join(side_dir).join("Layer").join("GB").join("Pattern.tif");
        fs::create_dir_all(tif.parent().unwrap()).unwrap();
        fs::write(&tif, b"placeholder - resolution only checks existence").unwrap();
        tif
    }

    #[test]
    fn pattern_tif_prefers_the_plan_version_and_falls_back() {
        let root = temp_dir("pattern");
        // only 2.1 exists on this fake FM1 - the sibling must win
        let tif = write_pattern(&root, "6AN0921", "2.1", "Top");
        match resolve_pattern_tif(root.to_str().unwrap(), "6AN0921", "TOP").unwrap() {
            FileLookup::Found { path, version } => {
                assert_eq!(path, tif);
                assert_eq!(version, "2.1");
            }
            FileLookup::Missing { searched } => panic!("expected the 2.1 fallback, got Missing ({searched:?})"),
        }
        // with 2.0 also present it must win over the sibling
        let preferred = write_pattern(&root, "6AN0921", "2.0", "Top");
        match resolve_pattern_tif(root.to_str().unwrap(), "6AN0921", "TOP").unwrap() {
            FileLookup::Found { path, version } => {
                assert_eq!(path, preferred);
                assert_eq!(version, "2.0");
            }
            FileLookup::Missing { .. } => panic!("expected the preferred 2.0"),
        }
    }

    #[test]
    fn pattern_tif_sides_do_not_leak_and_bottom_maps_to_bottom_folder() {
        let root = temp_dir("pattern_sides");
        write_pattern(&root, "6AN0921", "3.5", "Top");
        assert!(matches!(
            resolve_pattern_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM").unwrap(),
            FileLookup::Missing { .. }
        ));
        write_pattern(&root, "6AN0921", "3.5", "Bottom");
        assert!(matches!(
            resolve_pattern_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM").unwrap(),
            FileLookup::Found { .. }
        ));
    }

    #[test]
    fn pattern_tif_missing_model_is_missing_not_an_error() {
        let root = temp_dir("pattern_nomodel");
        assert!(matches!(
            resolve_pattern_tif(root.to_str().unwrap(), "NOSUCH", "TOP").unwrap(),
            FileLookup::Missing { ref searched } if !searched.is_empty()
        ));
        assert!(resolve_pattern_tif("  ", "6AN0921", "TOP").is_err());
    }

    fn write_unit0(root: &Path, model: &str, version: &str, side_dir: &str) {
        let tif = root
            .join("PxRepository")
            .join(model)
            .join(version)
            .join("Line")
            .join(side_dir)
            .join("Layer")
            .join("L01")
            .join("UNIT_0.tif");
        fs::create_dir_all(tif.parent().unwrap()).unwrap();
        fs::write(tif, b"placeholder - resolution only checks existence").unwrap();
    }

    #[test]
    fn unit0_tif_resolves_with_the_same_version_fallback_as_pattern() {
        let root = temp_dir("unit0");
        write_unit0(&root, "6AN0921", "3.4", "Bottom");
        match resolve_unit0_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM").unwrap() {
            FileLookup::Found { version, .. } => assert_eq!(version, "3.4"),
            FileLookup::Missing { .. } => panic!("expected the 3.4 sibling fallback"),
        }
        write_unit0(&root, "6AN0921", "3.5", "Bottom");
        match resolve_unit0_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM").unwrap() {
            FileLookup::Found { version, .. } => assert_eq!(version, "3.5"),
            FileLookup::Missing { .. } => panic!("expected the preferred 3.5"),
        }
        // the Top folder must not satisfy a BOTTOM query
        write_unit0(&root, "6AN0921", "3.5", "Top");
        assert!(matches!(
            resolve_unit0_tif(root.to_str().unwrap(), "6AN0921", "TOP").unwrap(),
            FileLookup::Found { .. }
        ));
        assert!(matches!(
            resolve_unit0_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM").unwrap(),
            FileLookup::Found { .. }
        ));
    }
}

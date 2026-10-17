//! ALIGN: offline alignment simulation core (Plan 05, M0 scaffolding).
//!
//! Everything algorithmic lives behind [`Aligner`]; M2 adds the first real
//! implementation (phase correlation). The AlignCase schema is the contract
//! between the M1 generator, the case library and the graders, so it is
//! versioned and serde-stable from day one.

use crate::machine::find_model_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub mod ecc;
pub mod fiducial;
pub mod generator;
pub mod metal_sim;
pub mod overlay;
pub mod phase;
pub mod steps;

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

// ---- AlignData: the pre-registered Metal/Open/SR trio (Plan 07) ----

/// The AlignData layer trio for one model. All three tifs share one coordinate
/// grid (verified on 7M99-631: white bboxes coincide), so the overlay needs no
/// cross-layer registration - see `overlay::compose_identity`.
#[derive(Debug)]
pub struct AlignDataLayers {
    pub metal: PathBuf,
    pub sr: PathBuf,
    /// The SR-opening layer - display only, never needed for registration.
    pub open: Option<PathBuf>,
    /// Where the trio came from ("PxRepository", "PxRepository/AlignData",
    /// "PxInventory/AlignData") - shown as the image version in the UI.
    pub source: String,
}

/// Result of locating the AlignData trio; `Missing` carries the probed
/// locations so the UI can show a safe empty state instead of an error.
#[derive(Debug)]
pub enum AlignDataLookup {
    Found(Box<AlignDataLayers>),
    Missing { searched: Vec<String> },
}

/// A location is only complete if Metal AND SR are both there - a lone Open
/// (or a lone Metal) is not usable for the overlay and must not stop the
/// search at lower-priority roots.
fn aligndata_in_dir(dir: &Path) -> Option<(PathBuf, PathBuf, Option<PathBuf>)> {
    let metal = dir.join("Metal.tif");
    let sr = dir.join("SR.tif");
    if !metal.is_file() || !sr.is_file() {
        return None;
    }
    let open = dir.join("Open.tif");
    Some((metal, sr, open.is_file().then_some(open)))
}

/// The AlignData trio has shown up in a different folder on nearly every
/// model (model dir root, AlignData subfolder, INSPECT_SPEC root, ...), so
/// instead of enumerating layouts we scan the model dir breadth-first: the
/// SHALLOWEST complete trio wins, which keeps the intuitive priority (root >
/// AlignData\ > anything deeper) without hardcoding it. Depth and visited-dir
/// caps bound the network chatter on slow shares - the versioned layer trees
/// (e.g. `2.0\Line\Top\Layer\...`) can be wide and every level is a `read_dir`
/// over SMB.
const ALIGNDATA_SCAN_DEPTH: u32 = 6;
const ALIGNDATA_SCAN_MAX_DIRS: usize = 512;

fn find_aligndata_trio(model_dir: &Path) -> Option<(PathBuf, PathBuf, Option<PathBuf>, String)> {
    let mut visited = 0usize;
    let mut queue: Vec<(PathBuf, String, u32)> = vec![(model_dir.to_path_buf(), String::new(), 0)];
    let mut index = 0usize;
    while index < queue.len() {
        if visited >= ALIGNDATA_SCAN_MAX_DIRS {
            return None;
        }
        let (dir, rel, depth) = queue[index].clone();
        index += 1;
        visited += 1;
        if let Some((metal, sr, open)) = aligndata_in_dir(&dir) {
            let source = if rel.is_empty() { String::new() } else { format!("\\{rel}") };
            return Some((metal, sr, open, source));
        }
        if depth >= ALIGNDATA_SCAN_DEPTH {
            continue;
        }
        let mut children: Vec<String> = match fs::read_dir(&dir) {
            Ok(entries) => entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .collect(),
            Err(_) => continue, // unreadable subtree: skip, keep scanning siblings
        };
        children.sort_by_key(|name| name.to_lowercase());
        for name in children {
            queue.push((dir.join(&name), if rel.is_empty() { name } else { format!("{rel}\\{name}") }, depth + 1));
        }
    }
    None
}

/// Locate the model's AlignData trio, highest-priority source first:
///
/// 1. `<repository>\[PxRepository\]<model>\` - the model dir is scanned
///    breadth-first for the shallowest complete Metal+SR pair (root, then
///    `AlignData\`, then deeper nesting - see [`find_aligndata_trio`]),
/// 2. `<inventory>\INSPECT_SPEC\<model(-00 folded)>\` - same scan, only when
///    an inventory root is supplied.
///
/// Same error semantics as the MEDIAN resolver: an unreachable repository
/// root is a hard error, everything else is a `Missing` with the probed
/// locations. The inventory root being unreachable is NOT fatal - it is a
/// secondary source and one dead share must not kill the primary path.
pub fn resolve_aligndata_tifs(
    repository_base: &str,
    inventory_base: Option<&str>,
    model_name: &str,
) -> Result<AlignDataLookup, String> {
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
    if let Some(model_dir) = model_dir {
        if let Some((metal, sr, open, rel)) = find_aligndata_trio(&model_dir) {
            let source = format!("PxRepository{rel}");
            return Ok(AlignDataLookup::Found(Box::new(AlignDataLayers { metal, sr, open, source })));
        }
        searched.push(format!("No Metal.tif+SR.tif pair within depth {ALIGNDATA_SCAN_DEPTH} under {}", model_dir.display()));
    }

    let Some(inventory) = inventory_base.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(AlignDataLookup::Missing { searched });
    };
    let spec_root = Path::new(inventory).join("INSPECT_SPEC");
    match find_model_dir(&spec_root, model_name) {
        Ok(spec_dir) => match find_aligndata_trio(&spec_dir) {
            Some((metal, sr, open, rel)) => {
                let source = format!("PxInventory{rel}");
                return Ok(AlignDataLookup::Found(Box::new(AlignDataLayers { metal, sr, open, source })));
            }
            None => searched.push(format!(
                "No Metal.tif+SR.tif pair within depth {ALIGNDATA_SCAN_DEPTH} under {}",
                spec_dir.display()
            )),
        },
        Err(error) => searched.push(error),
    }
    Ok(AlignDataLookup::Missing { searched })
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

    /// Writes a complete AlignData trio (Open optional) into `dir`.
    fn write_aligndata(dir: &Path, with_open: bool) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("Metal.tif"), b"").unwrap();
        fs::write(dir.join("SR.tif"), b"").unwrap();
        if with_open {
            fs::write(dir.join("Open.tif"), b"").unwrap();
        }
    }

    #[test]
    fn aligndata_trio_is_found_at_the_model_dir_root_first() {
        let root = temp_dir("ad_root");
        write_aligndata(&root.join("PxRepository").join("7M99-631"), true);
        // a decoy subfolder trio must NOT win over the model dir root
        write_aligndata(&root.join("PxRepository").join("7M99-631").join("AlignData"), false);

        match resolve_aligndata_tifs(root.to_str().unwrap(), None, "7M99-631").unwrap() {
            AlignDataLookup::Found(layers) => {
                assert_eq!(layers.source, "PxRepository");
                assert!(layers.metal.ends_with("Metal.tif"));
                assert!(layers.open.is_some(), "Open rides along when present");
            }
            AlignDataLookup::Missing { .. } => panic!("expected Found at the model dir root"),
        }
    }

    #[test]
    fn aligndata_subfolder_is_the_second_repository_source() {
        let root = temp_dir("ad_sub");
        write_aligndata(&root.join("7M99-631").join("AlignData"), false);

        match resolve_aligndata_tifs(root.to_str().unwrap(), None, "7M99-631").unwrap() {
            AlignDataLookup::Found(layers) => {
                assert_eq!(layers.source, "PxRepository\\AlignData");
                assert!(layers.open.is_none(), "Open stays optional");
            }
            AlignDataLookup::Missing { .. } => panic!("expected Found in the AlignData subfolder"),
        }
    }

    #[test]
    fn aligndata_scan_finds_a_deeper_nesting_shallowest_first() {
        let root = temp_dir("ad_deep");
        // nobody knows where it lands: trio inside a version folder two levels down
        write_aligndata(&root.join("7M99-631").join("2.0").join("something").join("AlignData"), false);
        // a deeper decoy must NOT win over the shallower match
        write_aligndata(&root.join("7M99-631").join("2.0").join("something").join("AlignData").join("more"), false);

        match resolve_aligndata_tifs(root.to_str().unwrap(), None, "7M99-631").unwrap() {
            AlignDataLookup::Found(layers) => assert_eq!(layers.source, "PxRepository\\2.0\\something\\AlignData"),
            AlignDataLookup::Missing { .. } => panic!("expected the recursive scan to find the nested trio"),
        }
    }

    #[test]
    fn aligndata_falls_through_to_the_inventory_spec_when_repository_has_none() {
        let root = temp_dir("ad_inv");
        let inventory = temp_dir("ad_inv_spec");
        // the 7M99-631-00 drop: trio at the spec dir ROOT next to an AlignData
        // folder - the root pair is shallower and must win
        let spec_dir = inventory.join("INSPECT_SPEC").join("7M99-631-00");
        write_aligndata(&spec_dir, true);
        write_aligndata(&spec_dir.join("AlignData"), false);

        match resolve_aligndata_tifs(root.to_str().unwrap(), Some(inventory.to_str().unwrap()), "7m99-631").unwrap() {
            AlignDataLookup::Found(layers) => {
                assert_eq!(layers.source, "PxInventory");
                assert!(layers.metal.ends_with("7M99-631-00\\Metal.tif") || layers.metal.to_string_lossy().to_lowercase().contains("7m99-631-00\\metal.tif"));
            }
            AlignDataLookup::Missing { .. } => panic!("expected Found via the inventory spec"),
        }
    }

    #[test]
    fn aligndata_partial_trio_does_not_stop_the_search_and_missing_is_not_an_error() {
        let root = temp_dir("ad_part");
        let inventory = temp_dir("ad_part_spec");
        // repository holds a lone Metal.tif - incomplete, must be skipped
        fs::create_dir_all(root.join("PxRepository").join("7M99-631")).unwrap();
        fs::write(root.join("PxRepository").join("7M99-631").join("Metal.tif"), b"").unwrap();
        write_aligndata(&inventory.join("INSPECT_SPEC").join("7M99-631-00").join("AlignData"), false);

        match resolve_aligndata_tifs(root.to_str().unwrap(), Some(inventory.to_str().unwrap()), "7M99-631").unwrap() {
            AlignDataLookup::Found(layers) => assert_eq!(layers.source, "PxInventory\\AlignData"),
            AlignDataLookup::Missing { .. } => panic!("expected the inventory fallback to win"),
        }

        // nothing anywhere: Missing with the probed locations, never an error
        let empty_root = temp_dir("ad_none");
        let empty_inv = temp_dir("ad_none_inv");
        match resolve_aligndata_tifs(empty_root.to_str().unwrap(), Some(empty_inv.to_str().unwrap()), "7M99-631").unwrap() {
            AlignDataLookup::Missing { searched } => assert!(!searched.is_empty()),
            AlignDataLookup::Found(_) => panic!("nothing exists - Found is wrong"),
        }
    }

    #[test]
    fn aligndata_unreachable_repository_is_a_hard_error_but_dead_inventory_is_not() {
        // dead repository root: hard error (same semantics as the MEDIAN resolver)
        let error = resolve_aligndata_tifs("C:\\definitely\\not\\here", None, "7M99-631").unwrap_err();
        assert!(error.contains("Cannot reach"), "{error}");

        // reachable repository without the model + dead inventory: Missing, not an error
        let root = temp_dir("ad_dead_inv");
        match resolve_aligndata_tifs(root.to_str().unwrap(), Some("C:\\definitely\\not\\here"), "7M99-631").unwrap() {
            AlignDataLookup::Missing { searched } => assert!(!searched.is_empty()),
            AlignDataLookup::Found(_) => panic!("nothing exists - Found is wrong"),
        }

        assert!(resolve_aligndata_tifs("   ", None, "7M99-631").is_err());
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

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine as _;
use image::ImageEncoder as _;

// Shared Model Copy / scan domain logic: the same code also runs inside the
// per-site dmt-agent daemon, so the safety rules exist exactly once.
use dmt_copy_core as core;
use dmt_copy_core::{
    canonical_model_name, find_model_dir, AgentRequest, AgentTarget, CopyEndpoint, CopyProgress,
    CopyReport, MachinePaths, ModelCandidate,
};

pub mod align;
pub mod export_excel;
pub mod storage;

use storage::{migrate_store, open_store, persist_storage_config, read_storage_config, MigrationReport, StorageConfig, StoreCache};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
struct HostSources {
    model_name: String,
    host: String,
    side: String,
    light_spec_xml: String,
    inspection_specs: Vec<InspectionSource>,
    spec_parameter_xml: Option<String>,
    spec_tree_node_xml: Option<String>,
}

/// Apply the stored credentials to the IPC$ share of every UNC server the
/// machine touches. (The implementation lives in dmt-copy-core, shared with
/// the site agent which must log on to the same shares from inside the LAN.)
#[cfg(windows)]
fn ensure_network_credentials(machine: &MachinePaths) -> Result<(), String> {
    core::ensure_unc_credentials(
        &[&machine.fm1_path, &machine.fm2_path, &machine.bm_path],
        &machine.username,
        &machine.password,
    )
}

#[cfg(not(windows))]
fn ensure_network_credentials(_machine: &MachinePaths) -> Result<(), String> {
    Ok(())
}

#[derive(Serialize)]
struct InspectionSource {
    light: String,
    xml: String,
}

fn read_named_file(directory: &Path, expected_name: &str) -> Result<String, String> {
    let entries = fs::read_dir(directory).map_err(|error| format!("Cannot read {}: {error}", directory.display()))?;
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case(expected_name) {
            return fs::read_to_string(entry.path()).map_err(|error| format!("Cannot read {}: {error}", entry.path().display()));
        }
    }
    Err(format!("{expected_name} was not found in {}", directory.display()))
}

fn optional_root_file(base_path: &Path, name: &str) -> Option<String> {
    fs::read_to_string(base_path.join(name)).ok()
}

// Network scans run as async commands on the worker pool: a slow share (e.g.
// over Tailscale) must never occupy the main thread or the whole UI freezes.
// The per-host parallelism and the credential logon live in dmt-copy-core.

#[tauri::command]
async fn scan_machine_models(machine: MachinePaths) -> Result<Vec<ModelCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::scan_hosts(
            &[("FM1", &machine.fm1_path), ("FM2", &machine.fm2_path), ("BM", &machine.bm_path)],
            &machine.username,
            &machine.password,
        )
    })
    .await
    .map_err(|error| format!("Scan task failed: {error}"))?
}

fn collect_host_sources(base: &Path, host: &str, model_name: &str) -> Result<HostSources, String> {
    let light_dir = find_model_dir(&base.join("LIGHT_SPEC"), &model_name)?;
    let inspect_dir = find_model_dir(&base.join("INSPECT_SPEC"), &model_name)?;
    let side = if host.eq_ignore_ascii_case("BM") { "BOTTOM" } else { "TOP" };

    let light_spec_xml = read_named_file(&light_dir, "LightSpec.xml")?;
    let mut inspection_specs = Vec::new();
    let side_dir = inspect_dir.join(side);
    for light in ["LIGHT0", "LIGHT1", "LIGHT2"] {
        let path = side_dir.join(light);
        if path.exists() {
            inspection_specs.push(InspectionSource {
                light: light.into(),
                xml: read_named_file(&path, "InspectionSpec.xml")?,
            });
        }
    }

    if inspection_specs.is_empty() {
        return Err(format!("No InspectionSpec.xml files found under {}", side_dir.display()));
    }

    Ok(HostSources {
        model_name: canonical_model_name(&model_name),
        host: host.into(),
        side: side.into(),
        light_spec_xml,
        inspection_specs,
        spec_parameter_xml: optional_root_file(&base, "SpecParameter.xml"),
        spec_tree_node_xml: optional_root_file(&base, "SpecTreeNode.xml"),
    })
}

#[tauri::command]
async fn collect_machine_sources(machine: MachinePaths, model_name: String) -> Result<Vec<HostSources>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let hosts = [("FM1", &machine.fm1_path), ("FM2", &machine.fm2_path), ("BM", &machine.bm_path)];
        let collected: Vec<Result<HostSources, String>> = std::thread::scope(|scope| {
            let handles: Vec<_> = hosts
                .iter()
                .map(|(host, path)| {
                    let model_name = model_name.clone();
                    scope.spawn(move || collect_host_sources(Path::new(path), host, &model_name))
                })
                .collect();
            handles.into_iter().map(|handle| handle.join().unwrap_or_else(|_| Err("Collection thread panicked".to_string()))).collect()
        });
        collected.into_iter().collect()
    })
    .await
    .map_err(|error| format!("Collection task failed: {error}"))?
}

// ---- Center stage: the model's MEDIAN strip image, one side at a time ----
// TOP comes from FM1's PxRepository share, BOTTOM from BM's (FM2 is skipped).
// The tif files run into the gigapixel range, so the command decodes on the
// worker pool and ships a downscaled JPEG preview instead of the raw image.

const MEDIAN_FILE: &str = "Median_0_1_0.tif";

/// Longest allowed preview side in pixels: the stage zooms into this preview,
/// so 4096 keeps 2-4x magnification sharp while the JPEG stays IPC-friendly.
const MEDIAN_PREVIEW_MAX_SIDE: u32 = 4096;

/// Serializes the decode + downscale of huge tifs, so two quick side toggles
/// never hold two gigapixel decode buffers at the same time.
static MEDIAN_DECODE_GATE: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
struct MedianImage {
    side: String,
    host: String,
    /// Version folder the file was found in ("2.0" on FM1, "3.5" on BM - when
    /// the installed Vision software versions differ, any version that has the
    /// file wins).
    version: String,
    path: String,
    /// Original pixel dimensions of the tif on disk.
    width: u32,
    height: u32,
    /// Downscaled preview, base64 JPEG.
    data: String,
}

#[derive(Serialize)]
struct MedianImageOutcome {
    /// "found" when a preview is available, "missing" when the model simply
    /// has no median image on this side (an everyday case, not a failure).
    status: String,
    image: Option<MedianImage>,
    /// Share locations that were probed while the image was missing.
    searched: Vec<String>,
}

#[derive(Debug)]
enum MedianLookup {
    Found { path: PathBuf, version: String },
    Missing { searched: Vec<String> },
}

/// Canonical side, owning host and the version folder named in the plan.
fn median_side(side: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match side.trim().to_ascii_uppercase().as_str() {
        "TOP" => Ok(("TOP", "FM1", "2.0")),
        "BOTTOM" | "BTM" => Ok(("BOTTOM", "BM", "3.5")),
        _ => Err(format!("Unknown side {side} - expected TOP or BOTTOM.")),
    }
}

/// Locate `\<repo\>\[PxRepository\]\<model>\<version>\Line\<Top|Bottom>\Layer\MEDIAN\Median_0_1_0.tif`.
/// The version folder depends on the installed Vision software, so the exact
/// version from the plan is preferred but any sibling version with the same
/// relative path is accepted. An unreadable share root is an access problem
/// (hard error); a model or file that is simply not there is a `Missing`.
fn resolve_median_tif(repository_base: &str, model_name: &str, side: &str) -> Result<MedianLookup, String> {
    let (_, host, preferred_version) = median_side(side)?;
    let side_dir = if side == "TOP" { "Top" } else { "Bottom" };
    let trimmed = repository_base.trim();
    if trimmed.is_empty() {
        return Err(format!("No PxRepository share is configured for {host}."));
    }
    let base = Path::new(trimmed);
    fs::read_dir(base).map_err(|error| format!("Cannot reach {} - check the network credentials and share access: {error}", base.display()))?;

    let relative = Path::new("Line").join(side_dir).join("Layer").join("MEDIAN").join(MEDIAN_FILE);
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
        return Ok(MedianLookup::Missing { searched });
    };

    let mut fallback: Option<(PathBuf, String)> = None;
    for entry in fs::read_dir(&model_dir).map_err(|error| format!("Cannot read {}: {error}", model_dir.display()))?.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let version = entry.file_name().to_string_lossy().to_string();
        let tif = entry.path().join(&relative);
        if tif.exists() {
            if version.eq_ignore_ascii_case(preferred_version) {
                return Ok(MedianLookup::Found { path: tif, version });
            }
            fallback.get_or_insert((tif, version));
        }
    }
    match fallback {
        Some((path, version)) => Ok(MedianLookup::Found { path, version }),
        None => {
            searched.push(format!(
                "No version folder under {} contains {}",
                model_dir.display(),
                relative.display()
            ));
            Ok(MedianLookup::Missing { searched })
        }
    }
}

fn decode_median_preview(path: &Path, side: &str, host: &str, version: String) -> Result<MedianImage, String> {
    let _gate = MEDIAN_DECODE_GATE.lock().map_err(|_| "Median decode gate is poisoned".to_string())?;
    // Scope so the FULL-RESOLUTION buffer is dropped before the base64 step:
    // on a gigapixel strip that is >1 GB the encode stage must never hold it.
    let (width, height, jpeg) = {
        let image = image::open(path).map_err(|error| format!("Cannot decode {}: {error}", path.display()))?;
        let (width, height) = (image.width(), image.height());
        let preview = if width.max(height) > MEDIAN_PREVIEW_MAX_SIDE {
            image.thumbnail(MEDIAN_PREVIEW_MAX_SIDE, MEDIAN_PREVIEW_MAX_SIDE)
        } else {
            image
        };
        let rgb = preview.to_rgb8();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
            .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
            .map_err(|error| format!("Cannot encode the preview of {}: {error}", path.display()))?;
        (width, height, jpeg)
    };
    Ok(MedianImage {
        side: side.to_string(),
        host: host.to_string(),
        version,
        path: path.display().to_string(),
        width,
        height,
        data: base64::engine::general_purpose::STANDARD.encode(&jpeg),
    })
}

#[tauri::command]
async fn load_median_image(machine: MachinePaths, repository_path: String, model_name: String, side: String) -> Result<MedianImageOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let (side, host, _) = median_side(&side)?;
        match resolve_median_tif(&repository_path, &model_name, &side)? {
            MedianLookup::Found { path, version } => Ok(MedianImageOutcome {
                status: "found".into(),
                image: Some(decode_median_preview(&path, &side, host, version)?),
                searched: Vec::new(),
            }),
            MedianLookup::Missing { searched } => {
                Ok(MedianImageOutcome { status: "missing".into(), image: None, searched })
            }
        }
    })
    .await
    .map_err(|error| format!("Median image task failed: {error}"))?
}

// ---- ALIGN tab: offline alignment simulation (Plan 05). M0 only probes the
// data foundations - the MEDIAN tif and the MasterData folder for one side -
// without decoding anything; algorithms arrive behind `align::Aligner`. ----

#[derive(Serialize)]
struct AlignSourcePath {
    /// "found" | "missing" - a missing MasterData is the everyday D6 case.
    status: String,
    path: Option<String>,
    version: Option<String>,
    searched: Vec<String>,
}

#[derive(Serialize)]
struct AlignSourceProbe {
    side: String,
    model_name: String,
    median: AlignSourcePath,
    master_data: AlignSourcePath,
}

fn probe_path(outcome: Result<MedianLookup, String>) -> Result<AlignSourcePath, String> {
    match outcome? {
        MedianLookup::Found { path, version } => Ok(AlignSourcePath {
            status: "found".into(),
            path: Some(path.display().to_string()),
            version: Some(version),
            searched: Vec::new(),
        }),
        MedianLookup::Missing { searched } => {
            Ok(AlignSourcePath { status: "missing".into(), path: None, version: None, searched })
        }
    }
}

fn probe_master(outcome: Result<align::MasterDataLookup, String>) -> Result<AlignSourcePath, String> {
    match outcome? {
        align::MasterDataLookup::Found { path, version } => Ok(AlignSourcePath {
            status: "found".into(),
            path: Some(path.display().to_string()),
            version: Some(version),
            searched: Vec::new(),
        }),
        align::MasterDataLookup::Missing { searched } => {
            Ok(AlignSourcePath { status: "missing".into(), path: None, version: None, searched })
        }
    }
}

#[tauri::command]
async fn align_probe_sources(machine: MachinePaths, repository_path: String, model_name: String, side: String) -> Result<AlignSourceProbe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let (side, _, _) = median_side(&side)?;
        Ok(AlignSourceProbe {
            side: side.into(),
            model_name: model_name.clone(),
            median: probe_path(resolve_median_tif(&repository_path, &model_name, &side))?,
            master_data: probe_master(align::resolve_master_data(&repository_path, &model_name, &side))?,
        })
    })
    .await
    .map_err(|error| format!("Align probe task failed: {error}"))?
}

/// Loads the side's GB `Pattern.tif` (the Gerber render that overlays the
/// MEDIAN strip) as a downscaled preview - same decode gate, same "no raw
/// image over IPC" rule. A missing pattern is `status: "missing"`, not an error.
#[tauri::command]
async fn align_load_pattern(machine: MachinePaths, repository_path: String, model_name: String, side: String) -> Result<MedianImageOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let (side, host, _) = median_side(&side)?;
        match align::resolve_pattern_tif(&repository_path, &model_name, &side)? {
            align::FileLookup::Found { path, version } => Ok(MedianImageOutcome {
                status: "found".into(),
                image: Some(decode_median_preview(&path, &side, host, version)?),
                searched: Vec::new(),
            }),
            align::FileLookup::Missing { searched } => {
                Ok(MedianImageOutcome { status: "missing".into(), image: None, searched })
            }
        }
    })
    .await
    .map_err(|error| format!("Pattern image task failed: {error}"))?
}

/// Loads the side's colored Align/ROI render: the SR board body (L01\UNIT_0)
/// in green with the metal marks (GB\Pattern) in yellow, registered via the
/// corner fiducial crosses and display-idealized (see align::overlay). Runs
/// under the same decode gate and ships a downscaled JPEG - no raw IPC.
///
/// Degrades gracefully to the plain grey pattern preview whenever the overlay
/// is not possible (missing UNIT_0, no fiducial crosses, shape pathology) -
/// that is the everyday D6 case, never an error.
#[tauri::command]
async fn align_load_overlay(machine: MachinePaths, repository_path: String, model_name: String, side: String) -> Result<MedianImageOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let (side, host, _) = median_side(&side)?;

        // The grey pattern is both the fallback and the metadata source
        // (version string, reported path).
        let pattern = match align::resolve_pattern_tif(&repository_path, &model_name, &side)? {
            align::FileLookup::Found { path, version } => Some((path, version)),
            align::FileLookup::Missing { searched } => {
                return Ok(MedianImageOutcome { status: "missing".into(), image: None, searched });
            }
        };
        let fallback = |version: String, path: &Path| {
            decode_median_preview(path, &side, host, version).map(|image| MedianImageOutcome {
                status: "found".into(),
                image: Some(image),
                searched: Vec::new(),
            })
        };
        let (pattern_path, version) = pattern.unwrap();
        let unit0 = match align::resolve_unit0_tif(&repository_path, &model_name, &side)? {
            align::FileLookup::Found { path, .. } => Some(path),
            align::FileLookup::Missing { .. } => None,
        };
        let Some(unit0_path) = unit0 else {
            return fallback(version, &pattern_path);
        };

        let overlay = (|| -> Result<MedianImageOutcome, String> {
            // Deliberately NOT under MEDIAN_DECODE_GATE: the gate serializes
            // gigapixel strip decodes, but these layers are ~24 MB luma buffers
            // (~2.4 MP) - holding the gate here would queue the overlay behind
            // both median decodes at model pick and dominate the perceived
            // load time. Two concurrent overlay decodes cost ~50 MB, nothing
            // on a 32 GB machine.
            let sr_layer = image::open(&unit0_path)
                .map_err(|error| format!("Cannot decode {}: {error}", unit0_path.display()))?
                .to_luma8();
            let metal_layer = image::open(&pattern_path)
                .map_err(|error| format!("Cannot decode {}: {error}", pattern_path.display()))?
                .to_luma8();
            let composite = align::overlay::compose_overlay(&sr_layer, &metal_layer)?;
            drop(sr_layer);
            drop(metal_layer);

            let rgb = image::DynamicImage::ImageRgba8(composite).into_rgb8();
            let mut jpeg = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
                .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
                .map_err(|error| format!("Cannot encode the overlay preview: {error}"))?;
            Ok(MedianImageOutcome {
                status: "found".into(),
                image: Some(MedianImage {
                    side: side.to_string(),
                    host: host.to_string(),
                    version: version.clone(),
                    path: pattern_path.display().to_string(),
                    width: rgb.width(),
                    height: rgb.height(),
                    data: base64::engine::general_purpose::STANDARD.encode(&jpeg),
                }),
                searched: Vec::new(),
            })
        })();
        match overlay {
            Ok(outcome) => Ok(outcome),
            // shape pathology (no crosses, empty layer, ...): grey fallback
            Err(error) => {
                eprintln!("align_load_overlay: falling back to the grey pattern ({error})");
                fallback(version, &pattern_path)
            }
        }
    })
    .await
    .map_err(|error| format!("Overlay image task failed: {error}"))?
}

// ---- ALIGN M1: synthetic case generator (Plan 05). The template is the
// side's base image on the case working grid, the input is that template
// warped by a known truth transform and degraded (illumination/blur/noise/
// occlusion). Every random draw comes from the case seed, so the same seed +
// params regenerate byte-identical PNGs (D4) - the case library is the
// project's regression anchor from here on. ----

/// Case library root under the app data dir (never a hardcoded path).
const ALIGN_CASE_LIBRARY_DIR: &str = "align-cases";

/// Working-grid cap for generated cases: the teaching set is 2K level (Q2,
/// Plan 05 M1). `downsample: 0` auto-picks the factor that lands here.
const ALIGN_CASE_MAX_SIDE: u32 = 2048;

#[derive(Serialize)]
struct CaseImagePreview {
    width: u32,
    height: u32,
    /// Base64 JPEG of the working-grid image (already small, no further
    /// downsampling - D3 keeps raw buffers out of the IPC).
    data: String,
}

#[derive(Serialize)]
struct AlignCaseOutcome {
    case: align::AlignCase,
    /// Absolute path of the written case folder.
    case_dir: String,
    template: CaseImagePreview,
    input: CaseImagePreview,
}

fn encode_case_preview(image: &image::GrayImage) -> Result<CaseImagePreview, String> {
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .write_image(image.as_raw(), image.width(), image.height(), image::ExtendedColorType::L8)
        .map_err(|error| format!("Cannot encode the case preview: {error}"))?;
    Ok(CaseImagePreview {
        width: image.width(),
        height: image.height(),
        data: base64::engine::general_purpose::STANDARD.encode(&jpeg),
    })
}

/// Decodes the case's base image: "median" (default) is the camera-like strip,
/// "pattern" the metal-marks mask. Unlike the viewers this is a hard error when
/// missing - without an ideal image there is nothing to generate from.
fn decode_case_base(repository_base: &str, model_name: &str, side: &str, base_source: &str) -> Result<image::GrayImage, String> {
    match base_source {
        "pattern" => match align::resolve_pattern_tif(repository_base, model_name, side)? {
            align::FileLookup::Found { path, .. } => {
                image::open(&path).map_err(|error| format!("Cannot decode {}: {error}", path.display())).map(|img| img.to_luma8())
            }
            align::FileLookup::Missing { searched } => {
                Err(format!("No GB Pattern.tif to use as the case base image: {}", searched.join("; ")))
            }
        },
        // The MEDIAN strip may be gigapixel: decode under the serial gate,
        // exactly like the viewer pipeline.
        _ => {
            let _gate = MEDIAN_DECODE_GATE.lock().map_err(|_| "Median decode gate is poisoned".to_string())?;
            match resolve_median_tif(repository_base, model_name, side)? {
                MedianLookup::Found { path, .. } => image::open(&path)
                    .map_err(|error| format!("Cannot decode {}: {error}", path.display()))
                    .map(|img| img.to_luma8()),
                MedianLookup::Missing { searched } => {
                    Err(format!("No MEDIAN image to use as the case base image: {}", searched.join("; ")))
                }
            }
        }
    }
}

/// Generates one align case: base image -> working grid -> truth warp ->
/// degradations, persisted as `(case.json, template.png, input.png)`.
/// `truth = None` derives the transform from the seed (case = seed + params);
/// `params.downsample = 0` auto-fits the working grid to 2K.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn align_generate_case(
    app: AppHandle,
    machine: MachinePaths,
    repository_path: String,
    model_name: String,
    side: String,
    seed: u64,
    base_source: Option<String>,
    truth: Option<align::TruthTransform>,
    params: Option<align::CaseParams>,
) -> Result<AlignCaseOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_network_credentials(&machine)?;
        let (side, _, _) = median_side(&side)?;
        let base_source = base_source.as_deref().unwrap_or("median");
        let mut params = params.unwrap_or_default();

        let base = decode_case_base(&repository_path, &model_name, &side, base_source)?;
        if params.downsample == 0 {
            let long_side = base.width().max(base.height());
            params.downsample = long_side.div_ceil(ALIGN_CASE_MAX_SIDE).max(1);
        }

        let generated = align::generator::generate_case(&base, seed, truth, &params);
        drop(base);

        let mut case = align::AlignCase::new(align::generator::case_id(&model_name, &side, seed), seed, &model_name, &side);
        case.truth = generated.truth;
        case.params = params;
        case.template_path = align::generator::TEMPLATE_FILE.into();
        case.input_path = align::generator::INPUT_FILE.into();

        let library = app.path().app_data_dir().map_err(|error| error.to_string())?.join(ALIGN_CASE_LIBRARY_DIR);
        let case_dir = align::generator::save_case(&library, &case, &generated.template, &generated.input)?;

        let template = encode_case_preview(&generated.template)?;
        let input = encode_case_preview(&generated.input)?;
        Ok(AlignCaseOutcome { case, case_dir: case_dir.display().to_string(), template, input })
    })
    .await
    .map_err(|error| format!("Case generation task failed: {error}"))?
}

/// Lists the stored cases (id, seed, truth, params) sorted by id.
#[tauri::command]
async fn align_list_cases(app: AppHandle) -> Result<Vec<align::AlignCase>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.path().app_data_dir().map_err(|error| error.to_string())?.join(ALIGN_CASE_LIBRARY_DIR);
        align::generator::list_cases(&library)
    })
    .await
    .map_err(|error| format!("Case listing task failed: {error}"))?
}

/// Removes one case folder. The id must be a plain folder name - it is joined
/// onto the library root, so this is a path-traversal guard.
#[tauri::command]
async fn align_delete_case(app: AppHandle, case_id: String) -> Result<bool, String> {
    if case_id.is_empty() || case_id.contains(['\\', '/']) || case_id == ".." || case_id.contains("..") {
        return Err("Invalid case id.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.path().app_data_dir().map_err(|error| error.to_string())?.join(ALIGN_CASE_LIBRARY_DIR);
        let dir = library.join(&case_id);
        if !dir.is_dir() {
            return Ok(false);
        }
        fs::remove_dir_all(&dir).map_err(|error| format!("Cannot delete {case_id}: {error}"))?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("Case deletion task failed: {error}"))?
}

// ---- ALIGN M2: run an aligner over a stored case (Plan 05). Only paths,
// numbers and the result cross the IPC - never the images (D3). ----

/// Solver vs truth comparison, computed backend-side; the frontend keeps it
/// behind the truth-reveal gate so quiz mode can hide it.
#[derive(Serialize)]
struct TruthComparison {
    tx_error_px: f64,
    ty_error_px: f64,
    /// Euclidean translation error in px.
    total_px: f64,
    /// True only for a pure-translation truth - otherwise the residual
    /// includes the rotation/scale part that M2's phase correlator cannot see.
    translation_only: bool,
}

#[derive(Serialize)]
struct AlignRunOutcome {
    case: align::AlignCase,
    result: align::AlignResult,
    comparison: TruthComparison,
}

/// Runs an aligner over a stored case and reports the result plus the truth
/// comparison (teaching: reveal-gated on the frontend). "ecc" is the M3
/// coarse-to-fine pipeline (phase init + Gauss-Newton similarity); "phase"
/// stays available as the translation-only M2 teaching baseline.
#[tauri::command]
async fn align_run(app: AppHandle, case_id: String, aligner: Option<String>) -> Result<AlignRunOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.path().app_data_dir().map_err(|error| error.to_string())?.join(ALIGN_CASE_LIBRARY_DIR);
        let (case, template, input) = align::generator::load_case(&library, &case_id)?;
        let result = match aligner.as_deref().unwrap_or("ecc") {
            "ecc" => align::Aligner::align(&align::ecc::EccAligner::default(), &template, &input)?,
            "phase" => align::Aligner::align(&align::phase::PhaseCorrelateAligner::default(), &template, &input)?,
            other => return Err(format!("Unknown aligner '{other}' - expected 'ecc' or 'phase'.")),
        };
        // truth comparison: for a pure-translation truth this IS the
        // algorithm error; with rotation/scale the residual includes the part
        // a translation-only solver cannot see (labelled in the UI).
        let translation_only = case.truth.theta_deg == 0.0 && case.truth.scale == 1.0;
        let tx_error = result.tx_px - case.truth.tx_px;
        let ty_error = result.ty_px - case.truth.ty_px;
        Ok(AlignRunOutcome {
            case,
            comparison: TruthComparison {
                tx_error_px: tx_error,
                ty_error_px: ty_error,
                total_px: (tx_error * tx_error + ty_error * ty_error).sqrt(),
                translation_only,
            },
            result,
        })
    })
    .await
    .map_err(|error| format!("Align run task failed: {error}"))?
}

// ---- Model Copier: move a model's LIGHT_SPEC / INSPECT_SPEC / PxRepository
// folders between Vision PCs. The plan construction, delete guards and copy
// execution live in dmt-copy-core (shared with the site agent); this layer is
// just the Tauri command surface. ----

#[tauri::command]
async fn preview_model_copy(source: CopyEndpoint, target: CopyEndpoint, model_name: String, target_model_name: Option<String>) -> Result<core::CopyPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::build_copy_plan(&source, &target, &model_name, target_model_name.as_deref().unwrap_or(""))
    })
    .await
    .map_err(|error| format!("Preview task failed: {error}"))?
}

#[tauri::command]
async fn copy_model_between_hosts(source: CopyEndpoint, target: CopyEndpoint, model_name: String, target_model_name: Option<String>, confirmed: bool) -> Result<CopyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !confirmed {
            return Err("The copy was not confirmed - nothing was changed.".into());
        }
        // Re-derive the plan instead of trusting the preview: the shares may
        // have changed between preview and confirmation.
        let plan = core::build_copy_plan(&source, &target, &model_name, target_model_name.as_deref().unwrap_or(""))?;
        core::execute_copy_plan(&plan, &target, &|_| {})
    })
    .await
    .map_err(|error| format!("Copy task failed: {error}"))?
}

// ---- Site LAN agent: the same scan/copy operations, executed by a dmt-agent
// daemon inside the site's real network. Only control traffic and progress
// cross the WAN (Tailscale); the gigabit transfers never leave the site. ----

/// Health check for the "Test agent" button.
#[tauri::command]
async fn agent_ping(agent: AgentTarget) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (protocol, value) = core::call_agent(&agent, &AgentRequest::Ping, |_| {})?;
        let version = value.get("version").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        Ok(format!("Agent reachable (version {version}, protocol v{protocol})."))
    })
    .await
    .map_err(|error| format!("Agent task failed: {error}"))?
}

#[tauri::command]
async fn agent_scan_models(agent: AgentTarget, machine: MachinePaths) -> Result<Vec<ModelCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let request = AgentRequest::ScanModels { machine };
        let (_, value) = core::call_agent(&agent, &request, |_| {})?;
        serde_json::from_value(value).map_err(|error| format!("Agent returned an unexpected scan result: {error}"))
    })
    .await
    .map_err(|error| format!("Agent task failed: {error}"))?
}

/// The plan is re-derived inside the agent, so only the endpoints travel the
/// wire; per-file progress streams back through the Tauri channel. Renaming
/// needs protocol v2 - older agents would silently ignore the new name, so
/// the request is refused up front.
#[tauri::command]
async fn agent_copy_model(
    agent: AgentTarget,
    source: CopyEndpoint,
    target: CopyEndpoint,
    model_name: String,
    target_model_name: Option<String>,
    confirmed: bool,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<CopyReport, String> {
    if !confirmed {
        return Err("The copy was not confirmed - nothing was changed.".into());
    }
    let target_model_name = target_model_name.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let request = AgentRequest::Copy { source, target, model_name: model_name.clone(), target_model_name: target_model_name.clone(), confirmed };
        let (protocol, value) = core::call_agent(&agent, &request, |progress: CopyProgress| {
            if let Ok(value) = serde_json::to_value(&progress) {
                let _ = on_progress.send(value);
            }
        })?;
        if !target_model_name.trim().is_empty() && protocol < core::RENAME_MIN_PROTOCOL {
            return Err(format!(
                "The site agent speaks protocol v{protocol} but model renaming needs v{} - update dmt-agent on the site's main PC first.",
                core::RENAME_MIN_PROTOCOL
            ));
        }
        serde_json::from_value(value).map_err(|error| format!("Agent returned an unexpected copy result: {error}"))
    })
    .await
    .map_err(|error| format!("Agent task failed: {error}"))?
}

/// Cross-site copy: the SOURCE site agent reads its local Vision PC and
/// pushes the model to the TARGET site agent over QUIC (UDP). The desktop
/// only relays progress. Requires both agents to speak protocol v3.
#[tauri::command]
async fn agent_copy_cross_site(
    source_agent: AgentTarget,
    target_agent: AgentTarget,
    source: CopyEndpoint,
    target: CopyEndpoint,
    model_name: String,
    target_model_name: Option<String>,
    force_full: bool,
    confirmed: bool,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<CopyReport, String> {
    if !confirmed {
        return Err("The copy was not confirmed - nothing was changed.".into());
    }
    let target_model_name = target_model_name.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let request = AgentRequest::CopyCrossSite {
            source,
            target_agent,
            target,
            model_name: model_name.clone(),
            target_model_name: target_model_name.clone(),
            force_full,
            confirmed,
        };
        let (protocol, value) = core::call_agent(&source_agent, &request, |progress: CopyProgress| {
            if let Ok(value) = serde_json::to_value(&progress) {
                let _ = on_progress.send(value);
            }
        })?;
        if protocol < core::RELAY_MIN_PROTOCOL {
            return Err(format!(
                "The source site agent speaks protocol v{protocol} but cross-site relaying needs v{} - update dmt-agent on both sites.",
                core::RELAY_MIN_PROTOCOL
            ));
        }
        serde_json::from_value(value).map_err(|error| format!("Agent returned an unexpected copy result: {error}"))
    })
    .await
    .map_err(|error| format!("Agent task failed: {error}"))?
}

// ---- document database commands (backend selected by storage.json) ----
// These run as async commands on the worker pool: a MongoDB call is a network
// round trip (seconds when the cluster is slow) and must never occupy the main
// thread - sync commands freeze the whole UI.

async fn run_store_blocking<T, F>(app: AppHandle, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&dyn storage::DocumentStore) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let store = open_store(&app)?;
        task(store.as_ref())
    })
    .await
    .map_err(|error| format!("Storage task failed: {error}"))?
}

#[tauri::command]
async fn load_local_file(app: AppHandle, filename: String) -> Result<String, String> {
    run_store_blocking(app, move |store| {
        store
            .read(&filename)?
            .ok_or_else(|| "Document was not found in the database.".into())
    })
    .await
}

#[tauri::command]
async fn save_local_file(app: AppHandle, filename: String, content: String) -> Result<(), String> {
    run_store_blocking(app, move |store| store.write(&filename, &content)).await
}

#[tauri::command]
async fn delete_local_file(app: AppHandle, filename: String) -> Result<(), String> {
    run_store_blocking(app, move |store| store.delete(&filename)).await
}

#[tauri::command]
async fn list_local_files(app: AppHandle, prefix: String) -> Result<Vec<String>, String> {
    run_store_blocking(app, move |store| store.list(&prefix)).await
}

#[tauri::command]
fn get_storage_config(app: AppHandle) -> Result<StorageConfig, String> {
    read_storage_config(&app)
}

#[tauri::command]
fn set_storage_config(app: AppHandle, config: StorageConfig) -> Result<(), String> {
    match config.backend.as_str() {
        "local" | "mongodb" | "firestore" => {
            persist_storage_config(&app, &config)?;
            // the cached store still points at the previous backend
            let cache = app.state::<StoreCache>();
            *cache.0.lock().map_err(|_| "Store cache is poisoned".to_string())? = None;
            Ok(())
        }
        _ => Err("Backend must be \"local\", \"mongodb\" or \"firestore\".".into()),
    }
}

#[tauri::command]
async fn test_mongo_connection(app: AppHandle, url: Option<String>, database: Option<String>) -> Result<String, String> {
    let (url, database) = resolve_mongo_target(&app, url, database)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = storage::MongoDocumentStore::new(&url, &database)?;
        let count = store.count_documents()?;
        Ok(format!("Connected to '{database}'. The collection currently holds {count} documents."))
    })
    .await
    .map_err(|error| format!("Connection task failed: {error}"))?
}

#[tauri::command]
async fn migrate_local_to_mongo(app: AppHandle, url: Option<String>, database: Option<String>) -> Result<MigrationReport, String> {
    let (url, database) = resolve_mongo_target(&app, url, database)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let local = storage::JsonFileStore::new(root);
        let mongo = storage::MongoDocumentStore::new(&url, &database)?;
        migrate_store(&local, &mongo)
    })
    .await
    .map_err(|error| format!("Migration task failed: {error}"))?
}

/// Stored MongoDB settings, overridable per-call (the Settings UI passes the
/// form fields so they can be tested before being saved).
fn resolve_mongo_target(app: &AppHandle, url: Option<String>, database: Option<String>) -> Result<(String, String), String> {
    let config = read_storage_config(app)?;
    let settings = config.mongodb.unwrap_or_default();
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()).unwrap_or(settings.url);
    let database = database.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).unwrap_or(settings.database);
    if url.is_empty() {
        return Err("No MongoDB connection string is configured.".into());
    }
    if database.is_empty() {
        return Err("No MongoDB database name is configured.".into());
    }
    Ok((url, database))
}

// ---- Firestore (Firebase): the project and its web API key are hardcoded in
// storage.rs, so unlike MongoDB these commands take no settings arguments. ----

#[tauri::command]
async fn test_firestore_connection() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = storage::FirestoreStore::new(
            storage::FIRESTORE_PROJECT_ID,
            storage::FIRESTORE_DATABASE_ID,
            storage::FIRESTORE_API_KEY,
        )?;
        let count = store.count_documents()?;
        Ok(format!(
            "Connected to project '{}'. The 'documents' collection currently holds {} documents.",
            storage::FIRESTORE_PROJECT_ID,
            count
        ))
    })
    .await
    .map_err(|error| format!("Connection task failed: {error}"))?
}

#[tauri::command]
async fn migrate_local_to_firestore(app: AppHandle) -> Result<MigrationReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let local = storage::JsonFileStore::new(root);
        let firestore = storage::FirestoreStore::new(
            storage::FIRESTORE_PROJECT_ID,
            storage::FIRESTORE_DATABASE_ID,
            storage::FIRESTORE_API_KEY,
        )?;
        migrate_store(&local, &firestore)
    })
    .await
    .map_err(|error| format!("Migration task failed: {error}"))?
}

/// Fill the blank Parameter_Template.xlsx with the stored model's values and
/// save it as `<machine>_<model>.xlsx` under the configured export path.
#[tauri::command]
async fn export_parameter_excel(
    app: AppHandle,
    machine_id: String,
    model_name: String,
    machine_name: String,
    export_path: String,
    template_path: String,
) -> Result<export_excel::ExportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = open_store(&app)?;
        let model_key = model_name.trim().to_ascii_uppercase().trim_end_matches("-00").to_string();
        // the record may live under another machine id (the machine was re-added
        // after an update and got a new id) - fall back to a by-name search
        let exact_key = format!("models/{machine_id}/{model_key}.json");
        let (record_json, record_key) = match store.read(&exact_key)? {
            Some(json) => (json, exact_key),
            None => {
                let suffix = format!("/{model_key}.json");
                let found = store
                    .list("models/")?
                    .into_iter()
                    .find(|key| key.to_ascii_uppercase().ends_with(&suffix.to_ascii_uppercase()))
                    .ok_or_else(|| format!("No stored data for {model_name} - collect the model first."))?;
                let json = store.read(&found)?.unwrap_or_default();
                (json, found)
            }
        };
        let machine_folder = record_key.split('/').nth(1).unwrap_or(machine_id.as_str()).to_string();
        let gv_json = store
            .read(&format!("ui/gv/{machine_folder}/{model_key}.json"))?
            .unwrap_or_else(|| "{}".to_string());
        let template_bytes = fs::read(template_path.trim())
            .map_err(|error| format!("Cannot read the template workbook: {error}"))?;
        export_excel::run_export(export_excel::ExportArgs {
            record_json: &record_json,
            gv_json: &gv_json,
            template_bytes: &template_bytes,
            export_path: export_path.trim(),
            machine_name: &machine_name,
        })
    })
    .await
    .map_err(|error| format!("Export task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_machine_models,
            collect_machine_sources,
            load_median_image,
        align_probe_sources,
        align_load_pattern,
        align_load_overlay,
        align_generate_case,
        align_list_cases,
        align_delete_case,
        align_run,
            preview_model_copy,
            copy_model_between_hosts,
            agent_ping,
            agent_scan_models,
            agent_copy_model,
            agent_copy_cross_site,
            load_local_file,
            save_local_file,
            delete_local_file,
            list_local_files,
            get_storage_config,
            set_storage_config,
            test_mongo_connection,
            migrate_local_to_mongo,
            test_firestore_connection,
            migrate_local_to_firestore,
            export_parameter_excel
        ])
        .setup(|app| {
            app.manage(StoreCache(std::sync::Mutex::new(None)));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod median_tests {
    use super::*;
    use std::env;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("afvi_median_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a real (4x2, 8-bit gray) tif at
    /// `<root>\PxRepository\<model>\<version>\Line\<side_dir>\Layer\MEDIAN\Median_0_1_0.tif`.
    fn write_median(root: &Path, model: &str, version: &str, side_dir: &str) {
        let tif = root
            .join("PxRepository")
            .join(model)
            .join(version)
            .join("Line")
            .join(side_dir)
            .join("Layer")
            .join("MEDIAN")
            .join(MEDIAN_FILE);
        fs::create_dir_all(tif.parent().unwrap()).unwrap();
        let mut bytes = Vec::new();
        image::DynamicImage::new_luma8(4, 2)
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Tiff)
            .unwrap();
        fs::write(tif, bytes).unwrap();
    }

    fn assert_found(result: Result<MedianLookup, String>, expected_version: &str) {
        match result.unwrap() {
            MedianLookup::Found { path, version } => {
                assert!(path.is_file(), "{path:?} should exist");
                assert_eq!(version, expected_version);
            }
            MedianLookup::Missing { searched } => panic!("expected Found, got Missing ({searched:?})"),
        }
    }

    fn assert_missing(result: Result<MedianLookup, String>) {
        match result.unwrap() {
            MedianLookup::Found { path, .. } => panic!("expected Missing, found {path:?}"),
            MedianLookup::Missing { .. } => {}
        }
    }

    #[test]
    fn exact_version_folder_wins_for_top() {
        let root = temp_dir("exact");
        for version in ["1.9", "2.0", "2.1"] {
            write_median(&root, "6AN0921", version, "Top");
        }
        let result = resolve_median_tif(root.to_str().unwrap(), "6AN0921", "TOP");
        assert_found(result, "2.0");
    }

    #[test]
    fn any_sibling_version_is_a_fallback_and_bottom_maps_to_bottom_folder() {
        let root = temp_dir("fallback");
        // BM's plan version is 3.5; only 3.4 exists, so the 3.4 folder must win
        write_median(&root, "6AN0921", "3.4", "Bottom");
        let result = resolve_median_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM");
        match result.unwrap() {
            MedianLookup::Found { version, .. } => assert_eq!(version, "3.4"),
            MedianLookup::Missing { .. } => panic!("expected the 3.4 fallback"),
        }
    }

    #[test]
    fn side_folders_do_not_leak_into_the_other_side() {
        let root = temp_dir("sides");
        write_median(&root, "6AN0921", "2.0", "Top");
        assert_missing(resolve_median_tif(root.to_str().unwrap(), "6AN0921", "BOTTOM"));
    }

    #[test]
    fn missing_model_is_missing_not_an_error() {
        let root = temp_dir("nomodel");
        let result = resolve_median_tif(root.to_str().unwrap(), "NOSUCH", "TOP").unwrap();
        assert!(matches!(result, MedianLookup::Missing { ref searched } if !searched.is_empty()), "{result:?}");
    }

    #[test]
    fn model_directly_under_the_share_root_is_found() {
        let root = temp_dir("flat");
        let tif = root.join("6AN0921").join("2.0").join("Line").join("Top").join("Layer").join("MEDIAN").join(MEDIAN_FILE);
        fs::create_dir_all(tif.parent().unwrap()).unwrap();
        fs::write(tif, b"not a real tif - resolution only checks existence").unwrap();
        let result = resolve_median_tif(root.to_str().unwrap(), "6AN0921", "TOP");
        assert_found(result, "2.0");
    }

    #[test]
    fn unreadable_share_root_is_a_hard_error() {
        let missing = temp_dir("gone").join("no_such_share");
        let error = resolve_median_tif(missing.to_str().unwrap(), "6AN0921", "TOP").unwrap_err();
        assert!(error.contains("Cannot reach"), "{error}");
    }

    #[test]
    fn empty_repository_path_names_the_host() {
        let error = resolve_median_tif("  ", "6AN0921", "BOTTOM").unwrap_err();
        assert!(error.contains("BM"), "{error}");
    }

    #[test]
    fn median_preview_is_downscaled_to_the_cap() {
        let root = temp_dir("preview");
        let model = root.join("6AN0921");
        let tif_path = model.join("2.0").join("Line").join("Top").join("Layer").join("MEDIAN").join(MEDIAN_FILE);
        fs::create_dir_all(tif_path.parent().unwrap()).unwrap();
        // 8192x48 halves exactly to 4096x24
        let mut bytes = Vec::new();
        image::DynamicImage::new_luma8(8192, 48)
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Tiff)
            .unwrap();
        fs::write(&tif_path, bytes).unwrap();

        let image = decode_median_preview(&tif_path, "TOP", "FM1", "2.0".to_string()).unwrap();
        assert_eq!(image.width, 8192);
        assert_eq!(image.height, 48);
        let bytes = base64::engine::general_purpose::STANDARD.decode(&image.data).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), 4096);
        assert_eq!(decoded.height(), 24);
    }
}

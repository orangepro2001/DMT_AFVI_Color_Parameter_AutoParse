//! Model Copier domain logic: plan construction, delete guards and the actual
//! copy execution. Moved from the desktop app's lib.rs; `copy_dir_recursive`
//! became a worker-pool parallel copy and `execute_copy_plan` extracted the
//! command-layer copy loop so the agent can run the exact same semantics.

use crate::canonical_model_name;
use crate::credentials::ensure_unc_credentials;
use crate::find_model_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct CopyEndpoint {
    pub host: String,
    pub inventory_path: String,
    #[serde(default)]
    pub repository_path: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopyPlanEntry {
    /// Which spec root the folder lives in ("LIGHT_SPEC", "INSPECT_SPEC" or "PxRepository").
    pub kind: String,
    pub source: Option<String>,
    pub target: String,
    pub exists_on_target: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopyPlan {
    pub model_name: String,
    /// Canonical name the model gets on the target side. Equals `model_name`
    /// unless the copy renames the model (same PCB design re-registered under
    /// a new model number - the folder is the only place the name lives, the
    /// spec XMLs never embed it).
    #[serde(default)]
    pub target_model_name: String,
    pub entries: Vec<CopyPlanEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopyResultEntry {
    pub kind: String,
    pub target: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopyReport {
    pub model_name: String,
    pub entries: Vec<CopyResultEntry>,
}

/// Per-file copy progress, streamed to the UI (desktop) or the socket (agent).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopyProgress {
    pub kind: String,
    /// Source path of the file just copied (empty on the initial total-count line).
    pub file: String,
    pub files_done: u32,
    pub files_total: u32,
    pub bytes_done: u64,
    /// Which data plane produced this progress ("quic" | "tcp" | ""). The UI
    /// shows the active tier of the fallback chain. Default keeps old JSON
    /// (agent→desktop, desktop→UI) compatible.
    #[serde(default)]
    pub relay_mode: String,
}

/// How many files are copied concurrently. On gigabit LAN the per-file SMB
/// round trips overlap, so a small pool keeps the pipe saturated.
const COPY_WORKERS: usize = 8;

const SPEC_ROOTS: [&str; 2] = ["LIGHT_SPEC", "INSPECT_SPEC"];

fn endpoint_credentials(endpoint: &CopyEndpoint) -> Result<(), String> {
    ensure_unc_credentials(
        &[&endpoint.inventory_path, &endpoint.repository_path],
        &endpoint.username,
        &endpoint.password,
    )
}

/// Resolve the three folders a model occupies on one endpoint. Missing folders
/// are simply absent from the plan - e.g. a repository share with no folder for
/// this model, or an endpoint without a configured PxRepository share at all.
pub fn endpoint_model_folders(endpoint: &CopyEndpoint, model_name: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let mut found = Vec::new();
    for root in SPEC_ROOTS {
        let base = Path::new(&endpoint.inventory_path).join(root);
        if let Ok(dir) = find_model_dir(&base, model_name) {
            found.push((root.to_string(), dir));
        }
    }
    let repository = endpoint.repository_path.trim();
    if !repository.is_empty() {
        if let Ok(dir) = find_model_dir(Path::new(repository), model_name) {
            found.push(("PxRepository".to_string(), dir));
        }
    }
    Ok(found)
}

/// The target path for a copied folder. `name` is kept verbatim from the source
/// (e.g. `2AN0859F01`, `2AN0859F01-00`) so the machine sees identical folder names.
pub fn target_folder_path(endpoint: &CopyEndpoint, kind: &str, name: &str) -> PathBuf {
    if kind == "PxRepository" {
        Path::new(&endpoint.repository_path).join(name)
    } else {
        Path::new(&endpoint.inventory_path).join(kind).join(name)
    }
}

/// Hard guard before any delete: the path must be exactly one model folder
/// directly under the endpoint's spec root (or repository root), matching the
/// requested model. This is what makes it impossible to wipe the whole
/// LIGHT_SPEC/INSPECT_SPEC parent or an unrelated model.
pub fn assert_deletable(path: &Path, endpoint: &CopyEndpoint, kind: &str, model_name: &str) -> Result<(), String> {
    let expected_parent = if kind == "PxRepository" {
        PathBuf::from(endpoint.repository_path.trim())
    } else {
        Path::new(&endpoint.inventory_path).join(kind)
    };
    if path.parent() != Some(expected_parent.as_path()) {
        return Err(format!("Refusing to touch {}: not a model folder directly under {}", path.display(), expected_parent.display()));
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if canonical_model_name(&name) != canonical_model_name(model_name) {
        return Err(format!("Refusing to touch {}: does not match model {model_name}", path.display()));
    }
    Ok(())
}

pub fn build_copy_plan(source: &CopyEndpoint, target: &CopyEndpoint, model_name: &str, target_model_name: &str) -> Result<CopyPlan, String> {
    let model = canonical_model_name(model_name);
    if model.is_empty() {
        return Err("A model name is required.".into());
    }
    // A rename turns the copy into a clone: the model is registered on the
    // target under a new number. The name must stay a plain folder name -
    // it becomes part of every target path.
    let target_name = canonical_model_name(if target_model_name.trim().is_empty() { model_name } else { target_model_name });
    if !target_model_name.trim().is_empty() {
        if target_name.is_empty() {
            return Err("The target model name must not be empty.".into());
        }
        if !target_name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) || target_name.starts_with('.') {
            return Err(format!("The target model name may only contain letters, digits, - _ . (got \"{target_name}\")."));
        }
    }

    let same_inventory = source.inventory_path.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(target.inventory_path.trim_end_matches(['\\', '/']));
    if same_inventory && target_name == model {
        return Err(format!("Source and target Vision PC are the same ({}/{}) - a copy needs a new model name to clone in place.", source.host, target.host));
    }
    endpoint_credentials(source)?;
    endpoint_credentials(target)?;

    let source_folders = endpoint_model_folders(source, &model)?;
    if source_folders.is_empty() {
        return Err(format!("Model {model} was not found on {} ({}) - nothing to copy.", source.host, source.inventory_path));
    }
    let target_folders = endpoint_model_folders(target, &target_name)?;

    let mut entries = Vec::new();
    for (kind, source_dir) in &source_folders {
        // the folder is named after the TARGET model: this is what makes the
        // machine treat the copied model as the new number
        let target_path = target_folder_path(target, kind, &target_name);
        entries.push(CopyPlanEntry {
            kind: kind.clone(),
            source: Some(source_dir.display().to_string()),
            target: target_path.display().to_string(),
            exists_on_target: target_folders.iter().any(|(k, _)| k == kind),
        });
    }
    // Kinds present on the target but not the source still get deleted on copy
    // (e.g. the source has no repository share configured) so the target ends
    // up with exactly the source's model - but only if the target knows the model.
    for (kind, target_dir) in &target_folders {
        if !source_folders.iter().any(|(k, _)| k == kind) {
            entries.push(CopyPlanEntry {
                kind: kind.clone(),
                source: None,
                target: target_dir.display().to_string(),
                exists_on_target: true,
            });
        }
    }
    Ok(CopyPlan { model_name: model, target_model_name: target_name.clone(), entries })
}

/// Execute a copy plan against the target endpoint with delete-then-copy
/// semantics, stopping at the first failure (what was already copied stays and
/// the report tells the operator exactly where it broke off). `progress` fires
/// once per copied file.
pub fn execute_copy_plan(plan: &CopyPlan, target: &CopyEndpoint, progress: &(dyn Fn(CopyProgress) + Send + Sync)) -> Result<CopyReport, String> {
    // the delete guard must match the TARGET folder names (a renamed copy
    // creates different folders than it reads)
    let target_name = if plan.target_model_name.is_empty() { &plan.model_name } else { &plan.target_model_name };
    let mut report = CopyReport { model_name: plan.model_name.clone(), entries: Vec::new() };
    for entry in &plan.entries {
        let target_path = PathBuf::from(&entry.target);
        let result = (|| -> Result<(), String> {
            assert_deletable(&target_path, target, &entry.kind, target_name)?;
            if target_path.exists() {
                fs::remove_dir_all(&target_path).map_err(|error| format!("Cannot delete {}: {error}", target_path.display()))?;
            }
            if let Some(source_dir) = &entry.source {
                copy_dir_parallel(Path::new(source_dir), &target_path, &entry.kind, progress)?;
            }
            Ok(())
        })();
        let ok = result.is_ok();
        report.entries.push(CopyResultEntry {
            kind: entry.kind.clone(),
            target: entry.target.clone(),
            ok,
            error: result.err(),
        });
        if !ok {
            break;
        }
    }
    Ok(report)
}

struct FileJob {
    source: PathBuf,
    target: PathBuf,
}

fn collect_files(src: &Path, dst: &Path, jobs: &mut Vec<FileJob>) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| format!("Cannot create {}: {error}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|error| format!("Cannot read {}: {error}", src.display()))? {
        let entry = entry.map_err(|error| format!("Cannot read {}: {error}", src.display()))?;
        let to = dst.join(entry.file_name());
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            collect_files(&entry.path(), &to, jobs)?;
        } else {
            jobs.push(FileJob { source: entry.path(), target: to });
        }
    }
    Ok(())
}

/// Recursive directory copy with a small worker pool. The tree (directories
/// included) is walked first so the progress callback knows the total file
/// count, then the files are copied `COPY_WORKERS` at a time. First error
/// stops the pool; the error message matches the old sequential copy.
///
/// Files are copied in chunks with intra-file progress (throttled to ~400ms)
/// instead of `fs::copy`: a single multi-gigabyte inspection image can take
/// many minutes, and without heartbeat traffic the desktop's control-socket
/// read timeout would fire mid-file and tear the whole copy down.
pub fn copy_dir_parallel(src: &Path, dst: &Path, kind: &str, progress: &(dyn Fn(CopyProgress) + Send + Sync)) -> Result<(), String> {
    let mut jobs = Vec::new();
    collect_files(src, dst, &mut jobs)?;
    let total = jobs.len();
    progress(CopyProgress { kind: kind.to_string(), file: String::new(), files_done: 0, files_total: total as u32, bytes_done: 0, relay_mode: String::new() });
    if total == 0 {
        return Ok(());
    }

    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let bytes = AtomicU64::new(0);
    let first_error: Mutex<Option<String>> = Mutex::new(None);
    let last_report_ms = AtomicU64::new(0);
    let start = Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..COPY_WORKERS.min(total) {
            scope.spawn(|| loop {
                if first_error.lock().unwrap().is_some() {
                    return;
                }
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= total {
                    return;
                }
                let job = &jobs[index];
                match copy_file_progressive(&job.source, &job.target, &bytes, &last_report_ms, start, kind, &done, total, progress) {
                    Ok(()) => {
                        // the byte count was already accumulated chunk-wise by
                        // copy_file_progressive - only the file counter moves here
                        let files_done = done.fetch_add(1, Ordering::Relaxed) + 1;
                        let bytes_done = bytes.load(Ordering::Relaxed);
                        progress(CopyProgress {
                            kind: kind.to_string(),
                            file: job.source.display().to_string(),
                            files_done: files_done as u32,
                            files_total: total as u32,
                            bytes_done,
                            relay_mode: String::new(),
                        });
                    }
                    Err(error) => {
                        let mut guard = first_error.lock().unwrap();
                        if guard.is_none() {
                            *guard = Some(format!("Cannot copy {}: {error}", job.source.display()));
                        }
                    }
                }
            });
        }
    });
    match first_error.into_inner().unwrap() {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Copy one file in chunks, accumulating the byte count in the shared atomic
/// and emitting throttled intra-file progress. Preserves the source's
/// modification time (what `fs::copy` does via CopyFileEx on Windows) so
/// incremental flows keep matching.
fn copy_file_progressive(
    source: &Path,
    target: &Path,
    bytes: &AtomicU64,
    last_report_ms: &AtomicU64,
    start: Instant,
    kind: &str,
    done: &AtomicUsize,
    total: usize,
    progress: &(dyn Fn(CopyProgress) + Send + Sync),
) -> Result<(), String> {
    const CHUNK: usize = 1024 * 1024;
    const REPORT_EVERY_MS: u64 = 400;

    let mut input = fs::File::open(source).map_err(|error| format!("Cannot read {source:?}: {error}"))?;
    let metadata = input.metadata().map_err(|error| format!("Cannot stat {source:?}: {error}"))?;
    let mut output = fs::File::create(target).map_err(|error| format!("Cannot create {target:?}: {error}"))?;
    let mut buffer = vec![0u8; CHUNK];
    loop {
        let chunk = input.read(&mut buffer).map_err(|error| format!("Cannot read {source:?}: {error}"))?;
        if chunk == 0 {
            break;
        }
        output.write_all(&buffer[..chunk]).map_err(|error| format!("Cannot write {target:?}: {error}"))?;
        bytes.fetch_add(chunk as u64, Ordering::Relaxed);
        // throttled heartbeat: keeps the desktop's control connection alive
        // while one huge file is still in flight
        let now_ms = start.elapsed().as_millis() as u64;
        let last = last_report_ms.load(Ordering::Relaxed);
        if now_ms.saturating_sub(last) >= REPORT_EVERY_MS && last_report_ms.compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
            progress(CopyProgress {
                kind: kind.to_string(),
                file: source.display().to_string(),
                files_done: done.load(Ordering::Relaxed) as u32,
                files_total: total as u32,
                bytes_done: bytes.load(Ordering::Relaxed),
                relay_mode: String::new(),
            });
        }
    }
    output.flush().map_err(|error| format!("Cannot flush {target:?}: {error}"))?;
    drop(output);
    drop(input);
    let mtime = filetime::FileTime::from_last_modification_time(&metadata);
    filetime::set_file_times(target, mtime, mtime).map_err(|error| format!("Cannot set mtime on {target:?}: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("afvi_copier_test_{}_{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn endpoint(inventory: &Path, repository: &Path, host: &str) -> CopyEndpoint {
        CopyEndpoint {
            host: host.into(),
            inventory_path: inventory.display().to_string(),
            repository_path: repository.display().to_string(),
            username: String::new(),
            password: String::new(),
        }
    }

    fn write_model(inventory: &Path, repository: Option<&Path>, folder_light: &str, folder_inspect: &str, model_file: &str) {
        let light = inventory.join("LIGHT_SPEC").join(folder_light);
        let inspect = inventory.join("INSPECT_SPEC").join(folder_inspect).join("TOP").join("LIGHT0");
        fs::create_dir_all(&light).unwrap();
        fs::create_dir_all(&inspect).unwrap();
        fs::write(light.join("LightSpec.xml"), format!("<light name='{model_file}'/>")).unwrap();
        fs::write(inspect.join("InspectionSpec.xml"), format!("<inspect name='{model_file}'/>")).unwrap();
        if let Some(repo) = repository {
            let dir = repo.join(folder_light);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("gerber.gbr"), model_file).unwrap();
        }
    }

    fn noop_progress(_: CopyProgress) {}

    #[test]
    fn copy_plan_matches_model_folders_case_insensitively() {
        let base = temp_dir("plan");
        let source_inv = base.join("src_inv");
        let source_repo = base.join("src_repo");
        let target_inv = base.join("dst_inv");
        let target_repo = base.join("dst_repo");
        write_model(&source_inv, Some(&source_repo), "2AN0859F01", "2AN0859F01-00", "src");
        write_model(&target_inv, Some(&target_repo), "2an0859f01", "2AN0859F01-00", "old");

        let source = endpoint(&source_inv, &source_repo, "FM1");
        let target = endpoint(&target_inv, &target_repo, "FM2");
        let plan = build_copy_plan(&source, &target, "2AN0859F01", "").unwrap();

        assert_eq!(plan.model_name, "2AN0859F01");
        assert_eq!(plan.target_model_name, "2AN0859F01");
        let kinds: Vec<&str> = plan.entries.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["LIGHT_SPEC", "INSPECT_SPEC", "PxRepository"]);
        let light = &plan.entries[0];
        // the source folder name is carried over verbatim (no rename)
        assert!(light.target.ends_with("\\LIGHT_SPEC\\2AN0859F01"), "{}", light.target);
        assert!(light.exists_on_target);
    }

    #[test]
    fn copy_plan_rejects_same_inventory_and_unknown_model() {
        let base = temp_dir("reject");
        let inv = base.join("inv");
        let repo = base.join("repo");
        write_model(&inv, None, "M01", "M01-00", "x");
        let a = endpoint(&inv, &repo, "FM1");
        let b = endpoint(&inv, &repo, "FM2");

        let same = build_copy_plan(&a, &b, "M01", "").unwrap_err();
        assert!(same.contains("same"), "{same}");

        let other = endpoint(&base.join("other_inv"), &base.join("other_repo"), "FM2");
        let missing = build_copy_plan(&a, &other, "NOPE", "").unwrap_err();
        assert!(missing.contains("not found"), "{missing}");
    }

    #[test]
    fn rename_copy_retargets_folders_and_clones_in_place() {
        let base = temp_dir("rename");
        let source_inv = base.join("src_inv");
        let source_repo = base.join("src_repo");
        write_model(&source_inv, Some(&source_repo), "2AN0859F01", "2AN0859F01-00", "design-a");

        let source = endpoint(&source_inv, &source_repo, "FM1");
        // rename across machines: every target folder carries the new number
        let other_inv = base.join("other_inv");
        let other_repo = base.join("other_repo");
        let target = endpoint(&other_inv, &other_repo, "FM2");
        let plan = build_copy_plan(&source, &target, "2AN0859F01", "2an0860f01-00").unwrap();
        assert_eq!(plan.target_model_name, "2AN0860F01", "target name is canonicalized");
        assert!(plan.entries.iter().all(|entry| entry.target.contains("\\2AN0860F01")), "{plan:?}");
        assert!(plan.entries.iter().all(|entry| entry.source.as_ref().unwrap().contains("2AN0859F01")));

        // executing the plan produces the renamed folders and leaves the
        // source untouched
        let report = execute_copy_plan(&plan, &target, &noop_progress).unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(other_inv.join("LIGHT_SPEC").join("2AN0860F01").join("LightSpec.xml").exists());
        assert!(other_repo.join("2AN0860F01").join("gerber.gbr").exists());
        assert!(!other_inv.join("LIGHT_SPEC").join("2AN0859F01").exists(), "no folder under the source name");

        // rename on the SAME vision pc = in-place clone, allowed; without a
        // rename it stays rejected
        let clone = build_copy_plan(&source, &source, "2AN0859F01", "2AN0860F01").unwrap();
        assert_eq!(clone.target_model_name, "2AN0860F01");
        let same_rejected = build_copy_plan(&source, &source, "2AN0859F01", "").unwrap_err();
        assert!(same_rejected.contains("same"), "{same_rejected}");

        // a folder under the SOURCE name on the target must never be touched
        // by a rename copy's delete guard
        let guard_dir = other_inv.join("LIGHT_SPEC").join("2AN0859F01");
        fs::create_dir_all(&guard_dir).unwrap();
        let renamed_plan = build_copy_plan(&source, &target, "2AN0859F01", "2AN0860F01").unwrap();
        let report = execute_copy_plan(&renamed_plan, &target, &noop_progress).unwrap();
        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(guard_dir.exists(), "source-named folder survives a rename copy");

        // dangerous names are rejected before anything is touched
        assert!(build_copy_plan(&source, &target, "2AN0859F01", "..\\EVIL").is_err(), "path traversal must be rejected");
        assert!(build_copy_plan(&source, &target, "2AN0859F01", "a/b").is_err(), "path separators must be rejected");
        let empty = build_copy_plan(&source, &target, "2AN0859F01", "-00").unwrap_err();
        assert!(empty.contains("must not be empty"), "{empty}");
    }

    #[test]
    fn executed_copy_replaces_target_folders_and_keeps_source_names() {
        let base = temp_dir("exec");
        let source_inv = base.join("src_inv");
        let source_repo = base.join("src_repo");
        let target_inv = base.join("dst_inv");
        let target_repo = base.join("dst_repo");
        write_model(&source_inv, Some(&source_repo), "2AN0859F01", "2AN0859F01-00", "new");
        write_model(&target_inv, Some(&target_repo), "2AN0859F01", "2AN0859F01-00", "old");

        let source = endpoint(&source_inv, &source_repo, "FM1");
        let target = endpoint(&target_inv, &target_repo, "FM2");
        let plan = build_copy_plan(&source, &target, "2AN0859F01", "").unwrap();
        let report = execute_copy_plan(&plan, &target, &noop_progress).unwrap();

        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        let copied = fs::read_to_string(target_inv.join("LIGHT_SPEC").join("2AN0859F01").join("LightSpec.xml")).unwrap();
        assert!(copied.contains("new"), "{copied}");
        let repo = fs::read_to_string(target_repo.join("2AN0859F01").join("gerber.gbr")).unwrap();
        assert_eq!(repo, "new");
    }

    #[test]
    fn delete_guard_blocks_everything_outside_the_model_folder() {
        let base = temp_dir("guard");
        let inv = base.join("inv");
        let repo = base.join("repo");
        let endpoint = endpoint(&inv, &repo, "FM1");

        // the spec parent itself must never pass
        let parent = inv.join("LIGHT_SPEC");
        assert!(assert_deletable(&parent, &endpoint, "LIGHT_SPEC", "M01").is_err());
        // a sibling model must never pass
        let sibling = inv.join("LIGHT_SPEC").join("OTHER01");
        assert!(assert_deletable(&sibling, &endpoint, "LIGHT_SPEC", "M01").is_err());
        // a folder outside the spec root must never pass
        let stray = inv.join("M01");
        assert!(assert_deletable(&stray, &endpoint, "LIGHT_SPEC", "M01").is_err());
        // the correct model folder passes
        let ok = inv.join("LIGHT_SPEC").join("M01-00");
        assert!(assert_deletable(&ok, &endpoint, "LIGHT_SPEC", "M01").is_ok());
    }

    #[test]
    fn unconfirmed_copy_changes_nothing() {
        let base = temp_dir("unconfirmed");
        let source_inv = base.join("src_inv");
        let target_inv = base.join("dst_inv");
        write_model(&source_inv, None, "M01", "M01-00", "x");
        let source = endpoint(&source_inv, &base.join("src_repo"), "FM1");
        let target = endpoint(&target_inv, &base.join("dst_repo"), "FM2");
        // build_copy_plan itself runs, but the command/agent layer refuses without
        // `confirmed`; that refusal is checked before any filesystem work.
        assert!(build_copy_plan(&source, &target, "M01", "").is_ok());
        assert!(!target_inv.join("LIGHT_SPEC").exists());
    }

    #[test]
    fn parallel_copy_reports_progress_totals() {
        let base = temp_dir("progress");
        let src = base.join("src");
        let dst = base.join("dst");
        for i in 0..25 {
            let folder = src.join(format!("batch{}", i % 3));
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join(format!("file{i}.bin")), vec![0u8; 100 + i]).unwrap();
        }
        let lines = Mutex::new(Vec::new());
        copy_dir_parallel(&src, &dst, "PxRepository", &|progress| lines.lock().unwrap().push(progress)).unwrap();

        let lines = lines.into_inner().unwrap();
        assert_eq!(lines[0].files_total, 25);
        assert!(lines[0].file.is_empty(), "first line announces the total");
        let last = lines.last().unwrap();
        assert_eq!(last.files_done, 25);
        assert_eq!(last.bytes_done, (100..125).sum::<u32>() as u64);
        assert_eq!(fs::read_dir(&dst).unwrap().count(), 3, "directory tree recreated");
    }
}

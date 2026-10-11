//! Shared staging swap-in for cross-site transfers: the delete guards, the
//! reconcile of kinds the target has but the source didn't, and the final
//! atomic rename into place. Extracted from the QUIC relay's `finalize` so the
//! FTS data plane (`dmt-agent`'s fts module) applies the exact same safety
//! rules with one implementation.

use crate::copier::{assert_deletable, endpoint_model_folders, CopyEndpoint, CopyReport, CopyResultEntry};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// One kind's staged folder on the target site, ready to swap into place.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StagedFolder {
    pub kind: String,
    /// The staging root reserved for this kind (e.g. `...\.dmt_stage_fts_x`).
    /// The QUIC relay stages the model folder DIRECTLY in here and consumes it
    /// with the rename; FTS receives `<staging_dir>/<source folder name>`, so
    /// its staging root needs a best-effort cleanup afterwards.
    pub stage_dir: String,
    /// The staged folder that moves onto `final_dir` (may equal `stage_dir`).
    pub staged_model_dir: String,
    /// Where the folder ends up on the target Vision PC.
    pub final_dir: String,
}

impl StagedFolder {
    pub fn consumed_by_rename(stage_dir: &Path, kind: &str, final_dir: &Path) -> StagedFolder {
        StagedFolder {
            kind: kind.to_string(),
            stage_dir: stage_dir.display().to_string(),
            staged_model_dir: stage_dir.display().to_string(),
            final_dir: final_dir.display().to_string(),
        }
    }
}

fn remove_dir_best_effort(path: &str) {
    let _ = std::fs::remove_dir_all(Path::new(path));
}

/// Swap the staged folders into place with the same delete guards as a
/// single-site copy, then reconcile kinds the target has but the source
/// didn't. On any error the not-yet-swapped staging roots are removed
/// best-effort; the 2h stale-staging sweep is the safety net for hard crashes.
pub fn finalize_staged_folders(
    folders: Vec<StagedFolder>,
    endpoint: &CopyEndpoint,
    source_model: &str,
    target_model: &str,
    manifest_kinds: &[String],
) -> Result<CopyReport, String> {
    for folder in &folders {
        assert_deletable(Path::new(&folder.final_dir), endpoint, &folder.kind, target_model)?;
    }
    // kinds present on the target under the new name but absent from the
    // manifest are deleted, exactly like the single-site plan does
    for (kind, dir) in endpoint_model_folders(endpoint, target_model).unwrap_or_default() {
        if !manifest_kinds.contains(&kind) {
            assert_deletable(&dir, endpoint, &kind, target_model)?;
            std::fs::remove_dir_all(&dir).map_err(|error| format!("Cannot delete {}: {error}", dir.display()))?;
        }
    }
    let mut entries = Vec::new();
    let mut remaining = folders.clone();
    for folder in &folders {
        let staged = PathBuf::from(&folder.staged_model_dir);
        let final_dir = PathBuf::from(&folder.final_dir);
        let outcome = (|| -> Result<(), String> {
            if final_dir.exists() {
                std::fs::remove_dir_all(&final_dir).map_err(|error| format!("Cannot delete {}: {error}", final_dir.display()))?;
            }
            // Windows rename needs the destination parent to exist (a fresh
            // PxInventory may not even have LIGHT_SPEC yet)
            if let Some(parent) = final_dir.parent() {
                std::fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
            }
            std::fs::rename(&staged, &final_dir)
                .map_err(|error| format!("Cannot move staged {} into place: {error}", final_dir.display()))
        })();
        if let Err(message) = outcome {
            for left in &remaining {
                remove_dir_best_effort(&left.stage_dir);
            }
            return Err(message);
        }
        remaining.retain(|left| left.staged_model_dir != folder.staged_model_dir);
        entries.push(CopyResultEntry { kind: folder.kind.clone(), target: folder.final_dir.clone(), ok: true, error: None });
    }
    // FTS-style staging roots survive the rename - clear them best-effort
    for folder in &folders {
        if folder.stage_dir != folder.staged_model_dir {
            remove_dir_best_effort(&folder.stage_dir);
        }
    }
    Ok(CopyReport { model_name: source_model.to_string(), entries })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copier::target_folder_path;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("afvi_finalize_test_{}_{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn endpoint(inventory: &Path, repository: &Path) -> CopyEndpoint {
        CopyEndpoint {
            host: "FM2".into(),
            inventory_path: inventory.display().to_string(),
            repository_path: repository.display().to_string(),
            username: String::new(),
            password: String::new(),
        }
    }

    fn staged(kind: &str, stage_dir: &Path, staged_model: &Path, final_dir: &Path) -> StagedFolder {
        StagedFolder {
            kind: kind.into(),
            stage_dir: stage_dir.display().to_string(),
            staged_model_dir: staged_model.display().to_string(),
            final_dir: final_dir.display().to_string(),
        }
    }

    #[test]
    fn rename_style_swap_moves_staged_folder_and_reconciles() {
        let base = temp_dir("rename");
        let inv = base.join("inv");
        let repo = base.join("repo");
        let endpoint = endpoint(&inv, &repo);

        // staged LIGHT_SPEC folder (the relay writes files directly into the
        // stage root) + a stale INSPECT_SPEC under the target name
        let stage = inv.join("LIGHT_SPEC").join(".dmt_stage_1");
        std::fs::create_dir_all(&stage).unwrap();
        std::fs::write(stage.join("LightSpec.xml"), "<light/>").unwrap();
        let stale = inv.join("INSPECT_SPEC").join("2AN0860F01");
        std::fs::create_dir_all(&stale).unwrap();

        let final_dir = target_folder_path(&endpoint, "LIGHT_SPEC", "2AN0860F01");
        let folder = StagedFolder::consumed_by_rename(&stage, "LIGHT_SPEC", &final_dir);
        let report = finalize_staged_folders(vec![folder], &endpoint, "2AN0859F01", "2AN0860F01", &["LIGHT_SPEC".to_string()]).unwrap();

        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert!(final_dir.join("LightSpec.xml").exists());
        assert!(!stage.exists(), "renamed-away staging dir is gone");
        assert!(!stale.exists(), "kinds absent from the manifest are reconciled away");
    }

    #[test]
    fn fts_style_swap_keeps_source_name_inside_staging() {
        let base = temp_dir("fts");
        let repo = base.join("repo");
        let endpoint = endpoint(&base.join("inv"), &repo);

        // fts lands the folder under its SOURCE name inside the staging root;
        // finalize renames it to the target name and clears the root
        let stage = repo.join(".dmt_stage_fts_2");
        let staged_model = stage.join("2AN0859F01-00");
        std::fs::create_dir_all(&staged_model.join("sub")).unwrap();
        std::fs::write(staged_model.join("sub").join("g.gbr"), vec![7u8; 10]).unwrap();

        let final_dir = target_folder_path(&endpoint, "PxRepository", "2AN0860F01");
        let folder = staged("PxRepository", &stage, &staged_model, &final_dir);
        let report = finalize_staged_folders(vec![folder], &endpoint, "2AN0859F01", "2AN0860F01", &["PxRepository".to_string()]).unwrap();

        assert!(report.entries.iter().all(|entry| entry.ok), "{report:?}");
        assert_eq!(std::fs::read(final_dir.join("sub").join("g.gbr")).unwrap().len(), 10);
        assert!(!stage.exists(), "fts staging root is cleared after the swap");
    }

    #[test]
    fn delete_guard_blocks_before_anything_moves() {
        let base = temp_dir("guard");
        let inv = base.join("inv");
        let repo = base.join("repo");
        let endpoint = endpoint(&inv, &repo);

        // a final dir outside the spec root must be refused before anything moves
        let stage = inv.join("LIGHT_SPEC").join(".dmt_stage_3");
        std::fs::create_dir_all(&stage).unwrap();
        let folder = StagedFolder::consumed_by_rename(&stage, "LIGHT_SPEC", &repo.join("M01"));
        let error = finalize_staged_folders(vec![folder], &endpoint, "M01", "M01", &["LIGHT_SPEC".to_string()]).unwrap_err();
        assert!(error.contains("Refusing to touch"), "{error}");
        assert!(stage.exists(), "guarded staging dir survives a refused swap");
    }

    #[test]
    fn failing_second_swap_cleans_remaining_staging() {
        let base = temp_dir("midfail");
        let inv = base.join("inv");
        let repo = base.join("repo");
        let endpoint = endpoint(&inv, &repo);

        // first kind swaps fine; the second kind's staged folder is missing so
        // its rename fails - the already-swapped folder must stay and the
        // remaining staging root must be cleaned
        let stage_a = repo.join(".dmt_stage_a");
        let stage_b = inv.join("LIGHT_SPEC").join(".dmt_stage_b");
        std::fs::create_dir_all(&stage_a).unwrap();
        std::fs::create_dir_all(&stage_b).unwrap();
        std::fs::write(stage_a.join("g.gbr"), vec![7u8; 10]).unwrap();
        let folders = vec![
            StagedFolder::consumed_by_rename(&stage_a, "PxRepository", &target_folder_path(&endpoint, "PxRepository", "M01")),
            staged("LIGHT_SPEC", &stage_b, &stage_b.join("MISSING"), &target_folder_path(&endpoint, "LIGHT_SPEC", "M01")),
        ];
        assert!(finalize_staged_folders(folders, &endpoint, "M01", "M01", &["PxRepository".to_string(), "LIGHT_SPEC".to_string()]).is_err());
        assert!(repo.join("M01").join("g.gbr").exists(), "the folder already swapped stays");
        assert!(!stage_b.exists(), "failed swap cleaned the remaining staging root");
    }
}

//! Small app-data JSON files. Image caches use their existing app-cache paths.
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

fn resolve(root: &Path, name: &str) -> Result<PathBuf, String> {
    // Check both separators even on Unix, so the same names are safe on Windows.
    if name.is_empty()
        || name.starts_with(['/', '\\'])
        || name.contains(':')
        || name.split(['/', '\\']).any(|part| {
            part.is_empty() || part == ".." || part == "." || part.ends_with([' ', '.'])
        })
        || Path::new(name)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(
            "App file name must be a relative path without parent components or drive prefixes"
                .into(),
        );
    }
    Ok(root.join(name.replace('\\', "/")))
}

#[tauri::command]
pub fn read_app_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    match fs::read_to_string(resolve(&root, &name)?) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn atomic_write(file: &Path, content: &str) -> Result<(), String> {
    static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
    let parent = file.parent().ok_or("App file has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let (temporary, mut output) = loop {
        let temporary = parent.join(format!(
            ".afvi-{}-{}.tmp",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(output) => break (temporary, output),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    };
    let result = output
        .write_all(content.as_bytes())
        .and_then(|_| output.sync_all());
    drop(output);
    let result = result.and_then(|_| fs::rename(&temporary, file));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_app_file(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    atomic_write(&resolve(&root, &name)?, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_file_names_stay_under_the_app_data_root() {
        let root = Path::new("app-data");
        for name in [
            "machines.json",
            "ui/roi-boxes.json",
            "ui/gv/reference/M01.json",
            "ui\\teach-selection.json",
        ] {
            assert!(resolve(root, name).unwrap().starts_with(root));
        }
        for name in [
            "",
            "/etc/passwd",
            "\\root",
            "\\\\server\\share",
            "C:\\file",
            "C:file",
            "../file",
            "ui/../file",
            "ui\\..\\file",
            "ui/.. /file",
            "./file",
            "ui//file",
            "file:stream",
        ] {
            assert!(resolve(root, name).is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn writes_create_parents_and_replace_existing_files() {
        let root = std::env::temp_dir().join(format!("afvi-app-files-{}", std::process::id()));
        let file = resolve(&root, "ui/active-selection.json").unwrap();
        atomic_write(&file, "first").unwrap();
        atomic_write(&file, "second").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second");
        assert_eq!(fs::read_dir(file.parent().unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

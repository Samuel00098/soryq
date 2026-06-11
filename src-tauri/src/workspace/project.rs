use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: PathBuf,
    pub state: ProjectState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectState {
    pub open_files: Vec<PathBuf>,
    pub active_file: Option<PathBuf>,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub id: String,
    pub name: String,
    pub root_path: PathBuf,
    pub last_opened: String,
}

impl Project {
    pub fn new(root_path: PathBuf) -> Self {
        let name = root_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        // Derive a deterministic, path-stable id so that per-project persisted
        // state (terminal sessions, layout, open files) is keyed consistently
        // across app restarts and workspace switches. Opening the same folder
        // must always yield the same id, otherwise saved state can never be
        // matched back to the project. Canonicalize so equivalent paths (e.g.
        // with/without trailing slash or symlinks) map to the same id.
        let canonical = std::fs::canonicalize(&root_path).unwrap_or_else(|_| root_path.clone());
        let id =
            Uuid::new_v5(&Uuid::NAMESPACE_OID, canonical.to_string_lossy().as_bytes()).to_string();

        Project {
            id: id.clone(),
            name,
            root_path: root_path.clone(),
            state: ProjectState {
                open_files: Vec::new(),
                active_file: None,
                last_modified: chrono_lite_timestamp(),
            },
        }
    }
}

fn chrono_lite_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

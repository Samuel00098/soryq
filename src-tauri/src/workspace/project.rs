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

/// Fixed namespace for deriving deterministic project ids from folder paths.
/// Must never change — it anchors every `soryq_project_<id>` blob in the
/// frontend's localStorage to the folder it belongs to.
const PROJECT_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6f72_7971_5f70_726f_6a65_6374_5f69_6430);

/// Normalise a path into a stable key so the same folder always hashes to the
/// same id regardless of separator style or a trailing slash.
fn project_path_key(root_path: &PathBuf) -> String {
    let s = root_path.to_string_lossy().replace('\\', "/");
    s.trim_end_matches('/').to_string()
}

impl Project {
    pub fn new(root_path: PathBuf) -> Self {
        let name = root_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        // Deterministic id derived from the folder path. The same folder must
        // always resolve to the same id across app restarts so per-project
        // state (terminal layout, open files, panel layout) reconnects instead
        // of being orphaned under a fresh random id on every launch.
        let id = Uuid::new_v5(&PROJECT_ID_NAMESPACE, project_path_key(&root_path).as_bytes())
            .to_string();

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

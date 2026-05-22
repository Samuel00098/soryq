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
        let id = Uuid::new_v4().to_string();

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

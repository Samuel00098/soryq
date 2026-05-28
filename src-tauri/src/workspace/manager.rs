use crate::error::ForgeError;
use crate::workspace::project::{Project, RecentProject};
use std::path::PathBuf;
use std::sync::RwLock;
use dashmap::DashMap;

pub struct WorkspaceManager {
    projects: DashMap<String, Project>,
    pub active_project_id: std::sync::Arc<RwLock<Option<String>>>,
    recent_projects: RwLock<Vec<RecentProject>>,
    #[allow(dead_code)]
    config_dir: PathBuf,
}

impl WorkspaceManager {
    pub fn new(config_dir: PathBuf, active_project_id: std::sync::Arc<RwLock<Option<String>>>) -> Self {
        let recent_projects = Self::load_recent(&config_dir);
        WorkspaceManager {
            projects: DashMap::new(),
            active_project_id,
            recent_projects: RwLock::new(recent_projects),
            config_dir,
        }
    }

    pub fn set_active_project(&self, id: Option<String>) {
        if let Ok(mut active) = self.active_project_id.write() {
            *active = id;
        }
    }

    fn save_recent(&self) {
        if let Ok(recents) = self.recent_projects.read() {
            let path = self.config_dir.join("recent_projects.json");
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            if let Ok(content) = serde_json::to_string_pretty(&*recents) {
                std::fs::write(path, content).ok();
            }
        }
    }

    fn load_recent(config_dir: &PathBuf) -> Vec<RecentProject> {
        let path = config_dir.join("recent_projects.json");
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(recents) = serde_json::from_str(&content) {
                    return recents;
                }
            }
        }
        Vec::new()
    }

    pub fn open_project(&self, root_path: PathBuf) -> Result<Project, ForgeError> {
        let project = Project::new(root_path.clone());
        let id = project.id.clone();
        self.projects.insert(id.clone(), project.clone());

        self.add_to_recent(&project);
        Ok(project)
    }

    pub fn get_active_project(&self) -> Option<Project> {
        let active_id = self.active_project_id.read().ok()?.clone()?;
        self.projects.get(&active_id).map(|p| p.value().clone())
    }

    pub fn list_projects(&self) -> Vec<Project> {
        self.projects.iter().map(|entry| entry.value().clone()).collect()
    }

    pub fn get_recent_projects(&self) -> Vec<RecentProject> {
        self.recent_projects.read().ok().map(|r| r.clone()).unwrap_or_default()
    }

    fn add_to_recent(&self, project: &Project) {
        let recent = RecentProject {
            id: project.id.clone(),
            name: project.name.clone(),
            root_path: project.root_path.clone(),
            last_opened: project.state.last_modified.clone(),
        };

        if let Ok(mut recents) = self.recent_projects.write() {
            recents.retain(|r| r.id != recent.id);
            recents.insert(0, recent);
            if recents.len() > 20 {
                recents.truncate(20);
            }
        }
        self.save_recent();
    }

    pub fn clear_recent_projects(&self) {
        if let Ok(mut recents) = self.recent_projects.write() {
            recents.clear();
        }
        self.save_recent();
    }
}

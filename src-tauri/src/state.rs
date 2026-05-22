use crate::pty::manager::PtyManager;
use crate::theme::registry::ThemeRegistry;
use crate::workspace::manager::WorkspaceManager;
use crate::preview::PreviewManager;
use std::path::PathBuf;

pub struct AppState {
    pub theme_registry: ThemeRegistry,
    pub workspace_manager: WorkspaceManager,
    pub pty_manager: PtyManager,
    pub preview_manager: PreviewManager,
}

impl AppState {
    pub fn new(config_dir: PathBuf) -> Self {
        let active_project_id = std::sync::Arc::new(std::sync::RwLock::new(None));
        AppState {
            theme_registry: ThemeRegistry::new(config_dir.clone()),
            workspace_manager: WorkspaceManager::new(config_dir.clone(), active_project_id.clone()),
            pty_manager: PtyManager::new(),
            preview_manager: PreviewManager::new(active_project_id),
        }
    }
}


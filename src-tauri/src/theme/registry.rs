use crate::error::ForgeError;
use crate::theme::loader::load_bundled_themes;
use crate::theme::models::{Theme, ThemeInfo};
use std::collections::HashMap;
use std::sync::RwLock;

fn is_valid_css_color(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() {
        return false;
    }
    // Hex colors
    if let Some(hex) = v.strip_prefix('#') {
        return (hex.len() == 3 || hex.len() == 4 || hex.len() == 6 || hex.len() == 8)
            && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    // Named/functional values
    let lower = v.to_lowercase();
    lower == "transparent"
        || lower == "currentcolor"
        || lower == "inherit"
        || lower.starts_with("rgb(")
        || lower.starts_with("rgba(")
        || lower.starts_with("hsl(")
        || lower.starts_with("hsla(")
        || lower.starts_with("color(")
}

pub struct ThemeRegistry {
    config_dir: std::path::PathBuf,
    themes: RwLock<HashMap<String, Theme>>,
    active_theme: RwLock<String>,
}

impl ThemeRegistry {
    pub fn new(config_dir: std::path::PathBuf) -> Self {
        let mut theme_map = HashMap::new();
        for theme in load_bundled_themes() {
            theme_map.insert(theme.id.clone(), theme);
        }

        // Load custom themes
        let custom_themes_dir = config_dir.join("themes");
        if custom_themes_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&custom_themes_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                        if let Ok(theme) = crate::theme::loader::load_theme_from_file(&path) {
                            theme_map.insert(theme.id.clone(), theme);
                        }
                    }
                }
            }
        }

        // Load active theme setting
        let active_theme_file = config_dir.join("active_theme.txt");
        let active_theme = if active_theme_file.exists() {
            std::fs::read_to_string(&active_theme_file)
                .unwrap_or_else(|_| "forge-dark".to_string())
                .trim()
                .to_string()
        } else {
            "forge-dark".to_string()
        };

        ThemeRegistry {
            config_dir,
            themes: RwLock::new(theme_map),
            active_theme: RwLock::new(active_theme),
        }
    }

    pub fn list_themes(&self) -> Result<Vec<ThemeInfo>, ForgeError> {
        let themes = self
            .themes
            .read()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        Ok(themes.values().map(ThemeInfo::from).collect())
    }

    pub fn get_active_theme(&self) -> Result<Theme, ForgeError> {
        let active_id = self
            .active_theme
            .read()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        let themes = self
            .themes
            .read()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        themes
            .get(&*active_id)
            .cloned()
            .ok_or_else(|| ForgeError::ThemeNotFound(active_id.clone()))
    }

    pub fn activate_theme(&self, theme_id: &str) -> Result<Theme, ForgeError> {
        let themes = self
            .themes
            .read()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        if !themes.contains_key(theme_id) {
            return Err(ForgeError::ThemeNotFound(theme_id.to_string()));
        }
        drop(themes);

        let mut active = self
            .active_theme
            .write()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        *active = theme_id.to_string();

        let active_theme_file = self.config_dir.join("active_theme.txt");
        let _ = std::fs::write(active_theme_file, theme_id);
        drop(active);

        let themes = self
            .themes
            .read()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        themes
            .get(theme_id)
            .cloned()
            .ok_or_else(|| ForgeError::ThemeNotFound(theme_id.to_string()))
    }

    pub fn save_custom_theme(&self, theme: Theme) -> Result<(), ForgeError> {
        let safe_id: String = theme
            .id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if safe_id.is_empty() || safe_id != theme.id {
            return Err(ForgeError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid theme ID",
            )));
        }
        for (key, value) in theme.colors.iter().chain(theme.syntax.iter()) {
            if !is_valid_css_color(value) {
                return Err(ForgeError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Invalid color value for '{}': '{}'", key, value),
                )));
            }
        }
        let theme_path = self
            .config_dir
            .join("themes")
            .join(format!("{}.json", safe_id));
        crate::theme::loader::save_theme_to_file(&theme, &theme_path)?;

        let mut themes = self
            .themes
            .write()
            .map_err(|_| ForgeError::Io(std::io::Error::other("Lock poisoned")))?;
        themes.insert(theme.id.clone(), theme);
        Ok(())
    }
}

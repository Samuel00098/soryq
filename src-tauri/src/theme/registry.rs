use crate::error::ForgeError;
use crate::theme::loader::{load_bundled_themes, load_theme_from_file, save_theme_to_file};
use crate::theme::models::{Theme, ThemeInfo, ThemeType};
use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

/// Bumped whenever the bundled brand defaults change and on-disk custom themes
/// derived from an older default should be migrated forward.
/// v1 = amber → teal/sky. v2 = teal/sky → graphite grey.
const BRAND_MIGRATION_VERSION: u32 = 2;

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

/// Normalize a CSS color for comparison: drop all whitespace, lowercase.
/// Lets `rgba(245, 158, 11, 0.2)` match a stored `rgba(245,158,11,0.2)`.
fn norm_color(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Per-theme-type `(key, old_default, new_default)` map for the amber → teal/sky
/// brand migration. Key-aware so we only rewrite a value that is *still* the exact
/// previous bundled default for that key — any user customization is left intact.
/// `warning` (#fbbf24 / #9a6700) is intentionally absent: it stays amber (semantic).
fn legacy_amber_map(theme_type: &ThemeType) -> &'static [(&'static str, &'static str, &'static str)]
{
    match theme_type {
        ThemeType::Dark => &[
            ("accent", "#f59e0b", "#2dd4bf"),
            ("accent-hover", "#d97706", "#14b8a6"),
            ("border-focus", "#f59e0b", "#2dd4bf"),
            ("input-focus-border", "#f59e0b", "#2dd4bf"),
            ("button-bg", "#b45309", "#0f766e"),
            ("button-hover-bg", "#d97706", "#0d9488"),
            ("selection-bg", "rgba(245,158,11,0.2)", "rgba(45, 212, 191, 0.2)"),
        ],
        ThemeType::Light => &[
            ("accent", "#d97706", "#0d9488"),
            ("accent-hover", "#b45309", "#0f766e"),
            ("border-focus", "#d97706", "#0d9488"),
            ("input-focus-border", "#d97706", "#0d9488"),
            ("button-bg", "#b45309", "#0f766e"),
            ("button-hover-bg", "#92400e", "#115e59"),
            ("selection-bg", "rgba(217,119,6,0.22)", "rgba(13, 148, 136, 0.22)"),
        ],
    }
}

/// Rewrite legacy amber defaults to the teal/sky brand in-place. Returns whether
/// anything changed.
fn migrate_theme_amber(theme: &mut Theme) -> bool {
    apply_color_map(theme, legacy_amber_map(&theme.theme_type))
}

/// Per-theme-type `(key, old_default, new_default)` map for the teal/sky → graphite
/// grey brand migration. Same key-aware contract as `legacy_amber_map`. `warning`
/// stays amber and code syntax colors are untouched (semantic, not brand accent).
fn legacy_teal_map(theme_type: &ThemeType) -> &'static [(&'static str, &'static str, &'static str)] {
    match theme_type {
        ThemeType::Dark => &[
            ("accent", "#2dd4bf", "#aeb6c2"),
            ("accent-hover", "#14b8a6", "#c7cdd6"),
            ("border-focus", "#2dd4bf", "#aeb6c2"),
            ("input-focus-border", "#2dd4bf", "#aeb6c2"),
            ("button-bg", "#0f766e", "#3f4650"),
            ("button-hover-bg", "#0d9488", "#4b525d"),
            ("selection-bg", "rgba(45,212,191,0.2)", "rgba(174, 182, 194, 0.2)"),
        ],
        ThemeType::Light => &[
            ("accent", "#0d9488", "#5b6470"),
            ("accent-hover", "#0f766e", "#474e58"),
            ("border-focus", "#0d9488", "#5b6470"),
            ("input-focus-border", "#0d9488", "#5b6470"),
            ("button-bg", "#0f766e", "#3f4650"),
            ("button-hover-bg", "#115e59", "#2f343b"),
            ("selection-bg", "rgba(13,148,136,0.22)", "rgba(91, 100, 112, 0.22)"),
        ],
    }
}

/// Rewrite legacy teal/sky defaults to the graphite grey brand in-place. Returns
/// whether anything changed.
fn migrate_theme_teal(theme: &mut Theme) -> bool {
    apply_color_map(theme, legacy_teal_map(&theme.theme_type))
}

/// Apply a key-aware `(key, old, new)` color map to a theme, rewriting only values
/// that still exactly match the previous bundled default. Returns whether anything
/// changed.
fn apply_color_map(
    theme: &mut Theme,
    map: &[(&str, &str, &str)],
) -> bool {
    let mut changed = false;
    for (key, old, new) in map {
        if let Some(value) = theme.colors.get_mut(*key) {
            if norm_color(value) == norm_color(old) {
                *value = (*new).to_string();
                changed = true;
            }
        }
    }
    changed
}

/// One-shot migration of on-disk custom themes from the old amber brand to teal/sky.
/// Gated by a version marker so it runs at most once per bump; failures are
/// best-effort and never block startup.
fn run_brand_migration(config_dir: &Path) {
    let marker = config_dir.join(".theme_brand_migration");
    let current: u32 = std::fs::read_to_string(&marker)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    if current >= BRAND_MIGRATION_VERSION {
        return;
    }

    let themes_dir = config_dir.join("themes");
    if themes_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&themes_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(mut theme) = load_theme_from_file(&path) {
                        // Chain migrations so a theme still on the original amber
                        // brand is carried amber → teal → grey in one pass.
                        let amber_changed = migrate_theme_amber(&mut theme);
                        let teal_changed = migrate_theme_teal(&mut theme);
                        if amber_changed || teal_changed {
                            let _ = save_theme_to_file(&theme, &path);
                        }
                    }
                }
            }
        }
    }

    let _ = std::fs::create_dir_all(config_dir);
    let _ = std::fs::write(&marker, BRAND_MIGRATION_VERSION.to_string());
}

pub struct ThemeRegistry {
    config_dir: std::path::PathBuf,
    themes: RwLock<HashMap<String, Theme>>,
    active_theme: RwLock<String>,
}

impl ThemeRegistry {
    pub fn new(config_dir: std::path::PathBuf) -> Self {
        // One-time brand migration of on-disk custom themes (amber → teal/sky),
        // run before they're read below so the migrated values are what load.
        run_brand_migration(&config_dir);

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

#[cfg(test)]
mod tests {
    use super::*;

    fn theme_with(theme_type: ThemeType, colors: &[(&str, &str)]) -> Theme {
        Theme {
            id: "t".into(),
            name: "T".into(),
            theme_type,
            colors: colors
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            syntax: HashMap::new(),
        }
    }

    #[test]
    fn migrates_dark_amber_defaults_to_teal() {
        let mut t = theme_with(
            ThemeType::Dark,
            &[
                ("accent", "#f59e0b"),
                ("border-focus", "#f59e0b"),
                ("selection-bg", "rgba(245, 158, 11, 0.2)"),
                ("warning", "#fbbf24"),
            ],
        );
        assert!(migrate_theme_amber(&mut t));
        assert_eq!(t.colors["accent"], "#2dd4bf");
        assert_eq!(t.colors["border-focus"], "#2dd4bf");
        assert_eq!(t.colors["selection-bg"], "rgba(45, 212, 191, 0.2)");
        // warning is semantic — must stay amber.
        assert_eq!(t.colors["warning"], "#fbbf24");
    }

    #[test]
    fn key_aware_disambiguates_shared_old_hex() {
        // In the old dark theme #d97706 was BOTH accent-hover and button-hover-bg,
        // but they migrate to different new colors — the map must key off the field.
        let mut t = theme_with(
            ThemeType::Dark,
            &[("accent-hover", "#d97706"), ("button-hover-bg", "#d97706")],
        );
        assert!(migrate_theme_amber(&mut t));
        assert_eq!(t.colors["accent-hover"], "#14b8a6");
        assert_eq!(t.colors["button-hover-bg"], "#0d9488");
    }

    #[test]
    fn migrates_light_amber_defaults() {
        let mut t = theme_with(
            ThemeType::Light,
            &[("accent", "#d97706"), ("selection-bg", "rgba(217,119,6,0.22)")],
        );
        assert!(migrate_theme_amber(&mut t));
        assert_eq!(t.colors["accent"], "#0d9488");
        assert_eq!(t.colors["selection-bg"], "rgba(13, 148, 136, 0.22)");
    }

    #[test]
    fn leaves_user_customizations_untouched() {
        // A deliberately-customized accent (not the old default) must not change.
        let mut t = theme_with(ThemeType::Dark, &[("accent", "#ff0066")]);
        assert!(!migrate_theme_amber(&mut t));
        assert!(!migrate_theme_teal(&mut t));
        assert_eq!(t.colors["accent"], "#ff0066");
    }

    #[test]
    fn migrates_dark_teal_defaults_to_grey() {
        let mut t = theme_with(
            ThemeType::Dark,
            &[
                ("accent", "#2dd4bf"),
                ("border-focus", "#2dd4bf"),
                ("button-bg", "#0f766e"),
                ("selection-bg", "rgba(45, 212, 191, 0.2)"),
                ("warning", "#fbbf24"),
            ],
        );
        assert!(migrate_theme_teal(&mut t));
        assert_eq!(t.colors["accent"], "#aeb6c2");
        assert_eq!(t.colors["border-focus"], "#aeb6c2");
        assert_eq!(t.colors["button-bg"], "#3f4650");
        assert_eq!(t.colors["selection-bg"], "rgba(174, 182, 194, 0.2)");
        // warning is semantic — must stay amber.
        assert_eq!(t.colors["warning"], "#fbbf24");
    }

    #[test]
    fn migrates_light_teal_defaults_to_grey() {
        // In the old light theme #0f766e was BOTH accent-hover and button-bg, but
        // they migrate to different greys — the map must key off the field.
        let mut t = theme_with(
            ThemeType::Light,
            &[("accent-hover", "#0f766e"), ("button-bg", "#0f766e")],
        );
        assert!(migrate_theme_teal(&mut t));
        assert_eq!(t.colors["accent-hover"], "#474e58");
        assert_eq!(t.colors["button-bg"], "#3f4650");
    }

    #[test]
    fn chains_amber_through_teal_to_grey() {
        // An untouched original amber theme should end up grey after both passes.
        let mut t = theme_with(ThemeType::Dark, &[("accent", "#f59e0b")]);
        assert!(migrate_theme_amber(&mut t)); // amber → teal
        assert!(migrate_theme_teal(&mut t)); // teal → grey
        assert_eq!(t.colors["accent"], "#aeb6c2");
    }
}

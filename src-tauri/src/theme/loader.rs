use crate::error::ForgeError;
use crate::theme::models::Theme;
use std::fs;
use std::path::PathBuf;

#[allow(dead_code)]
pub fn load_theme_from_file(path: &PathBuf) -> Result<Theme, ForgeError> {
    let content = fs::read_to_string(path)?;
    let theme: Theme = serde_json::from_str(&content)?;
    Ok(theme)
}

pub fn save_theme_to_file(theme: &Theme, path: &PathBuf) -> Result<(), ForgeError> {
    let content = serde_json::to_string_pretty(theme)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

pub fn load_bundled_themes() -> Vec<Theme> {
    let mut themes = Vec::new();

    let dark_theme = Theme {
        id: "forge-dark".to_string(),
        name: "Forge Dark".to_string(),
        theme_type: crate::theme::models::ThemeType::Dark,
        colors: [
            ("bg-primary", "#18181e"),
            ("bg-secondary", "#121216"),
            ("bg-tertiary", "#22222a"),
            ("bg-hover", "rgba(255, 255, 255, 0.04)"),
            ("bg-active", "rgba(255, 255, 255, 0.07)"),
            ("text-primary", "#f3f3f6"),
            ("text-secondary", "#9494a6"),
            ("text-muted", "#555566"),
            ("accent", "#06b6d4"),
            ("accent-hover", "#0891b2"),
            ("border", "rgba(255, 255, 255, 0.06)"),
            ("border-focus", "#06b6d4"),
            ("error", "#f87171"),
            ("warning", "#fbbf24"),
            ("success", "#4ade80"),
            ("scrollbar-thumb", "rgba(255, 255, 255, 0.08)"),
            ("scrollbar-track", "transparent"),
            ("selection-bg", "rgba(6, 182, 212, 0.2)"),
            ("titlebar-bg", "#121216"),
            ("titlebar-text", "#e2e2eb"),
            ("titlebar-border", "rgba(255, 255, 255, 0.04)"),
            ("activitybar-bg", "#121216"),
            ("activitybar-border", "rgba(255, 255, 255, 0.04)"),
            ("sidebar-bg", "#121216"),
            ("sidebar-border", "rgba(255, 255, 255, 0.05)"),
            ("editor-bg", "#18181e"),
            ("editor-gutter", "#18181e"),
            ("statusbar-bg", "#121216"),
            ("statusbar-border", "rgba(255, 255, 255, 0.04)"),
            ("statusbar-text", "#6060a0"),
            ("tab-active-bg", "#18181e"),
            ("tab-inactive-bg", "#121216"),
            ("tab-border", "rgba(255, 255, 255, 0.05)"),
            ("panel-bg", "#18181e"),
            ("panel-border", "rgba(255, 255, 255, 0.05)"),
            ("input-bg", "#1e1e24"),
            ("input-border", "rgba(255, 255, 255, 0.08)"),
            ("input-focus-border", "#06b6d4"),
            ("button-bg", "#0e7490"),
            ("button-hover-bg", "#0891b2"),
            ("button-text", "#ffffff"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect(),
        syntax: [
            ("keyword", "#c792ea"),
            ("string", "#a5d6ff"),
            ("comment", "#4a4a7a"),
            ("function", "#82aaff"),
            ("number", "#f78c6c"),
            ("type", "#ffcb6b"),
            ("variable", "#f07178"),
            ("operator", "#89ddff"),
            ("punctuation", "#a0a0c0"),
            ("tag", "#ffcb6b"),
            ("attribute", "#82aaff"),
            ("constant", "#ff9cac"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect(),
    };

    let light_theme = Theme {
        id: "forge-light".to_string(),
        name: "Forge Light".to_string(),
        theme_type: crate::theme::models::ThemeType::Light,
        colors: [
            ("bg-primary", "#fafafa"),
            ("bg-secondary", "#f4f4f4"),
            ("bg-tertiary", "#eaeaea"),
            ("bg-hover", "rgba(0, 0, 0, 0.04)"),
            ("bg-active", "rgba(0, 0, 0, 0.08)"),
            ("text-primary", "#1f2328"),
            ("text-secondary", "#444d56"),
            ("text-muted", "#57606a"),
            ("accent", "#0ea5e9"),
            ("accent-hover", "#0284c7"),
            ("border", "rgba(0, 0, 0, 0.08)"),
            ("border-focus", "#0ea5e9"),
            ("error", "#cf222e"),
            ("warning", "#9a6700"),
            ("success", "#1a7f37"),
            ("scrollbar-thumb", "rgba(0, 0, 0, 0.1)"),
            ("scrollbar-track", "transparent"),
            ("selection-bg", "rgba(14, 165, 233, 0.25)"),
            ("titlebar-bg", "#fafafa"),
            ("titlebar-text", "#1f2328"),
            ("titlebar-border", "rgba(0, 0, 0, 0.06)"),
            ("activitybar-bg", "#fafafa"),
            ("activitybar-border", "rgba(0, 0, 0, 0.06)"),
            ("sidebar-bg", "#f4f4f4"),
            ("sidebar-border", "rgba(0, 0, 0, 0.08)"),
            ("editor-bg", "#fafafa"),
            ("editor-gutter", "#fafafa"),
            ("statusbar-bg", "#f4f4f4"),
            ("statusbar-border", "rgba(0, 0, 0, 0.06)"),
            ("statusbar-text", "#444d56"),
            ("tab-active-bg", "#fafafa"),
            ("tab-inactive-bg", "#f4f4f4"),
            ("tab-border", "rgba(0, 0, 0, 0.08)"),
            ("panel-bg", "#fafafa"),
            ("panel-border", "rgba(0, 0, 0, 0.08)"),
            ("input-bg", "#ffffff"),
            ("input-border", "rgba(0, 0, 0, 0.1)"),
            ("input-focus-border", "#0ea5e9"),
            ("button-bg", "#0ea5e9"),
            ("button-hover-bg", "#0284c7"),
            ("button-text", "#ffffff"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect(),
        syntax: [
            ("keyword", "#d73a49"),
            ("string", "#032f62"),
            ("comment", "#57606a"),
            ("function", "#6f42c1"),
            ("number", "#005cc5"),
            ("type", "#e36209"),
            ("variable", "#e36209"),
            ("operator", "#d73a49"),
            ("punctuation", "#24292e"),
            ("tag", "#22863a"),
            ("attribute", "#005cc5"),
            ("constant", "#005cc5"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect(),
    };

    themes.push(dark_theme);
    themes.push(light_theme);
    themes
}

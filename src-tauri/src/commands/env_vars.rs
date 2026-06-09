use crate::state::AppState;
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

// Same service the AI key vault uses, so all of Soryq's secrets live under one
// keychain service. Env vaults are namespaced by project id in the account.
const KEYCHAIN_SERVICE: &str = "com.samue.soryq";

fn vault_entry(project_id: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &format!("env-vault::{project_id}"))
        .map_err(|e| format!("Failed to access the system keychain: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !key.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(true)
}

fn read_vault(project_id: &str) -> Result<BTreeMap<String, String>, String> {
    let entry = vault_entry(project_id)?;
    match entry.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(KeyringError::NoEntry) => Ok(BTreeMap::new()),
        Err(e) => Err(format!("Failed to read the env vault: {e}")),
    }
}

fn write_vault(project_id: &str, map: &BTreeMap<String, String>) -> Result<(), String> {
    let entry = vault_entry(project_id)?;
    if map.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to clear the env vault: {e}")),
        };
    }
    let json = serde_json::to_string(map).map_err(|e| format!("Failed to serialize env vault: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("Failed to save the env vault: {e}"))
}

fn to_vec(map: BTreeMap<String, String>) -> Vec<EnvVar> {
    map.into_iter()
        .map(|(key, value)| EnvVar { key, value })
        .collect()
}

/// Read a project's stored environment variables (sorted by key).
#[tauri::command]
pub fn env_vault_get(project_id: String) -> Result<Vec<EnvVar>, String> {
    Ok(to_vec(read_vault(&project_id)?))
}

/// Replace a project's environment variables with `vars`.
#[tauri::command]
pub fn env_vault_set(project_id: String, vars: Vec<EnvVar>) -> Result<(), String> {
    let mut map = BTreeMap::new();
    for v in vars {
        let key = v.key.trim().to_string();
        if key.is_empty() {
            continue;
        }
        if !is_valid_key(&key) {
            return Err(format!(
                "Invalid variable name '{key}'. Use letters, digits, and underscores (not starting with a digit)."
            ));
        }
        map.insert(key, v.value);
    }
    write_vault(&project_id, &map)
}

/// Merge the project's root `.env` file into the vault and return the result.
#[tauri::command]
pub fn env_vault_import_dotenv(
    project_id: String,
    state: State<AppState>,
) -> Result<Vec<EnvVar>, String> {
    let projects = state.workspace_manager.list_projects();
    let project = projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let dotenv = project.root_path.join(".env");
    if !dotenv.exists() {
        return Err("No .env file found in the project root.".to_string());
    }
    let content =
        std::fs::read_to_string(&dotenv).map_err(|e| format!("Failed to read .env: {e}"))?;

    let mut map = read_vault(&project_id)?;
    for (k, v) in parse_dotenv(&content) {
        map.insert(k, v);
    }
    write_vault(&project_id, &map)?;
    Ok(to_vec(map))
}

/// Minimal .env parser: `KEY=VALUE` lines, `#` comments, optional `export`
/// prefix, and surrounding single/double quotes stripped from the value.
fn parse_dotenv(content: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim().to_string();
            if !is_valid_key(&key) {
                continue;
            }
            let mut val = v.trim().to_string();
            if val.len() >= 2
                && ((val.starts_with('"') && val.ends_with('"'))
                    || (val.starts_with('\'') && val.ends_with('\'')))
            {
                val = val[1..val.len() - 1].to_string();
            }
            out.push((key, val));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_dotenv() {
        let parsed = parse_dotenv("# comment\nexport API_URL=\"https://x.y\"\nTOKEN='abc'\nEMPTY=\nBAD KEY=1\n3X=nope");
        assert_eq!(parsed, vec![
            ("API_URL".to_string(), "https://x.y".to_string()),
            ("TOKEN".to_string(), "abc".to_string()),
            ("EMPTY".to_string(), "".to_string()),
        ]);
    }

    #[test]
    fn rejects_invalid_keys() {
        assert!(is_valid_key("API_KEY_1"));
        assert!(!is_valid_key("1KEY"));
        assert!(!is_valid_key("has space"));
        assert!(!is_valid_key(""));
    }
}

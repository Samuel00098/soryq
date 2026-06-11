use crate::state::AppState;
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct DbQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: usize,
    pub is_select: bool,
}

#[tauri::command]
pub fn db_list_tables(path: String, state: State<AppState>) -> Result<Vec<String>, String> {
    let p = Path::new(&path);
    super::file_system::require_in_project(p, &state)?;

    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open database: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| format!("Failed to query schema: {e}"))?;

    let table_iter = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to list tables: {e}"))?;

    let mut tables = Vec::new();
    for t in table_iter.flatten() {
        tables.push(t);
    }
    Ok(tables)
}

#[tauri::command]
pub fn db_execute_query(
    path: String,
    query: String,
    state: State<AppState>,
) -> Result<DbQueryResult, String> {
    let p = Path::new(&path);
    super::file_system::require_in_project(p, &state)?;

    let trimmed = query.trim().to_uppercase();
    let is_select = trimmed.starts_with("SELECT")
        || trimmed.starts_with("PRAGMA")
        || trimmed.starts_with("EXPLAIN");

    if is_select {
        // Read-only connection: even if the SELECT classification is bypassed, the OS-level
        // read-only flag prevents any writes to the database file.
        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open database: {e}"))?;
        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| format!("Query preparation failed: {e}"))?;
        let columns: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let num_cols = columns.len();

        let mut rows = Vec::new();
        let mut results = stmt
            .query([])
            .map_err(|e| format!("Query execution failed: {e}"))?;

        while let Some(row) = results
            .next()
            .map_err(|e| format!("Error fetching row: {e}"))?
        {
            let mut row_vals = Vec::with_capacity(num_cols);
            for i in 0..num_cols {
                let val_ref = row
                    .get_ref(i)
                    .map_err(|e| format!("Error getting column value: {e}"))?;
                let val = match val_ref {
                    ValueRef::Null => serde_json::Value::Null,
                    ValueRef::Integer(val) => {
                        serde_json::Value::Number(serde_json::Number::from(val))
                    }
                    ValueRef::Real(val) => {
                        if let Some(num) = serde_json::Number::from_f64(val) {
                            serde_json::Value::Number(num)
                        } else {
                            serde_json::Value::Null
                        }
                    }
                    ValueRef::Text(val) => {
                        let s = String::from_utf8_lossy(val).into_owned();
                        serde_json::Value::String(s)
                    }
                    ValueRef::Blob(val) => {
                        let s = base64::Engine::encode(&base64::prelude::BASE64_STANDARD, val);
                        serde_json::Value::String(format!("blob:{}", s))
                    }
                };
                row_vals.push(val);
            }
            rows.push(row_vals);
        }

        Ok(DbQueryResult {
            columns,
            rows,
            affected_rows: 0,
            is_select: true,
        })
    } else {
        let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {e}"))?;
        let affected_rows = conn
            .execute(&query, [])
            .map_err(|e| format!("Query execution failed: {e}"))?;
        Ok(DbQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows,
            is_select: false,
        })
    }
}

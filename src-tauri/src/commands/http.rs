use std::collections::HashMap;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct HttpResponsePayload {
    status: u16,
    #[serde(rename = "statusText")]
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
    duration: u32,
    size: usize,
    ok: bool,
}

#[tauri::command]
pub async fn http_send_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponsePayload, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("Failed to create HTTP client: {err}"))?;

    let method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return Err(format!("Unsupported HTTP method: {method}")),
    };

    let mut builder = client.request(method, &url);

    for (k, v) in headers {
        builder = builder.header(k, v);
    }

    if let Some(b) = body {
        builder = builder.body(b);
    }

    let start = Instant::now();
    let response = builder
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;
    
    let duration = start.elapsed().as_millis() as u32;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    
    let ok = response.status().is_success();

    let mut res_headers = HashMap::new();
    for (k, v) in response.headers().iter() {
        if let Ok(val_str) = v.to_str() {
            res_headers.insert(k.to_string(), val_str.to_string());
        }
    }

    let body_bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read response body: {err}"))?;
    
    let size = body_bytes.len();
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(HttpResponsePayload {
        status,
        status_text,
        headers: res_headers,
        body: body_str,
        duration,
        size,
        ok,
    })
}

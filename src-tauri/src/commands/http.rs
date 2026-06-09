use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use url::Url;

/// Largest response body we'll buffer into memory. The client reads the body in
/// chunks and aborts once this is exceeded, so a huge or endless response can't
/// exhaust memory.
const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024;

/// True for a concrete IP in a range the in-app HTTP client must never reach.
/// Loopback and private ranges stay allowed on purpose — hitting your own dev
/// server is the whole point — but link-local addresses (notably the
/// 169.254.169.254 cloud-metadata endpoint) have no legitimate use from a
/// desktop app and are a classic credential-theft SSRF target.
fn ip_is_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local() || v4.is_broadcast() || v4.is_unspecified(),
        IpAddr::V6(v6) => {
            // fe80::/10 link-local, the unspecified address, and any
            // IPv4-mapped link-local address (e.g. ::ffff:169.254.x.x).
            v6.is_unspecified()
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                || v6.to_ipv4().map(|m| m.is_link_local()).unwrap_or(false)
        }
    }
}

/// Fast, no-DNS reject: blocks the well-known metadata hostnames and any host
/// that is itself a blocked IP literal. Cheap enough to run on every redirect
/// hop without a network round-trip.
fn host_is_blocked(host: &str) -> bool {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');

    const BLOCKED_HOSTS: &[&str] = &["metadata.google.internal", "metadata.goog"];
    if BLOCKED_HOSTS.iter().any(|h| host.eq_ignore_ascii_case(h)) {
        return true;
    }

    host.parse::<IpAddr>().map(ip_is_blocked).unwrap_or(false)
}

/// DNS-aware reject: resolves `host` and blocks it if ANY resolved address is in
/// a protected range. This closes the gap where an innocuous-looking hostname
/// (or a redirect target) resolves to the cloud-metadata endpoint — something
/// the literal `host_is_blocked` check alone would miss. A residual
/// DNS-rebinding TOCTOU remains (reqwest re-resolves at connect time and could
/// in theory get a different answer), but this stops the straightforward
/// "hostname → 169.254.169.254" bypass. Resolution failures return false so
/// reqwest surfaces the real connection error.
fn resolved_host_is_blocked(host: &str) -> bool {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    match (host, 80u16).to_socket_addrs() {
        Ok(addrs) => addrs.into_iter().any(|sa| ip_is_blocked(sa.ip())),
        Err(_) => false,
    }
}

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
    // Restrict to http/https — file://, ftp://, etc. have no place in an HTTP client.
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed_url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Unsupported URL scheme '{scheme}': only http and https are allowed")),
    }
    if let Some(host) = parsed_url.host_str() {
        // Fast literal/hostname reject first, then a DNS-aware reject that catches
        // a hostname pointing at a blocked address. The resolve is blocking, so
        // run it off the async runtime thread.
        if host_is_blocked(host) {
            return Err("Requests to link-local or cloud-metadata addresses are blocked".to_string());
        }
        let host_owned = host.to_string();
        let resolved_blocked = tokio::task::spawn_blocking(move || resolved_host_is_blocked(&host_owned))
            .await
            .unwrap_or(false);
        if resolved_blocked {
            return Err("Host resolves to a blocked link-local or cloud-metadata address".to_string());
        }
    }

    // Cap redirects at 10 hops AND re-check the host on every hop — literal and
    // DNS-aware — so a redirect can't smuggle the request to a blocked metadata
    // address, even via a hostname that resolves there.
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error("too many redirects");
        }
        if attempt.url().host_str().map(|h| host_is_blocked(h) || resolved_host_is_blocked(h)).unwrap_or(false) {
            return attempt.error("redirect to a blocked link-local or metadata address");
        }
        attempt.follow()
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(redirect_policy)
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
    let mut response = builder
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

    // Stream the body in chunks and stop once it exceeds the cap, so an oversized
    // or never-ending response can't blow up memory.
    let mut body_bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("Failed to read response body: {err}"))?
    {
        if body_bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(format!(
                "Response body exceeds the {} MB limit",
                MAX_RESPONSE_BYTES / (1024 * 1024)
            ));
        }
        body_bytes.extend_from_slice(&chunk);
    }

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

#[cfg(test)]
mod tests {
    use super::{host_is_blocked, resolved_host_is_blocked};

    #[test]
    fn blocks_cloud_metadata_and_link_local() {
        // IMDS endpoint and link-local range.
        assert!(host_is_blocked("169.254.169.254"));
        assert!(host_is_blocked("169.254.1.1"));
        // Metadata hostnames (case-insensitive).
        assert!(host_is_blocked("metadata.google.internal"));
        assert!(host_is_blocked("Metadata.Google.Internal"));
        // IPv6 link-local and IPv4-mapped link-local.
        assert!(host_is_blocked("fe80::1"));
        assert!(host_is_blocked("[fe80::1]"));
        assert!(host_is_blocked("::ffff:169.254.169.254"));
        // Unspecified addresses.
        assert!(host_is_blocked("0.0.0.0"));
        assert!(host_is_blocked("::"));
    }

    #[test]
    fn allows_loopback_private_and_public() {
        // Devs need to hit their own services — these stay allowed.
        assert!(!host_is_blocked("127.0.0.1"));
        assert!(!host_is_blocked("localhost"));
        assert!(!host_is_blocked("192.168.1.10"));
        assert!(!host_is_blocked("10.0.0.5"));
        assert!(!host_is_blocked("::1"));
        // Ordinary public hosts.
        assert!(!host_is_blocked("api.github.com"));
        assert!(!host_is_blocked("93.184.216.34"));
    }

    #[test]
    fn resolved_check_blocks_metadata_and_allows_loopback() {
        // IP literals resolve to themselves — deterministic, no real DNS needed.
        assert!(resolved_host_is_blocked("169.254.169.254"));
        assert!(resolved_host_is_blocked("169.254.1.1"));
        // Loopback / private must stay reachable.
        assert!(!resolved_host_is_blocked("127.0.0.1"));
        assert!(!resolved_host_is_blocked("192.168.1.10"));
        // A name that fails to resolve returns false so reqwest reports the error.
        assert!(!resolved_host_is_blocked("this-name-should-not-resolve.invalid"));
    }
}

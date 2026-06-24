//! Mobile device panels backend.
//!
//! Two device families share this module:
//!
//! * **Android** — driven through `adb`/`emulator` (Android SDK platform-tools +
//!   emulator on PATH). The frontend mirrors the screen by polling
//!   `android_screencap` and injects input via `android_tap`/`_swipe`/`_key`/
//!   `_text`, so the mirror is fully interactive without bundling scrcpy.
//! * **iOS** — driven through `xcrun simctl`, which only exists on macOS. Every
//!   iOS command guards on the platform and returns a clear error elsewhere, so
//!   the panel can stay gated to Mac users.
//!
//! All child processes use CREATE_NO_WINDOW on Windows so no console flashes.

use std::path::PathBuf;
use std::process::Command;

use base64::Engine;
use serde::Serialize;

/// Build a `Command` that never flashes a console window on Windows.
fn quiet_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

// Used only by the macOS/Linux SDK-location branches; dead on Windows.
#[cfg_attr(windows, allow(dead_code))]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

/// Locate the Android SDK root. Honours `ANDROID_HOME`/`ANDROID_SDK_ROOT`, then
/// falls back to the default Android Studio install location per platform — so
/// the panel works even when `adb`/`emulator` aren't on PATH (the common case
/// after a fresh Android Studio install).
fn android_sdk_root() -> Option<PathBuf> {
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(v) = std::env::var_os(key) {
            let p = PathBuf::from(v);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("Android").join("Sdk");
        if p.is_dir() {
            return Some(p);
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(h) = home_dir() {
        let p = h.join("Library").join("Android").join("sdk");
        if p.is_dir() {
            return Some(p);
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(h) = home_dir() {
        let p = h.join("Android").join("Sdk");
        if p.is_dir() {
            return Some(p);
        }
    }
    None
}

/// Full path to an SDK tool (e.g. `platform-tools`/`adb`) if it exists, with the
/// right extension per platform.
fn tool_in_sdk(subdir: &str, exe: &str) -> Option<String> {
    let root = android_sdk_root()?;
    let exe_name = if cfg!(windows) {
        format!("{exe}.exe")
    } else {
        exe.to_string()
    };
    let p = root.join(subdir).join(&exe_name);
    if p.is_file() {
        Some(p.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// The `adb` binary: SDK copy if found, otherwise rely on PATH.
fn adb_program() -> String {
    tool_in_sdk("platform-tools", "adb").unwrap_or_else(|| "adb".to_string())
}

/// The `emulator` binary: SDK copy if found, otherwise rely on PATH.
fn emulator_program() -> String {
    tool_in_sdk("emulator", "emulator").unwrap_or_else(|| "emulator".to_string())
}

/// Turn a failed `Command::output()` (missing binary, etc.) into a friendly msg.
fn missing_tool(tool: &str, err: std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::NotFound {
        format!("`{tool}` was not found on your PATH. Install it and restart Soryq.")
    } else {
        format!("Failed to run `{tool}`: {err}")
    }
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/// The host OS: "macos", "windows", "linux", … . Used to gate the iOS panel.
#[tauri::command]
pub fn mobile_platform() -> String {
    std::env::consts::OS.to_string()
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct AndroidDevice {
    pub serial: String,
    pub state: String,
    /// Human label: emulator AVD name, or device model, falling back to serial.
    pub label: String,
}

#[derive(Serialize)]
pub struct AndroidTools {
    pub adb: bool,
    pub emulator: bool,
}

fn tool_present(program: &str, version_args: &[&str]) -> bool {
    quiet_command(program)
        .args(version_args)
        .output()
        .map(|o| o.status.success() || !o.stdout.is_empty())
        .unwrap_or(false)
}

/// Report whether `adb` and `emulator` are available on PATH.
#[tauri::command]
pub async fn android_check() -> AndroidTools {
    AndroidTools {
        adb: tool_present(&adb_program(), &["version"]),
        emulator: tool_present(&emulator_program(), &["-version"]),
    }
}

/// List attached devices and running emulators (`adb devices -l`).
#[tauri::command]
pub async fn android_list_devices() -> Result<Vec<AndroidDevice>, String> {
    let out = quiet_command(&adb_program())
        .args(["devices", "-l"])
        .output()
        .map_err(|e| missing_tool("adb", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut devices = Vec::new();
    for line in text.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let serial = match parts.next() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let state = parts.next().unwrap_or("unknown").to_string();
        // The remaining `key:value` fields carry model / device names.
        let mut model = String::new();
        for kv in parts {
            if let Some(v) = kv.strip_prefix("model:") {
                model = v.replace('_', " ");
            } else if model.is_empty() {
                if let Some(v) = kv.strip_prefix("device:") {
                    model = v.replace('_', " ");
                }
            }
        }
        let label = if serial.starts_with("emulator-") {
            // Try to resolve the running AVD's friendly name.
            android_avd_name(&serial).unwrap_or_else(|| serial.clone())
        } else if !model.is_empty() {
            model
        } else {
            serial.clone()
        };
        devices.push(AndroidDevice { serial, state, label });
    }
    Ok(devices)
}

/// Ask a running emulator for its AVD name (`adb -s <serial> emu avd name`).
fn android_avd_name(serial: &str) -> Option<String> {
    let out = quiet_command(&adb_program())
        .args(["-s", serial, "emu", "avd", "name"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && *l != "OK")
        .map(|s| s.to_string())
}

/// List installed AVDs available to launch (`emulator -list-avds`).
#[tauri::command]
pub async fn android_list_avds() -> Result<Vec<String>, String> {
    let out = quiet_command(&emulator_program())
        .args(["-list-avds"])
        .output()
        .map_err(|e| missing_tool("emulator", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect())
}

/// Boot an AVD in the background (`emulator -avd <name>`), detached so it keeps
/// running independently of this call.
#[tauri::command]
pub async fn android_launch_avd(name: String) -> Result<(), String> {
    quiet_command(&emulator_program())
        .args(["-avd", &name])
        .spawn()
        .map_err(|e| missing_tool("emulator", e))?;
    Ok(())
}

#[derive(Serialize)]
pub struct AndroidFrame {
    /// Base64 JPEG of the (downscaled) screen — no data-URL prefix.
    pub image: String,
    /// Original device pixel dimensions, so the UI can map taps to real
    /// coordinates even though the streamed image is downscaled.
    pub width: u32,
    pub height: u32,
}

/// Longest side (px) the streamed frame is downscaled to. The full device
/// resolution is far more than a panel needs and dominates the per-frame cost,
/// so shrinking it here is the single biggest smoothness win.
const FRAME_MAX_SIDE: u32 = 900;

/// Capture the device screen, downscale it, and return it as a base64 JPEG plus
/// the original device dimensions. `exec-out` avoids Windows newline mangling of
/// the raw PNG; the JPEG re-encode keeps the streamed payload small.
#[tauri::command]
pub async fn android_screencap(serial: String) -> Result<AndroidFrame, String> {
    let out = quiet_command(&adb_program())
        .args(["-s", &serial, "exec-out", "screencap", "-p"])
        .output()
        .map_err(|e| missing_tool("adb", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    if out.stdout.is_empty() {
        return Err("Empty screen capture (is the device unlocked?)".to_string());
    }

    let img = image::load_from_memory(&out.stdout)
        .map_err(|e| format!("Failed to decode capture: {e}"))?;
    let (width, height) = (img.width(), img.height());

    // Fit within FRAME_MAX_SIDE on the long edge, preserving aspect; only shrink.
    let scaled = if width.max(height) > FRAME_MAX_SIDE {
        img.resize(FRAME_MAX_SIDE, FRAME_MAX_SIDE, image::imageops::FilterType::Triangle)
    } else {
        img
    };

    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(scaled.to_rgb8())
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode frame: {e}"))?;

    Ok(AndroidFrame {
        image: base64::engine::general_purpose::STANDARD.encode(buf.get_ref()),
        width,
        height,
    })
}

fn adb_shell(serial: &str, args: &[&str]) -> Result<(), String> {
    let mut full = vec!["-s", serial, "shell"];
    full.extend_from_slice(args);
    let out = quiet_command(&adb_program())
        .args(&full)
        .output()
        .map_err(|e| missing_tool("adb", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Inject a tap at device coordinates.
#[tauri::command]
pub async fn android_tap(serial: String, x: i32, y: i32) -> Result<(), String> {
    adb_shell(&serial, &["input", "tap", &x.to_string(), &y.to_string()])
}

/// Inject a swipe between two device coordinates over `duration_ms`.
#[tauri::command]
pub async fn android_swipe(
    serial: String,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: i32,
) -> Result<(), String> {
    adb_shell(
        &serial,
        &[
            "input",
            "swipe",
            &x1.to_string(),
            &y1.to_string(),
            &x2.to_string(),
            &y2.to_string(),
            &duration_ms.to_string(),
        ],
    )
}

/// Inject a hardware key event by Android keycode (e.g. 4 = BACK, 3 = HOME).
#[tauri::command]
pub async fn android_key(serial: String, keycode: i32) -> Result<(), String> {
    adb_shell(&serial, &["input", "keyevent", &keycode.to_string()])
}

/// Type a string of text into the focused field.
#[tauri::command]
pub async fn android_text(serial: String, text: String) -> Result<(), String> {
    // `adb shell input text <arg>` is interpreted by the *device's* shell, so any
    // metacharacter in `text` (`;`, `$`, backtick, `|`, newline, …) would be
    // parsed by sh rather than typed. Encode spaces as %s (what `input text`
    // expects), then single-quote the whole argument for the device shell —
    // escaping embedded single quotes via the `'\''` idiom — so every character
    // reaches `input text` literally. (The host side never invokes a shell: adb
    // is run via Command::args, i.e. a raw argv.)
    let encoded = text.replace(' ', "%s");
    let quoted = format!("'{}'", encoded.replace('\'', "'\\''"));
    adb_shell(&serial, &["input", "text", &quoted])
}

// ---------------------------------------------------------------------------
// iOS (macOS only)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct IosSimulator {
    pub udid: String,
    pub name: String,
    pub state: String,
    pub runtime: String,
}

#[cfg(not(target_os = "macos"))]
fn require_macos() -> Result<(), String> {
    Err("The iOS Simulator is only available on macOS.".to_string())
}

#[cfg(target_os = "macos")]
fn require_macos() -> Result<(), String> {
    Ok(())
}

/// Whether iOS simulator tooling can run here (macOS + `xcrun simctl` present).
#[tauri::command]
pub async fn ios_available() -> bool {
    if cfg!(not(target_os = "macos")) {
        return false;
    }
    quiet_command("xcrun")
        .args(["simctl", "help"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// List available simulators grouped from `xcrun simctl list devices --json`.
#[tauri::command]
pub async fn ios_list_simulators() -> Result<Vec<IosSimulator>, String> {
    require_macos()?;
    let out = quiet_command("xcrun")
        .args(["simctl", "list", "devices", "available", "--json"])
        .output()
        .map_err(|e| missing_tool("xcrun", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    parse_simctl_devices(&String::from_utf8_lossy(&out.stdout))
}

/// Parse the `devices` map of `simctl list devices --json` into a flat list.
fn parse_simctl_devices(json: &str) -> Result<Vec<IosSimulator>, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse simctl output: {e}"))?;
    let mut sims = Vec::new();
    if let Some(map) = parsed.get("devices").and_then(|d| d.as_object()) {
        for (runtime, list) in map {
            // Runtime keys look like "com.apple.CoreSimulator.SimRuntime.iOS-17-0".
            let runtime_label = runtime
                .rsplit('.')
                .next()
                .unwrap_or(runtime)
                .replace('-', " ");
            if let Some(arr) = list.as_array() {
                for dev in arr {
                    let udid = dev.get("udid").and_then(|v| v.as_str()).unwrap_or("");
                    let name = dev.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let state = dev.get("state").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    if udid.is_empty() {
                        continue;
                    }
                    sims.push(IosSimulator {
                        udid: udid.to_string(),
                        name: name.to_string(),
                        state: state.to_string(),
                        runtime: runtime_label.clone(),
                    });
                }
            }
        }
    }
    Ok(sims)
}

fn simctl(args: &[&str]) -> Result<(), String> {
    require_macos()?;
    let mut full = vec!["simctl"];
    full.extend_from_slice(args);
    let out = quiet_command("xcrun")
        .args(&full)
        .output()
        .map_err(|e| missing_tool("xcrun", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Boot a simulator by UDID and reveal the Simulator app window.
#[tauri::command]
pub async fn ios_boot(udid: String) -> Result<(), String> {
    // `boot` errors if already booted; treat that as success.
    if let Err(e) = simctl(&["boot", &udid]) {
        if !e.to_lowercase().contains("booted") {
            return Err(e);
        }
    }
    // Bring up Simulator.app so the device is visible/interactive.
    let _ = quiet_command("open").args(["-a", "Simulator"]).output();
    Ok(())
}

/// Shut down a simulator by UDID.
#[tauri::command]
pub async fn ios_shutdown(udid: String) -> Result<(), String> {
    simctl(&["shutdown", &udid])
}

/// Open the Simulator app window (without booting a specific device).
#[tauri::command]
pub async fn ios_open_simulator() -> Result<(), String> {
    require_macos()?;
    quiet_command("open")
        .args(["-a", "Simulator"])
        .output()
        .map_err(|e| missing_tool("open", e))?;
    Ok(())
}

/// Capture a booted simulator's screen as base64 PNG (view-only mirror).
#[tauri::command]
pub async fn ios_screenshot(udid: String) -> Result<String, String> {
    require_macos()?;
    let out = quiet_command("xcrun")
        .args(["simctl", "io", &udid, "screenshot", "--type", "png", "-"])
        .output()
        .map_err(|e| missing_tool("xcrun", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    if out.stdout.is_empty() {
        return Err("Empty screenshot (is the simulator booted?)".to_string());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&out.stdout))
}

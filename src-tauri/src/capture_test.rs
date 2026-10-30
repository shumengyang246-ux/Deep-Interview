//! Debug-only integration probe. Captures only a 64x64 patch over synthetic test
//! windows, never a full desktop. It cannot be invoked through frontend IPC.
use std::{ptr::null_mut, time::Duration};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows_sys::Win32::Graphics::Gdi::*;

fn pause() {
    std::thread::sleep(Duration::from_millis(900));
}

fn sample(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    let pos = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let (x, y) = (
        pos.x + size.width as i32 / 2 - 32,
        pos.y + size.height as i32 / 2 - 32,
    );
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("GetDC failed".into());
        }
        let dc = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, 64, 64);
        if dc.is_null() || bitmap.is_null() {
            if !dc.is_null() {
                DeleteDC(dc);
            }
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            ReleaseDC(null_mut(), screen);
            return Err("Cannot create capture bitmap".into());
        }
        let old = SelectObject(dc, bitmap);
        let copied = BitBlt(dc, 0, 0, 64, 64, screen, x, y, SRCCOPY | CAPTUREBLT);
        SelectObject(dc, old);
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = 64;
        info.bmiHeader.biHeight = -64;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut pixels = vec![0u8; 64 * 64 * 4];
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            64,
            pixels.as_mut_ptr().cast(),
            &mut info,
            DIB_RGB_COLORS,
        );
        DeleteObject(bitmap);
        DeleteDC(dc);
        ReleaseDC(null_mut(), screen);
        if copied == 0 || lines != 64 {
            return Err("Desktop capture failed".into());
        }
        Ok(pixels)
    }
}
fn color_ratio(pixels: &[u8], rgb: [u8; 3]) -> f64 {
    pixels
        .chunks_exact(4)
        .filter(|p| {
            // Allow display color management to shift the synthetic colors.
            // Pink and pale green remain separated by >150 in the green channel.
            p[2].abs_diff(rgb[0]) <= 24
                && p[1].abs_diff(rgb[1]) <= 24
                && p[0].abs_diff(rgb[2]) <= 24
        })
        .count() as f64
        / 4096.0
}
fn save_ppm(name: &str, pixels: &[u8]) -> Result<(), String> {
    let mut data = b"P6\n64 64\n255\n".to_vec();
    for p in pixels.chunks_exact(4) {
        data.extend_from_slice(&[p[2], p[1], p[0]]);
    }
    std::fs::write(format!("artifacts/local/{name}.ppm"), data).map_err(|e| e.to_string())
}
fn execute(app: &AppHandle, window: &WebviewWindow) -> Result<serde_json::Value, String> {
    let enabled_at_startup = super::window_status(window.clone(), app.state())?.capture_excluded;
    // The probe uses its own configuration directory, never user preferences/history.
    window
        .set_size(tauri::LogicalSize::new(440., 650.))
        .map_err(|e| e.to_string())?;
    pause();
    let saved_size = window.inner_size().map_err(|e| e.to_string())?;
    let saved_position = window.outer_position().map_err(|e| e.to_string())?;
    let preferences = app.state::<super::ui_state::UiStore>();
    preferences.flush()?;
    let from_disk = preferences.reload_from_disk()?;
    window
        .set_size(tauri::LogicalSize::new(360., 540.))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(
            saved_position.x + 20,
            saved_position.y + 20,
        ))
        .map_err(|e| e.to_string())?;
    pause();
    from_disk.restore(window).map_err(|e| e.to_string())?;
    pause();
    let geometry_restored = window.inner_size().map_err(|e| e.to_string())? == saved_size
        && window.outer_position().map_err(|e| e.to_string())? == saved_position;
    // Exercise the same commands as the UI against the actual native window.
    let original_size = window.inner_size().map_err(|e| e.to_string())?;
    super::set_compact(window.clone(), app.state(), true)?;
    pause();
    let compact_size = window.inner_size().map_err(|e| e.to_string())?;
    super::set_compact(window.clone(), app.state(), false)?;
    pause();
    let restored_size = window.inner_size().map_err(|e| e.to_string())?;
    super::set_pinned(window.clone(), false)?;
    let unpinned = !window.is_always_on_top().map_err(|e| e.to_string())?;
    super::set_pinned(window.clone(), true)?;
    let pinned = window.is_always_on_top().map_err(|e| e.to_string())?;
    super::hide_window(window.clone())?;
    let hidden = !window.is_visible().map_err(|e| e.to_string())?;
    super::reveal(window).map_err(|e| e.to_string())?;
    let restored_visible = window.is_visible().map_err(|e| e.to_string())?;
    let shortcut_registered = app.state::<super::RuntimeState>().shortcut_error.is_none();
    let window_checks = geometry_restored
        && compact_size.height < original_size.height
        && restored_size == original_size
        && unpinned
        && pinned
        && hidden
        && restored_visible;
    let backdrop = WebviewWindowBuilder::new(
        app,
        "capture-backdrop",
        WebviewUrl::App("index.html#capture-backdrop".into()),
    )
    .title("Deep Interview · Synthetic capture background")
    .decorations(false)
    .inner_size(600., 800.)
    .always_on_top(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_secs(3));
    window.center().map_err(|e| e.to_string())?;
    // Replace all UI with synthetic pixels before temporarily disabling protection.
    window.eval("document.body.innerHTML='<div style=\"position:fixed;inset:0;background:#cf398b;color:white;padding:24px;font:16px sans-serif\">Deep Interview · Synthetic capture test</div>';").map_err(|e| e.to_string())?;
    pause();
    window.hide().map_err(|e| e.to_string())?;
    pause();
    let baseline = sample(window)?;
    window
        .set_content_protected(false)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    backdrop
        .set_always_on_top(false)
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    pause();
    let unprotected = sample(window)?;
    window
        .set_content_protected(true)
        .map_err(|e| e.to_string())?;
    pause();
    let protected = sample(window)?;
    let affinity = super::affinity(window)?;
    let background_ok = color_ratio(&baseline, [232, 237, 223]);
    let marker_before = color_ratio(&unprotected, [207, 57, 139]);
    let marker_after = color_ratio(&protected, [207, 57, 139]);
    let revealed_background = color_ratio(&protected, [232, 237, 223]);
    save_ppm("baseline", &baseline)?;
    save_ppm("unprotected", &unprotected)?;
    save_ppm("protected", &protected)?;
    let passed = window_checks
        && enabled_at_startup
        && background_ok > 0.95
        && marker_before > 0.95
        && marker_after < 0.01
        && revealed_background > 0.95
        && affinity == 0x11;
    backdrop.destroy().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "passed": passed, "capturePath": "GDI BitBlt SRCCOPY | CAPTUREBLT", "affinity": affinity,
        "windowChecksPassed": window_checks, "shortcutRegistered": shortcut_registered,
        "defaultEnabledAtStartup": enabled_at_startup,
        "geometryRestoredFromDisk": geometry_restored,
        "compactHeightPhysical": compact_size.height, "restoredHeightPhysical": restored_size.height,
        "pinTogglePassed": unpinned && pinned, "hideRestorePassed": hidden && restored_visible,
        "baselineBackgroundRatio": background_ok, "unprotectedMarkerRatio": marker_before,
        "protectedMarkerRatio": marker_after, "protectedBackgroundRatio": revealed_background,
        "scope": "64x64 synthetic patch on this machine only; not a meeting receiver test",
        "timestampUnix": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
    }))
}
pub fn start(app: AppHandle, window: WebviewWindow) {
    std::thread::spawn(move || {
        let result = std::fs::create_dir_all("artifacts/local")
            .map_err(|e| e.to_string())
            .and_then(|_| execute(&app, &window));
        // Always restore the protection flag, even on any intermediate failure.
        let _ = window.set_content_protected(true);
        if let Some(w) = app.get_webview_window("capture-backdrop") {
            let _ = w.destroy();
        }
        let report = result.unwrap_or_else(|e| serde_json::json!({"passed":false,"error":e}));
        let _ = std::fs::write(
            "artifacts/local/capture-report.json",
            serde_json::to_string_pretty(&report).unwrap(),
        );
        app.exit(if report["passed"] == true { 0 } else { 1 });
    });
}

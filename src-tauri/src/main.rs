#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    LogicalSize, Manager, PhysicalSize, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(all(windows, debug_assertions))]
mod capture_test;
mod credentials;
mod history;
mod llm;
mod memory;
mod settings;
mod storage;
mod ui_state;

struct RuntimeState {
    shortcut_error: Option<String>,
    expanded_size: Mutex<Option<PhysicalSize<u32>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowStatus {
    capture_excluded: bool,
    affinity: u32,
    always_on_top: bool,
    shortcut_registered: bool,
    shortcut_error: Option<String>,
}

#[cfg(windows)]
fn affinity(window: &WebviewWindow) -> Result<u32, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowDisplayAffinity;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut value = 0;
    if unsafe { GetWindowDisplayAffinity(hwnd.0 as _, &mut value) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(value)
}
#[cfg(not(windows))]
fn affinity(_: &WebviewWindow) -> Result<u32, String> {
    Ok(0)
}

#[tauri::command]
fn window_status(
    window: WebviewWindow,
    state: State<RuntimeState>,
) -> Result<WindowStatus, String> {
    let value = affinity(&window)?;
    Ok(WindowStatus {
        capture_excluded: value == 0x11,
        affinity: value,
        always_on_top: window.is_always_on_top().map_err(|e| e.to_string())?,
        shortcut_registered: state.shortcut_error.is_none(),
        shortcut_error: state.shortcut_error.clone(),
    })
}
#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}
#[tauri::command]
fn set_pinned(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}
#[tauri::command]
fn set_compact(
    window: WebviewWindow,
    state: State<RuntimeState>,
    compact: bool,
) -> Result<(), String> {
    let mut saved = state.expanded_size.lock().map_err(|e| e.to_string())?;
    if compact && saved.is_none() {
        let old = window.inner_size().map_err(|e| e.to_string())?;
        window
            .set_min_size(Some(LogicalSize::new(360., 64.)))
            .map_err(|e| e.to_string())?;
        window
            .set_size(LogicalSize::new(360., 64.))
            .map_err(|e| e.to_string())?;
        *saved = Some(old);
        window.set_resizable(false).map_err(|e| e.to_string())?;
    } else if !compact {
        if let Some(size) = *saved {
            window.set_resizable(true).map_err(|e| e.to_string())?;
            window.set_size(size).map_err(|e| e.to_string())?;
            window
                .set_min_size(Some(LogicalSize::new(360., 540.)))
                .map_err(|e| e.to_string())?;
            *saved = None;
        }
    }
    Ok(())
}
fn reveal(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_content_protected(true)?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()
}
fn toggle(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_visible()? {
        window.hide()
    } else {
        reveal(window)
    }
}
fn main() {
    tauri::Builder::default()
        .manage(llm::ChatState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = reveal(&w);
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            if let Err(e) = toggle(&w) {
                                eprintln!("Shortcut: {e}");
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let mut config_dir = app.path().app_config_dir()?;
            #[cfg(debug_assertions)]
            if std::env::args().any(|a| a == "--capture-self-test") {
                config_dir = config_dir.join("capture-probe");
            }
            let prompt_path = settings::locate_prompt(&std::env::current_exe()?, &config_dir);
            app.manage(
                settings::AssistantConfig::new(prompt_path, &config_dir)
                    .map_err(std::io::Error::other)?,
            );
            app.manage(history::HistoryStore::new(
                config_dir.join("conversations.json"),
            ));
            app.manage(
                ui_state::UiStore::new(config_dir.join("ui-settings.json"))
                    .map_err(std::io::Error::other)?,
            );
            let window = app.get_webview_window("main").expect("main window");
            window.set_content_protected(true)?;
            app.state::<ui_state::UiStore>().restore(&window)?;
            let shortcut_error = app
                .global_shortcut()
                .register("Ctrl+Shift+Space")
                .err()
                .map(|e| e.to_string());
            app.manage(RuntimeState {
                shortcut_error,
                expanded_size: Mutex::new(None),
            });
            let show = MenuItem::with_id(
                app,
                "show",
                "显示 / 隐藏  Ctrl+Shift+Space",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "退出 Deep Interview", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut pixels = vec![0u8; 32 * 32 * 4];
            for y in 3..29 {
                for x in 3..29 {
                    if !(15..=16).contains(&x) && !(15..=16).contains(&y) {
                        let i = (y * 32 + x) * 4;
                        pixels[i..i + 4].copy_from_slice(&[104, 140, 109, 255]);
                    }
                }
            }
            TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(pixels, 32, 32))
                .tooltip("Deep Interview · Ctrl+Shift+Space")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    } else if event.id.as_ref() == "show" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = toggle(&w);
                        }
                    }
                })
                .build(app)?;
            window.show()?;
            #[cfg(all(windows, debug_assertions))]
            if std::env::args().any(|a| a == "--capture-self-test") {
                capture_test::start(app.handle().clone(), window.clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                ui_state::record(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            window_status,
            hide_window,
            set_pinned,
            set_compact,
            llm::model_status,
            llm::save_api_key,
            llm::delete_api_key,
            llm::start_chat,
            llm::cancel_chat,
            settings::assistant_settings,
            settings::set_thinking,
            settings::open_system_prompt,
            history::load_conversations,
            history::save_conversations,
            ui_state::ui_settings,
            ui_state::set_appearance
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start Deep Interview")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                if let Some(store) = app.try_state::<ui_state::UiStore>() {
                    if let Err(e) = store.flush() {
                        eprintln!("{e}");
                    }
                }
            }
        });
}

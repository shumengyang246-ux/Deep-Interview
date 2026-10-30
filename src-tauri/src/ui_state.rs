use crate::storage;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Light,
    Dark,
    System,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Appearance {
    pub theme: Theme,
    pub opacity: u8,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: Theme::Light,
            opacity: 97,
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
struct Preferences {
    appearance: Appearance,
    geometry: Option<Geometry>,
}
pub struct UiStore {
    path: PathBuf,
    data: Mutex<Preferences>,
    revision: AtomicU64,
}
impl UiStore {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        let data = storage::read_json::<Preferences>(&path, 16384)?.unwrap_or_default();
        if !(75..=100).contains(&data.appearance.opacity) {
            return Err("主题配置中的透明度无效。".into());
        }
        Ok(Self {
            path,
            data: Mutex::new(data),
            revision: AtomicU64::new(0),
        })
    }
    pub fn flush(&self) -> Result<(), String> {
        let data = self.data.lock().map_err(|_| "窗口配置状态异常。")?;
        storage::write_json(&self.path, &*data, 16384)
    }
    fn set_appearance(&self, appearance: Appearance) -> Result<(), String> {
        if !(75..=100).contains(&appearance.opacity) {
            return Err("不透明度必须在 75–100 之间。".into());
        }
        let mut data = self.data.lock().map_err(|_| "窗口配置状态异常。")?;
        let mut updated = data.clone();
        updated.appearance = appearance;
        storage::write_json(&self.path, &updated, 16384)?;
        *data = updated;
        Ok(())
    }
    pub fn geometry(&self) -> Option<Geometry> {
        self.data.lock().ok()?.geometry
    }
    #[cfg(debug_assertions)]
    pub fn reload_from_disk(&self) -> Result<Self, String> {
        Self::new(self.path.clone())
    }
    pub fn restore(&self, window: &WebviewWindow) -> tauri::Result<()> {
        let Some(saved) = self.geometry() else {
            return Ok(());
        };
        let monitors = window.available_monitors()?;
        let monitor = monitors
            .iter()
            .find(|m| {
                let a = m.work_area();
                saved.x as i64 >= a.position.x as i64
                    && (saved.x as i64) < a.position.x as i64 + a.size.width as i64
                    && saved.y as i64 >= a.position.y as i64
                    && (saved.y as i64) < a.position.y as i64 + a.size.height as i64
            })
            .cloned()
            .or(window.primary_monitor()?);
        if let Some(m) = monitor {
            let area = m.work_area();
            let g = fit(
                saved,
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
                m.scale_factor(),
            );
            window.set_min_size(Some(LogicalSize::new(
                360f64.min(area.size.width as f64 / m.scale_factor()),
                540f64.min(area.size.height as f64 / m.scale_factor()),
            )))?;
            window.set_position(PhysicalPosition::new(g.x, g.y))?;
            window.set_size(LogicalSize::new(g.width, g.height))?;
        } else {
            window.center()?;
        }
        Ok(())
    }
}

// Physical position + logical dimensions survive DPI changes. Keep the title bar on a connected display.
fn fit(g: Geometry, x: i32, y: i32, w: u32, h: u32, scale: f64) -> Geometry {
    let max_w = w as f64 / scale;
    let max_h = h as f64 / scale;
    let width = if g.width.is_finite() { g.width } else { 420. }.clamp(360f64.min(max_w), max_w);
    let height = if g.height.is_finite() { g.height } else { 670. }.clamp(540f64.min(max_h), max_h);
    Geometry {
        x: g.x.clamp(x, x + (w as f64 - width * scale).max(0.) as i32),
        y: g.y.clamp(y, y + (h as f64 - height * scale).max(0.) as i32),
        width,
        height,
    }
}

pub fn record(window: &tauri::Window) {
    if window.label() != "main"
        || window.is_minimized().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
    {
        return;
    }
    let Some(store) = window.try_state::<UiStore>() else {
        return;
    };
    let Some(runtime) = window.try_state::<crate::RuntimeState>() else {
        return;
    };
    let Ok(expanded) = runtime.expanded_size.try_lock() else {
        return;
    };
    let (Ok(position), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let Ok(mut data) = store.data.lock() else {
        return;
    };
    let size = expanded.unwrap_or(size);
    // Ignore initialization and intermediate compact resize events.
    if size.height as f64 / scale < 300. {
        return;
    }
    data.geometry = Some(Geometry {
        x: position.x,
        y: position.y,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    });
    drop(data);
    let revision = store.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        let store = app.state::<UiStore>();
        if store.revision.load(Ordering::SeqCst) == revision {
            if let Err(e) = store.flush() {
                eprintln!("{e}");
            }
        }
    });
}
#[tauri::command]
pub fn ui_settings(store: State<UiStore>) -> Result<Appearance, String> {
    Ok(store
        .data
        .lock()
        .map_err(|_| "窗口配置状态异常。")?
        .appearance
        .clone())
}
#[tauri::command]
pub fn set_appearance(appearance: Appearance, store: State<UiStore>) -> Result<(), String> {
    store.set_appearance(appearance)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appearance_and_geometry_survive_reload_and_merge() {
        let dir = storage::test_dir();
        let path = dir.join("ui.json");
        let store = UiStore::new(path.clone()).unwrap();
        let g = Geometry {
            x: 120,
            y: 200,
            width: 460.,
            height: 720.,
        };
        store.data.lock().unwrap().geometry = Some(g);
        store
            .set_appearance(Appearance {
                theme: Theme::Dark,
                opacity: 85,
            })
            .unwrap();
        let restored = UiStore::new(path).unwrap();
        assert_eq!(restored.geometry(), Some(g));
        assert!(matches!(
            restored.data.lock().unwrap().appearance.theme,
            Theme::Dark
        ));
        assert_eq!(restored.data.lock().unwrap().appearance.opacity, 85);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn offscreen_and_oversized_geometry_is_clamped_for_dpi() {
        let g = fit(
            Geometry {
                x: 9000,
                y: -9000,
                width: 4000.,
                height: 4000.,
            },
            -1920,
            0,
            1920,
            1080,
            2.,
        );
        assert_eq!(
            g,
            Geometry {
                x: -1920,
                y: 0,
                width: 960.,
                height: 540.
            }
        );
    }
}

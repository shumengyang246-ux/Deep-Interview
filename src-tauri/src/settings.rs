use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

const DEFAULT_PROMPT: &str = "你是一位可靠、清晰、耐心的私人 AI 助手。默认使用中文回答，先回应核心问题，不编造事实或来源。\n";
const PROMPT_LIMIT: u64 = 64 * 1024;
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Thinking {
    #[default]
    Off,
    Low,
    High,
    Max,
}
impl Thinking {
    pub fn max_tokens(self) -> u32 {
        match self {
            Self::Off => 4096,
            Self::Low => 8192,
            Self::High => 16384,
            Self::Max => 32768,
        }
    }
    pub fn timeout_seconds(self) -> u64 {
        if self == Self::Off {
            180
        } else {
            600
        }
    }
    pub fn apply(self, body: &mut serde_json::Value) {
        body["thinking"] =
            serde_json::json!({"type": if self == Self::Off { "disabled" } else { "enabled" }});
        if self != Self::Off {
            body["reasoning_effort"] = serde_json::to_value(self).expect("enum serialization");
        }
    }
}
#[derive(Clone, Default, Deserialize, Serialize)]
struct Preferences {
    #[serde(default)]
    thinking: Thinking,
    #[serde(default, rename = "webSearch")]
    web_search: bool,
}
pub struct AssistantConfig {
    pub prompt_path: PathBuf,
    preferences_path: PathBuf,
    preferences: Mutex<Preferences>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    thinking: Thinking,
    web_search: bool,
    prompt_path: String,
    prompt_characters: Option<usize>,
    prompt_preview: String,
    prompt_error: Option<String>,
}

pub fn locate_prompt(executable: &Path, config_dir: &Path) -> PathBuf {
    // Locate the checked-out project, never depend on the launcher's working directory.
    for parent in executable.ancestors().skip(1) {
        if parent.join("src-tauri/tauri.conf.json").is_file()
            && parent.join("package.json").is_file()
        {
            return parent.join("system-prompt.txt");
        }
    }
    config_dir.join("system-prompt.txt")
}
pub fn read_prompt(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|_| format!("无法读取系统提示词文件，请检查：{}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(PROMPT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取系统提示词失败，请保存文件后重试。")?;
    if bytes.len() as u64 > PROMPT_LIMIT {
        return Err("系统提示词文件超过 64 KiB，请精简后重试。".into());
    }
    let text =
        String::from_utf8(bytes).map_err(|_| "系统提示词必须使用 UTF-8 编码，请重新保存文件。")?;
    Ok(text.trim_start_matches('\u{feff}').trim().to_string())
}
impl AssistantConfig {
    pub fn new(prompt_path: PathBuf, config_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(config_dir).map_err(|_| "无法创建助手配置目录。")?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&prompt_path)
        {
            Ok(mut f) => f
                .write_all(DEFAULT_PROMPT.as_bytes())
                .map_err(|_| "无法创建系统提示词文件。")?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(format!("无法创建系统提示词文件：{}", prompt_path.display())),
        }
        let preferences_path = config_dir.join("assistant-settings.json");
        let preferences: Preferences = match fs::read(&preferences_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
                format!(
                    "助手配置文件格式无效，请检查：{}",
                    preferences_path.display()
                )
            })?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(_) => return Err("无法读取助手配置文件。".into()),
        };
        Ok(Self {
            prompt_path,
            preferences_path,
            preferences: Mutex::new(preferences),
        })
    }
    pub fn snapshot(&self) -> Result<(Thinking, String, bool), String> {
        let prefs = self.preferences.lock().map_err(|_| "助手设置状态异常。")?;
        Ok((
            prefs.thinking,
            read_prompt(&self.prompt_path)?,
            prefs.web_search,
        ))
    }
    fn info(&self) -> Result<SettingsInfo, String> {
        let prefs = self.preferences.lock().map_err(|_| "助手设置状态异常。")?;
        let (prompt_characters, prompt_preview, prompt_error) = match read_prompt(&self.prompt_path)
        {
            Ok(text) => (
                Some(text.chars().count()),
                text.chars().take(300).collect(),
                None,
            ),
            Err(e) => (None, String::new(), Some(e)),
        };
        Ok(SettingsInfo {
            thinking: prefs.thinking,
            web_search: prefs.web_search,
            prompt_path: self.prompt_path.to_string_lossy().into_owned(),
            prompt_characters,
            prompt_preview,
            prompt_error,
        })
    }
    fn save_thinking(&self, thinking: Thinking) -> Result<(), String> {
        self.update(|prefs| prefs.thinking = thinking)
    }
    fn save_web_search(&self, enabled: bool) -> Result<(), String> {
        self.update(|prefs| prefs.web_search = enabled)
    }
    fn update(&self, change: impl FnOnce(&mut Preferences)) -> Result<(), String> {
        let mut current = self.preferences.lock().map_err(|_| "助手设置状态异常。")?;
        let mut next = current.clone();
        change(&mut next);
        crate::storage::write_json(&self.preferences_path, &next, 16384)?;
        *current = next;
        Ok(())
    }
}
#[tauri::command]
pub fn assistant_settings(config: State<AssistantConfig>) -> Result<SettingsInfo, String> {
    config.info()
}
#[tauri::command]
pub fn set_thinking(
    thinking: Thinking,
    config: State<AssistantConfig>,
) -> Result<SettingsInfo, String> {
    config.save_thinking(thinking)?;
    config.info()
}
#[tauri::command]
pub fn set_web_search(
    enabled: bool,
    config: State<AssistantConfig>,
) -> Result<SettingsInfo, String> {
    config.save_web_search(enabled)?;
    config.info()
}
#[tauri::command]
pub fn open_system_prompt(config: State<AssistantConfig>) -> Result<(), String> {
    std::process::Command::new("notepad.exe")
        .arg(&config.prompt_path)
        .spawn()
        .map_err(|_| "无法打开记事本，请手动打开界面中显示的文件路径。")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "deep-interview-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn prompt_location_follows_executable_instead_of_working_directory() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join("src-tauri/target/debug")).unwrap();
        fs::write(dir.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        fs::write(dir.join("package.json"), "{}").unwrap();
        let config_dir = dir.join("user-config");
        assert_eq!(
            locate_prompt(&dir.join("src-tauri/target/debug/app.exe"), &config_dir),
            dir.join("system-prompt.txt")
        );
        fs::remove_file(dir.join("package.json")).unwrap();
        assert_eq!(
            locate_prompt(&dir.join("app.exe"), &config_dir),
            config_dir.join("system-prompt.txt")
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn prompt_reload_preserves_user_edits_handles_bom_and_rejects_bad_files() {
        let dir = temp_dir();
        let path = dir.join("system-prompt.txt");
        fs::write(&path, "用户自己写的提示词").unwrap();
        let config = AssistantConfig::new(path.clone(), &dir).unwrap();
        assert_eq!(config.snapshot().unwrap().1, "用户自己写的提示词");
        fs::write(&path, "\u{feff} 新的指令\n").unwrap();
        assert_eq!(config.snapshot().unwrap().1, "新的指令");
        fs::write(&path, " \n").unwrap();
        assert!(config.snapshot().unwrap().1.is_empty());
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(config.snapshot().is_err());
        fs::write(&path, vec![b'x'; PROMPT_LIMIT as usize + 1]).unwrap();
        assert!(config.snapshot().is_err());
        fs::remove_file(&path).unwrap();
        assert!(config.snapshot().is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn thinking_persists_on_restart_and_replaces_previous_selection() {
        let dir = temp_dir();
        let path = dir.join("system-prompt.txt");
        let config = AssistantConfig::new(path.clone(), &dir).unwrap();
        config.save_thinking(Thinking::High).unwrap();
        config.save_thinking(Thinking::Max).unwrap();
        let restarted = AssistantConfig::new(path, &dir).unwrap();
        assert_eq!(restarted.snapshot().unwrap().0, Thinking::Max);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn search_preference_migrates_persists_and_rolls_back_on_write_failure() {
        let dir = temp_dir();
        let path = dir.join("system-prompt.txt");
        let prefs = dir.join("assistant-settings.json");
        fs::write(&prefs, r#"{"thinking":"high"}"#).unwrap();
        let config = AssistantConfig::new(path.clone(), &dir).unwrap();
        assert!(!config.snapshot().unwrap().2);
        config.save_web_search(true).unwrap();
        config.save_thinking(Thinking::Low).unwrap();
        let restored = AssistantConfig::new(path, &dir).unwrap();
        assert!(restored.snapshot().unwrap().2);
        assert_eq!(restored.snapshot().unwrap().0, Thinking::Low);
        fs::remove_file(&prefs).unwrap();
        fs::create_dir(&prefs).unwrap();
        assert!(restored.save_web_search(false).is_err());
        assert!(restored.snapshot().unwrap().2);
        fs::remove_dir_all(dir).unwrap();
    }
}

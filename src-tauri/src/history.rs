use crate::storage;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf, sync::Mutex};
use tauri::State;
const LIMIT: usize = 25 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMessage {
    id: String,
    role: String,
    text: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<bool>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    id: String,
    title: String,
    created_at: u64,
    updated_at: u64,
    messages: Vec<SavedMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    memory: Option<crate::memory::Memory>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    version: u32,
    active_session_id: String,
    sessions: Vec<Conversation>,
}
impl Archive {
    fn validate(&self) -> Result<(), String> {
        let mut ids = HashSet::new();
        if self.version != 1 || self.sessions.is_empty() || self.sessions.len() > 500 {
            return Err("历史会话格式不支持或超过 500 个会话，请整理后重试。".into());
        }
        for session in &self.sessions {
            if session.memory.as_ref().is_some_and(|m| !m.valid_shape()) {
                return Err("会话记忆格式异常，原始历史已保留。".into());
            }
            if session.id.is_empty()
                || session.id.len() > 80
                || !ids.insert(&session.id)
                || session.title.len() > 300
                || session.messages.len() > 10000
            {
                return Err("历史会话格式异常或过长，原文件已保留。".into());
            }
            let mut message_ids = HashSet::new();
            for m in &session.messages {
                if m.id.is_empty()
                    || m.id.len() > 80
                    || !message_ids.insert(&m.id)
                    || !matches!(m.role.as_str(), "user" | "assistant")
                    || !matches!(
                        m.status.as_str(),
                        "complete" | "streaming" | "error" | "cancelled"
                    )
                {
                    return Err("历史消息格式异常，原文件已保留。".into());
                }
            }
        }
        if !ids.contains(&self.active_session_id) {
            return Err("历史会话缺少当前会话。".into());
        }
        Ok(())
    }
    fn recover(&mut self) {
        for s in &mut self.sessions {
            for m in &mut s.messages {
                if m.status == "streaming" {
                    m.status = "cancelled".into();
                    m.note = Some("上次生成因应用关闭而中断，已保留收到的内容。".into());
                }
            }
        }
    }
}
pub struct HistoryStore {
    path: PathBuf,
    lock: Mutex<()>,
}
impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }
    fn load(&self) -> Result<Option<Archive>, String> {
        let _guard = self.lock.lock().map_err(|_| "历史存储状态异常。")?;
        let mut archive = storage::read_json::<Archive>(&self.path, LIMIT as u64)?;
        if let Some(a) = &mut archive {
            a.validate()?;
            a.recover();
        }
        Ok(archive)
    }
    fn save(&self, archive: &Archive) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "历史存储状态异常。")?;
        archive.validate()?;
        storage::write_json(&self.path, archive, LIMIT)
    }
}
#[tauri::command]
pub fn load_conversations(store: State<HistoryStore>) -> Result<Option<Archive>, String> {
    store.load()
}
#[tauri::command]
pub fn save_conversations(archive: Archive, store: State<HistoryStore>) -> Result<(), String> {
    store.save(&archive)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_recovery_delete_and_corrupt_file_preservation() {
        let dir = storage::test_dir();
        let path = dir.join("conversations.json");
        let store = HistoryStore::new(path.clone());
        assert!(store.load().unwrap().is_none());
        let mut archive: Archive = serde_json::from_value(serde_json::json!({"version":1,"activeSessionId":"a","sessions":[{"id":"a","title":"中文标题","createdAt":1,"updatedAt":2,"messages":[{"id":"m","role":"assistant","text":"部分回复","status":"streaming"}]},{"id":"b","title":"第二个会话","createdAt":2,"updatedAt":2,"messages":[]}]})).unwrap();
        store.save(&archive).unwrap();
        let restored = HistoryStore::new(path.clone()).load().unwrap().unwrap();
        assert_eq!(restored.sessions[0].messages[0].status, "cancelled");
        assert_eq!(restored.sessions[0].messages[0].text, "部分回复");
        archive.sessions[0].memory = Some(crate::memory::Memory {
            version: 1,
            summary: "保留的用户目标".into(),
            covered_messages: 2,
            digest: "a".repeat(64),
            updated_at: 123,
        });
        store.save(&archive).unwrap();
        assert_eq!(
            store.load().unwrap().unwrap().sessions[0]
                .memory
                .as_ref()
                .unwrap()
                .summary,
            "保留的用户目标"
        );
        archive.sessions.remove(0);
        archive.active_session_id = "b".into();
        store.save(&archive).unwrap();
        assert_eq!(store.load().unwrap().unwrap().sessions.len(), 1);
        archive.sessions[0].id = "bad".into();
        assert!(store.save(&archive).is_err());
        assert_eq!(store.load().unwrap().unwrap().sessions[0].id, "b");
        std::fs::write(&path, b"broken json").unwrap();
        assert!(store.load().is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"broken json");
        std::fs::remove_dir_all(dir).unwrap();
    }
}

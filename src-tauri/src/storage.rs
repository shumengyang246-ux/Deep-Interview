use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

pub fn read_json<T: DeserializeOwned>(path: &Path, limit: u64) -> Result<Option<T>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(format!("无法读取本机文件：{}", path.display())),
    };
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取本机文件失败。")?;
    if bytes.len() as u64 > limit {
        return Err("本机文件过大，请备份后整理历史会话。".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| format!("本机文件格式错误，原文件已保留：{}", path.display()))
}

// Callers serialize writes under their state lock. Never truncate the last good file.
pub fn write_json(path: &Path, value: &impl Serialize, limit: usize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "无法编码本机数据。")?;
    if bytes.len() > limit {
        return Err("本机历史已达到 25 MiB，请删除不需要的会话后重试保存。".into());
    }
    let temp = path.with_extension("tmp");
    let mut file =
        fs::File::create(&temp).map_err(|_| "无法写入本机数据，请检查磁盘空间和目录权限。")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "本机数据保存失败，原文件已保留。")?;
    drop(file);
    fs::rename(temp, path).map_err(|_| "无法更新本机数据文件，原文件已保留。".to_string())
}

#[cfg(test)]
pub fn test_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "deep-interview-store-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

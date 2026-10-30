//! Only Windows Credential Manager persists the key. No command returns it to JS.
use windows_sys::Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*};
const TARGET: &str = "com.deepinterview.assistant/deepseek";
fn target() -> Vec<u16> {
    TARGET.encode_utf16().chain(Some(0)).collect()
}
pub fn read() -> Result<Option<String>, String> {
    let name = target();
    let mut credential = std::ptr::null_mut();
    unsafe {
        if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
            let err = std::io::Error::last_os_error();
            return if err.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                Ok(None)
            } else {
                Err("无法读取 Windows 凭据管理器。".into())
            };
        }
        let size = (*credential).CredentialBlobSize as usize;
        let result = if size == 0 {
            Ok(None)
        } else {
            String::from_utf8(
                std::slice::from_raw_parts((*credential).CredentialBlob, size).to_vec(),
            )
            .map(Some)
            .map_err(|_| "保存的 Key 格式异常，请重新保存。".into())
        };
        CredFree(credential.cast());
        result
    }
}
pub fn save(key: &str) -> Result<(), String> {
    let key = key.trim();
    if !key.starts_with("sk-")
        || key.len() < 12
        || key.len() > 512
        || !key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("请输入有效格式的 DeepSeek API Key。".into());
    }
    let mut name = target();
    let mut username: Vec<u16> = "DeepSeek".encode_utf16().chain(Some(0)).collect();
    let mut bytes = key.as_bytes().to_vec();
    let mut c: CREDENTIALW = unsafe { std::mem::zeroed() };
    c.Type = CRED_TYPE_GENERIC;
    c.TargetName = name.as_mut_ptr();
    c.UserName = username.as_mut_ptr();
    c.CredentialBlobSize = bytes.len() as u32;
    c.CredentialBlob = bytes.as_mut_ptr();
    c.Persist = CRED_PERSIST_LOCAL_MACHINE;
    let ok = unsafe { CredWriteW(&c, 0) } != 0;
    bytes.fill(0);
    if ok {
        Ok(())
    } else {
        Err("无法保存到 Windows 凭据管理器。".into())
    }
}
pub fn delete() -> Result<(), String> {
    let name = target();
    if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
        && std::io::Error::last_os_error().raw_os_error() != Some(ERROR_NOT_FOUND as i32)
    {
        return Err("无法删除本机 API Key。".into());
    }
    Ok(())
}

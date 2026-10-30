import { useState } from "react";
import { command, desktop } from "./native";
export type ModelStatus = { hasKey: boolean; model: string; endpoint: string };
export function ModelSettings({
  status,
  refresh,
  disabled,
}: {
  status: ModelStatus | null;
  refresh: () => Promise<void>;
  disabled: boolean;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function save(remove = false) {
    setBusy(true);
    setNotice("");
    try {
      await command(
        remove ? "delete_api_key" : "save_api_key",
        remove ? undefined : { key },
      );
      setKey("");
      await refresh();
      setNotice(
        remove
          ? "已删除本机保存的 Key。"
          : "已安全保存，可以返回对话开始提问。",
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="api-card">
      <span className="eyebrow">DEEPSEEK · OFFICIAL API</span>
      <h3>DeepSeek V4.1 Flash · 1017</h3>
      <p>
        官方模型标识：deepseek-flash
        <br />
        可选思考程度 · 流式输出 · 联网检索 · 会话记忆
      </p>
      <label htmlFor="api-key">
        API Key{" "}
        <span>
          {status?.hasKey ? "已保存至 Windows 凭据管理器" : "尚未配置"}
        </span>
      </label>
      <input
        id="api-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={
          status?.hasKey
            ? "输入新的 Key 可替换现有凭据"
            : "输入你的 DeepSeek API Key"
        }
        value={key}
        maxLength={512}
        disabled={busy || disabled || !desktop}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className="api-actions">
        <button
          disabled={!key.trim() || busy || disabled || !desktop}
          onClick={() => void save()}
        >
          {busy ? "处理中…" : "保存 Key"}
        </button>
        <button
          className="secondary"
          disabled={!status?.hasKey || busy || disabled}
          onClick={() => void save(true)}
        >
          删除本机 Key
        </button>
      </div>
      {notice && (
        <p className="api-notice" role="status">
          {notice}
        </p>
      )}
      <p className="api-footnote">
        仅发送系统提示词、你提交的文字与对话上下文到 DeepSeek
        官网。开启联网后，还会向其搜索接口发送模型生成的检索词。
        不采集屏幕、摄像头或麦克风。历史会话保存在本机，可在「历史」中删除。
      </p>
    </div>
  );
}

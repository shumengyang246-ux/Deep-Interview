import { useState } from "react";
import { command, desktop } from "./native";
export type Thinking = "off" | "low" | "high" | "max";
export type AssistantSettingsInfo = {
  thinking: Thinking;
  promptPath: string;
  promptCharacters: number | null;
  promptPreview: string;
  promptError: string | null;
};
export const thinkingOptions: { value: Thinking; label: string }[] = [
  { value: "off", label: "不思考 · 快速回答" },
  { value: "low", label: "低 · 轻量思考" },
  { value: "high", label: "高 · 深入思考" },
  { value: "max", label: "最高 · 充分推理" },
];
export function ThinkingPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: Thinking;
  onChange: (value: Thinking) => void;
  disabled: boolean;
  id: string;
}) {
  return (
    <div className="thinking-picker">
      <label htmlFor={id}>思考程度</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as Thinking)}
        disabled={disabled}
      >
        {thinkingOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
export function PromptSettings({
  info,
  refresh,
  disabled,
}: {
  info: AssistantSettingsInfo | null;
  refresh: () => Promise<void>;
  disabled: boolean;
}) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(open: boolean) {
    setBusy(true);
    setNotice("");
    try {
      if (open) await command("open_system_prompt");
      else await refresh();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="api-card prompt-card">
      <span className="eyebrow">YOUR ASSISTANT, YOUR INSTRUCTIONS</span>
      <h3>系统提示词</h3>
      <p>
        每次提问都会重新读取这个文件，作为首条系统消息发送。修改保存后，下一条消息生效。
      </p>
      <div className="prompt-path" aria-label="系统提示词文件路径">
        {info?.promptPath || "在桌面应用中查看文件位置"}
      </div>
      <div className="api-actions">
        <button
          disabled={disabled || busy || !desktop || !info}
          onClick={() => void action(true)}
        >
          打开提示词文件
        </button>
        <button
          className="secondary"
          disabled={busy || !desktop}
          onClick={() => void action(false)}
        >
          刷新预览
        </button>
      </div>
      {info?.promptError && (
        <p className="message-note error" role="alert">
          {info.promptError}
        </p>
      )}
      {notice && (
        <p className="message-note error" role="alert">
          {notice}
        </p>
      )}
      <details>
        <summary>已读取 {info?.promptCharacters ?? "—"} 字 · 查看预览</summary>
        <pre>{info?.promptPreview || "文件留空时，不附加系统提示词。"}</pre>
      </details>
      <p className="api-footnote">
        UTF-8 文本，最多 64 KiB；预览显示前 300
        字。当前已开始的回答不受文件修改影响。
      </p>
    </div>
  );
}

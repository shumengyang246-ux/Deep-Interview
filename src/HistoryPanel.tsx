import { useState } from "react";
import { Trash2, MessageSquare } from "lucide-react";
import type { Conversation } from "./chatData";
export function HistoryPanel({
  sessions,
  activeId,
  disabled,
  onSelect,
  onDelete,
}: {
  sessions: Conversation[];
  activeId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="history-panel" aria-label="历史会话">
      <div className="section-heading">
        <span className="eyebrow">YOUR CONVERSATIONS</span>
        <h2>接着上次的想法</h2>
        <p>会话自动保存到本机。生成期间请先停止，再切换或删除。</p>
      </div>
      <div className="history-list">
        {[...sessions]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((s) => (
            <article
              className={`history-item ${s.id === activeId ? "current" : ""}`}
              key={s.id}
            >
              <button
                className="history-open"
                disabled={disabled}
                onClick={() => onSelect(s.id)}
                aria-label={`打开会话：${s.title}`}
              >
                <MessageSquare size={16} />
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {new Date(s.updatedAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {s.messages.filter((m) => m.role === "user").length}{" "}
                    条提问{s.id === activeId ? " · 当前" : ""}
                  </small>
                </span>
              </button>
              <button
                className="icon-button"
                disabled={disabled}
                aria-label={`删除会话：${s.title}`}
                onClick={() => setConfirm(s.id)}
              >
                <Trash2 size={14} />
              </button>
              {confirm === s.id && (
                <div className="delete-confirm">
                  <span>删除这个会话及其本机记录？</span>
                  <button
                    disabled={disabled}
                    onClick={() => {
                      onDelete(s.id);
                      setConfirm(null);
                    }}
                  >
                    确认删除
                  </button>
                  <button onClick={() => setConfirm(null)}>取消</button>
                </div>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}

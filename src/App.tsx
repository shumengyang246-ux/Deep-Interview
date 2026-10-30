import { useEffect, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Square,
  Plus,
  Expand,
  Grip,
  MessageSquare,
  Minus,
  Pin,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  History,
  ArrowDown,
  Globe,
} from "lucide-react";
import { command, desktop, type WindowStatus } from "./native";
import { useChat } from "./useChat";
import { ModelSettings, type ModelStatus } from "./ModelSettings";
import { CopyButton, MessageContent } from "./MessageContent";
import { HistoryPanel } from "./HistoryPanel";
import { useAppearance, type Appearance } from "./useAppearance";
import { useFollowOutput } from "./useFollowOutput";
import { SearchSources } from "./SearchSources";
import {
  ThinkingPicker,
  PromptSettings,
  thinkingOptions,
  type Thinking,
  type AssistantSettingsInfo,
} from "./AssistantSettings";

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mark ${small ? "small" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
export default function App() {
  const [tab, setTab] = useState<"chat" | "history" | "settings">("chat");
  const [status, setStatus] = useState<WindowStatus | null>(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const appearance = useAppearance();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [assistant, setAssistant] = useState<AssistantSettingsInfo | null>(
    null,
  );
  const [savingThinking, setSavingThinking] = useState(false);
  const chat = useChat(assistant?.webSearch ?? false);
  const { messages, streaming } = chat;
  const scroll = useFollowOutput(
    messages,
    chat.activeSessionId,
    tab === "chat" && !collapsed,
  );
  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
  }
  async function refresh() {
    setStatus(await command<WindowStatus>("window_status"));
  }
  async function refreshModel() {
    setModel(await command<ModelStatus>("model_status"));
  }
  useEffect(() => {
    if (desktop) {
      void run(refresh);
      void run(refreshModel);
      void run(refreshAssistant);
    }
  }, []);
  async function refreshAssistant() {
    setAssistant(await command<AssistantSettingsInfo>("assistant_settings"));
  }
  async function changeThinking(thinking: Thinking) {
    setSavingThinking(true);
    await run(async () => {
      setAssistant(
        await command<AssistantSettingsInfo>("set_thinking", { thinking }),
      );
    });
    setSavingThinking(false);
  }
  async function changeWebSearch() {
    if (!assistant || savingThinking || streaming) return;
    setSavingThinking(true);
    await run(async () => {
      setAssistant(
        await command<AssistantSettingsInfo>("set_web_search", {
          enabled: !assistant.webSearch,
        }),
      );
    });
    setSavingThinking(false);
  }
  async function compact() {
    if (busy) return;
    setBusy(true);
    await run(async () => {
      await command("set_compact", { compact: !collapsed });
      setCollapsed(!collapsed);
    });
    setBusy(false);
  }
  function send() {
    if (savingThinking) return;
    if (!model?.hasKey) {
      setTab("settings");
      return;
    }
    if (!assistant) {
      setError("助手设置尚未读取，请在设置中刷新后再发送。");
      return;
    }
    if (chat.send(draft)) {
      setDraft("");
      scroll.resume();
    }
  }
  const protectedWindow = status?.captureExcluded === true;
  return (
    <main
      className={`shell ${collapsed ? "compact" : ""}`}
      data-theme={appearance.resolvedTheme}
      style={
        { "--panel-opacity": appearance.opacity / 100 } as React.CSSProperties
      }
    >
      <header className="titlebar">
        <div className="brand" data-tauri-drag-region>
          <Mark small />
          <span data-tauri-drag-region>
            Deep Interview
            <span className="brand-sub" data-tauri-drag-region>
              你的桌面灵感搭子
            </span>
          </span>
        </div>
        <div className="window-actions">
          <button
            className={`icon-button ${status?.alwaysOnTop ? "active" : ""}`}
            aria-label="切换置顶"
            title="切换置顶"
            onClick={() =>
              void run(async () => {
                await command("set_pinned", { pinned: !status?.alwaysOnTop });
                await refresh();
              })
            }
          >
            <Pin size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={collapsed ? "展开窗口" : "收起窗口"}
            title={collapsed ? "展开窗口" : "收起窗口"}
            disabled={busy}
            onClick={() => void compact()}
          >
            {collapsed ? <Expand size={15} /> : <Minus size={17} />}
          </button>
          <button
            className="icon-button close"
            aria-label="隐藏到托盘"
            title="隐藏到托盘 · Ctrl+Shift+Space 恢复"
            onClick={() =>
              void run(async () => {
                await command("hide_window");
              })
            }
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {!collapsed && (
        <>
          <div className="toolbar">
            <nav aria-label="面板">
              <button
                className={tab === "chat" ? "selected" : ""}
                onClick={() => setTab("chat")}
              >
                <MessageSquare size={14} />
                对话
              </button>
              <button
                className={tab === "history" ? "selected" : ""}
                onClick={() => setTab("history")}
              >
                <History size={14} />
                历史
              </button>
              <button
                className={tab === "settings" ? "selected" : ""}
                onClick={() => setTab("settings")}
              >
                <Settings2 size={14} />
                设置
              </button>
            </nav>
            <button
              className="new-chat"
              disabled={streaming || !chat.ready}
              onClick={() => {
                chat.createSession();
                setDraft("");
                setTab("chat");
              }}
              title="新建会话，原对话保留在历史中"
            >
              <Plus size={13} />
              新对话
            </button>
          </div>
          {!desktop && (
            <div className="notice">界面预览 · 窗口功能请在桌面应用中体验</div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {chat.storageError && (
            <div role="alert" className="error storage-error">
              {chat.storageError}
              <button onClick={() => void chat.retryStorage()}>
                {chat.ready ? "重试保存" : "重新加载历史"}
              </button>
            </div>
          )}
          {status?.shortcutError && (
            <div className="error">
              快捷键注册失败，请通过托盘恢复窗口。{status.shortcutError}
            </div>
          )}
          {tab === "chat" ? (
            <>
              {messages.length > 0 && (
                <div className="session-caption">
                  <span>
                    {
                      chat.sessions.find((s) => s.id === chat.activeSessionId)
                        ?.title
                    }
                  </span>
                  <small>{chat.saved ? "已保存至本机" : "保存中…"}</small>
                </div>
              )}
              {chat.memory && (
                <details className="memory-preview">
                  <summary>
                    会话记忆 · 已整理 {chat.memory.coveredMessages / 2} 轮历史
                  </summary>
                  <p>
                    摘要供模型延续对话，可能遗漏细节；完整记录仍保留在历史中。
                  </p>
                  <pre>{chat.memory.summary}</pre>
                </details>
              )}
              <section
                className="conversation"
                aria-label="聊天内容"
                ref={scroll.container}
                tabIndex={0}
                onScroll={scroll.onScroll}
                onWheel={(e) => {
                  if (e.deltaY < 0) scroll.pause();
                }}
                onKeyDown={(e) => {
                  if (["ArrowUp", "PageUp", "Home"].includes(e.key))
                    scroll.pause();
                }}
              >
                {messages.length === 0 ? (
                  <div className="welcome">
                    <div className="hero-art">
                      <span className="orbit one" />
                      <span className="orbit two" />
                      <Mark />
                      <span className="tiny-spark">
                        <Sparkles size={15} />
                      </span>
                    </div>
                    <span className="eyebrow">
                      A LITTLE SPACE FOR YOUR IDEAS
                    </span>
                    <h1>让灵感，留在手边。</h1>
                    <p>
                      一个安静的小窗口，
                      <br />
                      陪你整理思路，接住每一个想法。
                    </p>
                    <div className="suggestions">
                      <button
                        onClick={() => setDraft("帮我整理一下今天的思路")}
                      >
                        <span className="suggestion-icon">
                          <Sparkles size={17} />
                        </span>
                        <span>
                          <strong>整理一个想法</strong>
                          <small>从一句话开始，慢慢展开</small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                      <button onClick={() => setTab("settings")}>
                        <span className="suggestion-icon">
                          <ShieldCheck size={17} />
                        </span>
                        <span>
                          <strong>
                            {model?.hasKey
                              ? "你的专属 AI，已就绪"
                              : "连接你的 DeepSeek"}
                          </strong>
                          <small>官方 API · 只用自己的 Key</small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="messages">
                    {messages.map((m, i) => (
                      <article className={`message ${m.role}`} key={m.id}>
                        <div className="message-label">
                          {m.role === "user" ? (
                            "你"
                          ) : (
                            <>
                              <Mark small />
                              DeepSeek Flash
                            </>
                          )}
                        </div>
                        {m.role === "user" ? (
                          <p>{m.text}</p>
                        ) : (
                          <MessageContent text={m.text} />
                        )}
                        {m.status === "streaming" && (
                          <span className="generating" role="status">
                            {chat.stopping
                              ? "正在停止…"
                              : chat.compacting
                                ? "正在整理会话记忆…"
                                : chat.searchStatus
                                  ? chat.searchStatus
                                  : m.text
                                    ? "正在生成…"
                                    : m.thinking
                                      ? "正在思考…"
                                      : "正在等待 DeepSeek…"}
                          </span>
                        )}
                        {m.role === "assistant" && (
                          <SearchSources
                            sources={m.sources}
                            note={m.searchNote}
                          />
                        )}
                        {m.role === "assistant" && m.status !== "streaming" && (
                          <span
                            className={`answer-status ${m.status}`}
                            role="status"
                          >
                            {m.status === "complete"
                              ? "已完成"
                              : m.status === "cancelled"
                                ? "已停止"
                                : "生成失败"}
                          </span>
                        )}
                        {m.text && (
                          <div className="message-tools">
                            <CopyButton
                              text={m.text}
                              label={
                                m.role === "assistant" ? "复制回答" : "复制提问"
                              }
                            />
                          </div>
                        )}
                        {m.note && (
                          <div
                            className={`message-note ${m.status}`}
                            role={m.status === "error" ? "alert" : "status"}
                          >
                            {m.note}
                          </div>
                        )}
                        {(m.status === "error" || m.status === "cancelled") &&
                          i === messages.length - 1 && (
                            <button
                              className="retry"
                              disabled={streaming || savingThinking}
                              onClick={chat.retry}
                            >
                              重新生成
                            </button>
                          )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
              {scroll.paused && messages.length > 0 && (
                <button className="follow-button" onClick={scroll.resume}>
                  <ArrowDown size={12} />
                  回到最新 · 恢复跟随
                </button>
              )}
              <div className="composer-wrap">
                <ThinkingPicker
                  id="chat-thinking"
                  value={assistant?.thinking ?? "off"}
                  onChange={(value) => void changeThinking(value)}
                  disabled={
                    !desktop || !assistant || streaming || savingThinking
                  }
                />
                <div className="composer">
                  <textarea
                    aria-label="消息输入"
                    placeholder="写下你的想法…"
                    value={draft}
                    maxLength={4000}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing &&
                        e.nativeEvent.keyCode !== 229
                      ) {
                        e.preventDefault();
                        if (!e.repeat) send();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <button
                      className={`web-search-toggle ${assistant?.webSearch ? "enabled" : ""}`}
                      role="switch"
                      aria-label="联网搜索"
                      aria-checked={assistant?.webSearch ?? false}
                      title="允许模型检索网页并引用来源；使用现有 DeepSeek Key，搜索按官方规则计费"
                      disabled={
                        !desktop || !assistant || streaming || savingThinking
                      }
                      onClick={() => void changeWebSearch()}
                    >
                      <Globe size={14} />
                      联网搜索
                      <span className="search-toggle-state">
                        {assistant?.webSearch ? "已开启" : "关闭"}
                      </span>
                    </button>
                    <button
                      className="send"
                      title={streaming ? "停止生成" : "发送消息"}
                      aria-label={streaming ? "停止生成" : "发送消息"}
                      disabled={
                        streaming
                          ? chat.stopping
                          : !draft.trim() ||
                            !desktop ||
                            savingThinking ||
                            !chat.ready
                      }
                      onClick={streaming ? () => void chat.stop() : send}
                    >
                      {streaming ? (
                        <Square size={13} fill="currentColor" />
                      ) : (
                        <ArrowUp size={18} />
                      )}
                    </button>
                  </div>
                </div>
                <p className="composer-hint">
                  {streaming
                    ? "正在流式回答 · 可随时停止"
                    : assistant?.webSearch
                      ? "联网已开启 · 自动检索并附来源 · 按官方规则计费"
                      : "Enter 发送 · Shift + Enter 换行 · 历史保存在本机"}
                </p>
              </div>
            </>
          ) : tab === "history" ? (
            <HistoryPanel
              sessions={chat.sessions}
              activeId={chat.activeSessionId}
              disabled={streaming || !chat.ready}
              onSelect={(id) => {
                chat.selectSession(id);
                setDraft("");
                setTab("chat");
              }}
              onDelete={chat.deleteSession}
            />
          ) : (
            <section className="settings">
              <div className="section-heading">
                <span className="eyebrow">MAKE IT YOURS</span>
                <h2>刚刚好的陪伴</h2>
                <p>把这个小窗口，调成你喜欢的样子。</p>
              </div>
              <ModelSettings
                status={model}
                refresh={refreshModel}
                disabled={streaming}
              />
              <div className="api-card">
                <ThinkingPicker
                  id="settings-thinking"
                  value={assistant?.thinking ?? "off"}
                  onChange={(value) => void changeThinking(value)}
                  disabled={
                    !desktop || !assistant || streaming || savingThinking
                  }
                />
                <p>
                  {
                    thinkingOptions.find(
                      (o) => o.value === (assistant?.thinking ?? "off"),
                    )?.label
                  }
                  。选择会自动保存，下次启动仍保留。
                </p>
                <p className="api-footnote">
                  思考越深入，等待时间和 token
                  消耗通常越多。生成期间不能切换，可先停止回答。
                </p>
              </div>
              <PromptSettings
                info={assistant}
                refresh={refreshAssistant}
                disabled={streaming}
              />
              <div className="setting-card">
                <div className="setting-row">
                  <div>
                    <strong>外观主题</strong>
                    <p>自动保存主题、窗口位置与尺寸</p>
                  </div>
                  <select
                    aria-label="外观主题"
                    value={appearance.theme}
                    disabled={!appearance.ready}
                    onChange={(e) =>
                      appearance.update({
                        theme: e.target.value as Appearance["theme"],
                      })
                    }
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>始终置顶</strong>
                    <p>切换应用时，依然留在手边</p>
                  </div>
                  <button
                    className={`switch ${status?.alwaysOnTop ? "on" : ""}`}
                    role="switch"
                    aria-checked={status?.alwaysOnTop ?? false}
                    aria-label="始终置顶"
                    onClick={() =>
                      void run(async () => {
                        await command("set_pinned", {
                          pinned: !status?.alwaysOnTop,
                        });
                        await refresh();
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
                <div className="setting-row opacity">
                  <div>
                    <strong>面板不透明度</strong>
                    <p>只调整背景，文字始终清晰</p>
                  </div>
                  <output>{appearance.opacity}%</output>
                  <input
                    type="range"
                    aria-label="面板不透明度"
                    min="75"
                    max="100"
                    value={appearance.opacity}
                    disabled={!appearance.ready}
                    onChange={(e) =>
                      appearance.update({ opacity: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              {appearance.error && (
                <div role="alert" className="error">
                  {appearance.error}
                  <button onClick={appearance.save}>重试保存外观</button>
                </div>
              )}
              <p className="settings-note">
                历史会话以文本保存在本机，可在「历史」中删除。短对话使用
                完整上下文；接近工作容量时自动整理早期内容为摘要，并保留近期原文继续回答。整理会额外调用
                DeepSeek，摘要可能遗漏细节。
              </p>
              <div
                className={`protection-card ${protectedWindow ? "" : "unverified"}`}
              >
                <ShieldCheck size={21} />
                <div>
                  <strong>窗口捕获排除</strong>
                  <p>
                    {protectedWindow
                      ? "已启用。支持此保护的共享或录屏方式会排除助手，本机仍正常显示。"
                      : desktop
                        ? "请重新检查系统窗口状态。"
                        : "浏览器预览不提供捕获保护"}
                  </p>
                  <p>启动时自动开启，恢复窗口时重新应用保护。</p>
                  <button disabled={!desktop} onClick={() => void run(refresh)}>
                    重新检查 <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
              <div className="shortcut-card">
                <span>显示 / 隐藏窗口</span>
                <span className="keys">
                  <kbd>Ctrl</kbd>
                  <kbd>Shift</kbd>
                  <kbd>Space</kbd>
                </span>
              </div>
              <p className="settings-note">
                关闭按钮会将助手隐藏到托盘。
                <br />
                需要结束运行时，在托盘菜单选择「退出」。
              </p>
            </section>
          )}
          <footer>
            <span className={`status ${protectedWindow ? "verified" : ""}`}>
              {protectedWindow ? (
                <Check size={12} />
              ) : (
                <ShieldCheck size={12} />
              )}{" "}
              {protectedWindow ? "捕获排除已启用" : "保护状态待检查"}
            </span>
            <span className="drag-hint">
              <Grip size={12} />
              拖动顶部，自由摆放
            </span>
          </footer>
        </>
      )}
    </main>
  );
}

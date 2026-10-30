# Deep Interview

Windows 个人悬浮 AI 助手：Tauri 2 / Rust + React / TypeScript。支持明暗主题、置顶、紧凑模式、托盘、捕获保护、本机会话历史，以及 DeepSeek 官方 API 流式问答。

## 如何启动

本机已构建后，**双击根目录 `启动助手.cmd`**。也可直接运行 `src-tauri/target/debug/deep-interview.exe`，不需要另开服务或终端。

- `Ctrl + Shift + Space`：显示 / 隐藏。
- 顶部横线：收起为悬浮条，再点击展开。
- 关闭按钮：隐藏到托盘；托盘「退出」才会结束进程。
- Enter 发送，Shift + Enter 换行；回答时点击方形按钮停止生成。
- 「新对话」创建独立会话，原会话保留在「历史」中；可重新打开、继续追问或确认删除。启动时恢复上次会话。
- 回答下方可复制完整 Markdown，代码块右上角可单独复制代码；复制成功/失败均有提示。
- 生成时自动跟随底部；向上阅读后暂停，点击「回到最新」或滚动到底部恢复。
- 「设置 → 外观主题」可选浅色、深色或跟随系统；窗口位置、展开尺寸和背景不透明度自动保存。
- 窗口捕获排除默认开启，恢复窗口时重新应用保护；设置页仅显示系统状态，不提供关闭开关。

## 模型与 Key

当前只接入 **DeepSeek-V4.1-Flash-1017**，使用官网公布的 API 别名 `deepseek-flash`。这是官方滚动别名，未来可能随官方升级，不是不可变的版本锁。

- 地址固定为 `https://api.deepseek.com/chat/completions`。
- 开启 SSE 流式输出；可以在输入框上方或设置页选择「不思考 / 低 / 高 / 最高」，默认不思考，选择自动保存。
- 「设置」内可保存、更换或删除 API Key。保存成功只表示本机凭据写入成功，不表示余额或权限已通过官网验证。
- Key 保存在 **Windows 凭据管理器**，目标名 `com.deepinterview.assistant/deepseek`。它不会写入源码、普通配置文件、日志或聊天记录，也不会从后端回传给界面。
- 删除本机 Key 不会撤销官网 Key；撤销仍需在 DeepSeek 官网操作。
- 请求由 Rust 直接发送到官网，不发送屏幕、摄像头或麦克风数据。**没有最近 10 轮限制**：短会话携带全部完整问答；接近工作预算时，先把早期内容压缩为会话摘要，再结合近期原文和当前问题继续回答。系统提示词独立保留，不参与压缩。
- 不思考 / 低 / 高 / 最高的输出预算分别为 4096 / 8192 / 16384 / 32768 tokens（含思考）；更深入的思考通常会增加等待时间与用量。停止、失败或上次退出时中断的部分回复不会自动加入后续上下文。
- 支持 Markdown、代码块、表格。模型返回的 HTML 不执行，远程图片不加载，链接仅作为文本显示。

没有账号系统、独立后端服务或云端会话数据库。API 按 DeepSeek 账户规则计费；失败不会自动重试，避免重复请求。

## 自定义助手

1. 在「设置 → API Key」中保存自己的 DeepSeek Key。可以随时替换或删除本机凭据。
2. 在聊天输入框上方选择思考程度；设置页也能调整。生成期间先停止回答，再切换。开启思考时先显示「正在思考…」，正文返回后逐段显示。
3. 编辑仓库根目录的 [`system-prompt.txt`](system-prompt.txt)，也可以在「设置 → 系统提示词 → 打开提示词文件」中用记事本打开。

例如将提示词写成：

```text
你是我的私人学习助手。
默认用中文回答，先给出结论，再用具体例子解释。
涉及代码时，给出可运行的最小示例，并说明关键步骤。
对于不确定的信息，请直接说明。
```

保存为 UTF-8 文本后，**下一次提问立即生效，无需重新编译或重启**。每条请求会重新读取文件，按 `system（文件内容）→ 历史摘要（如果有）→ 近期原文 → user（本次输入）` 的顺序提交。文件变化不影响已经开始的回答；如需排除旧会话的影响，点击「新对话」。文件留空则不附加 system 消息；读取失败、编码错误或超过 64 KiB 时会报错并阻止该次请求，不会悄悄忽略你的指令。设置页可以刷新前 300 字预览。

仓库内启动时始终使用根目录的提示词文件，与启动时的工作目录无关。将 exe 单独移到其他位置后，使用 `%APPDATA%/com.deepinterview.assistant/system-prompt.txt`；界面会显示实际路径。缺失时在启动阶段创建默认提示词，已有文件不会被覆盖。思考偏好存放于同一应用配置目录的 `assistant-settings.json`，其中不含 Key。

## 本机保存与恢复

会话记忆自动维护，无需开关。压缩时显示「正在整理会话记忆…」，之后继续回答；聊天顶部可以展开查看摘要。摘要随会话保存和恢复，新对话彼此隔离。完整原文始终保留；压缩失败或被停止时不会悄悄丢弃历史。压缩会产生额外 DeepSeek API 用量，摘要是有损的，重要指令仍建议放在 system 文件。策略和开源参考见 [上下文与 memory](docs/context-memory.md)。

- `%APPDATA%/com.deepinterview.assistant/conversations.json`：会话标题、时间、消息、回答状态和当前会话。以普通 JSON 文本保存，不上传历史列表；只将当前会话的裁剪后上下文发给模型。
- 同目录 `ui-settings.json`：主题、不透明度、窗口位置及展开尺寸。收起时保留原展开尺寸，下次启动以展开窗口恢复；显示器移除或 DPI 改变时，将窗口调整到当前可见工作区。
- 新问题、回答结束、新建/切换/删除会话立即排队保存；流式中间结果每约 800 ms 保存一次。显示「已保存至本机」表示该快照已写入。突然终止进程可能丢失最后一个保存周期内的增量；恢复时把未完成回复标为「已停止」，保留已存文字。
- 保存采用临时文件写入、同步并替换，写入失败保留上一次文件并提供「重试保存」。损坏的历史不会被空会话覆盖；界面会提示修复后重新加载。
- 本机存档上限 25 MiB / 500 个会话，单会话最多 10000 条消息；超限会提示整理，不自动删除旧会话。保存完整历史与发送给模型的长度限制互相独立。

较早版本只在内存中保存的对话没有历史文件，无法在升级后恢复。API Key 仍单独保存在 Windows 凭据管理器。

## 开发与构建

Windows 10 2004+ / Windows 11；Node.js 22、Rust stable MSVC、Visual Studio C++ Build Tools、WebView2 Runtime。

```powershell
npm ci
npm run desktop
```

```powershell
npm run build                       # TypeScript + 网页生产构建
npm test                            # 前端交互测试，使用本机 Edge
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build:debug          # 可独立启动的 debug 程序
npm run desktop:build                # release 程序，位于 target/release
```

`npm run dev` 只预览网页，不具备原生窗口、凭据读取或模型调用能力。测试中的原生 IPC 模拟不代表真实官网测试。

## 验证

### 真实模型测试（会产生一次小额 API 调用）

先在设置中保存 Key，再运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml live_deepseek_stream -- --ignored --nocapture
```

测试复用产品的请求与流式解析代码，最多输出 128 tokens。报告写入 `artifacts/local/deepseek-live-test.json`，不包含 Key 或完整回答。

系统指令与思考模式的真实接口验证（单独一次 API 调用）：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml live_thinking_system_prompt -- --ignored --nocapture
```

使用固定的测试指令和 `low` 思考，最多 2048 tokens；不读取或修改你的提示词文件。报告位于 `artifacts/local/thinking-system-test.json`。其他思考档位的参数映射由离线测试覆盖。

### 捕获保护测试

从托盘退出助手，再运行：

```powershell
npm run verify:capture
```

仅采集本机合成测试窗口中心 64×64 区域，对照未保护 / 受保护两种情况，同时检查默认开启、置顶、收起和隐藏恢复。只有 debug 测试会为合成色块临时关闭保护，正式聊天界面不提供关闭功能。该测试不调用模型。

**本机 GDI 捕获通过不等于腾讯会议、飞书、钉钉的远端画面已验证。**应在接收设备上独立验收；「捕获排除已启用」只表示系统标志已生效。

用户已报告腾讯会议、飞书会议的实际共享测试中，接收方看不到开启保护的助手。该反馈适用于用户当时的测试配置。

[当前完整验收清单](docs/phase-1-acceptance-checklist.md) · [阶段一记录](docs/phase-1-verification.md) · [API 接入记录](docs/api-integration.md) · [聊天体验验收](docs/chat-experience.md) · [上下文与 memory](docs/context-memory.md)

## 结构

```text
src/App.tsx                    聊天与窗口 UI
src/useChat.ts                 流式会话、取消、重试、上下文
src/useConversations.ts        历史会话、切换与有序保存
src/chatData.ts                会话结构与上下文裁剪
src/MessageContent.tsx         Markdown、代码块与复制
src/HistoryPanel.tsx           历史列表及删除确认
src/useFollowOutput.ts         自动跟随与阅读暂停
src/useAppearance.ts           明暗主题与不透明度
src/ModelSettings.tsx          Key 配置界面
src/AssistantSettings.tsx      思考程度与系统提示词界面
system-prompt.txt              可手动编辑的系统提示词
src-tauri/src/main.rs          原生窗口、快捷键、托盘
src-tauri/src/credentials.rs   Windows 凭据存取
src-tauri/src/settings.rs      思考偏好保存与提示词文件读取
src-tauri/src/history.rs       会话文件验证、持久化与中断恢复
src-tauri/src/ui_state.rs      窗口几何与外观恢复
src-tauri/src/llm.rs           官方 API、SSE 解码、取消与测试
src-tauri/src/memory.rs        工作预算、滚动摘要、分批压缩及检查点校验
src-tauri/src/capture_test.rs  debug 捕获对照
tests/                        浏览器交互验证
```

## 官方资料

- [DeepSeek 模型更新说明](https://api-docs.deepseek.com/updates/)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek 思考模式开关](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Windows 捕获排除机制](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)

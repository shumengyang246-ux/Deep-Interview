# 聊天体验验收

日期：2026-10-29。

## 功能与实现

| 功能 | 实现行为 |
| --- | --- |
| 发送快捷键 | Enter 发送、Shift + Enter 换行；输入法组合事件和 keyCode 229 不发送，按住 Enter 不重复提交。 |
| 回答状态 | 等待模型、思考、生成、停止中、已完成、已停止、失败。取消或失败可重试，旧请求事件不覆盖当前回复。 |
| Markdown 与复制 | 标题、列表、表格、代码块；整段回答复制原始 Markdown，代码块复制原始代码。显示复制成功或失败，不执行模型 HTML，不加载远程图片。 |
| 历史会话 | 新建、按最近活动排序、打开、继续追问、删除确认；自动生成标题，重启恢复当前会话。生成期间禁止切换和删除，避免内容串入其他会话。 |
| 窗口与主题 | 原生记录物理位置和逻辑尺寸，适配 DPI/工作区；收起不覆盖展开尺寸。浅色、深色、跟随系统及不透明度独立保存。 |
| 流式滚动 | 只滚动聊天容器；向上滚轮、键盘或拖动滚动条暂停。到达底部或点击按钮恢复跟随。 |
| 上下文边界 | 已升级为按容量自动压缩，取消固定 10 轮截断；保留历史摘要、近期原文和当前问题，不包含失败/停止的部分回答。见 [上下文与 memory](context-memory.md)。 |

## 本机存储

`conversations.json` 和 `ui-settings.json` 位于 `%APPDATA%/com.deepinterview.assistant`。会话以普通文本 JSON 保存；Key 不写入这些文件。系统提示词仍独立读取 `system-prompt.txt`。

会话保存按顺序执行，关键操作立即保存，流中间结果约每 800 ms 保存一次。写临时文件后同步并替换，校验版本、角色、ID 和大小；保存失败不会截断原文件，并显示重试入口。损坏的历史不自动清空。退出前未完成的回复恢复为中断状态，不被当作完整上下文。

窗口移动/缩放更新原生内存状态，400 ms 防抖落盘，退出时补写。显示器变化时按现有工作区调整窗口。捕获自测使用单独的 `capture-probe` 配置目录，不改写用户会话和外观。

## 验证范围

- 19 项 Playwright 测试通过：包含发送/换行/输入法、状态/取消/重试、代码与回答复制、会话新建/恢复/删除/独立上下文、写入错误恢复、损坏历史保护、中断回复、主题持久化/系统主题以及阅读暂停。
- 13 项 Rust 离线测试通过：真实文件写入及重新加载、删除结果、损坏文件保留、外观/几何合并、DPI 与屏幕边界、UTF-8 上下文边界，以及既有提示词、思考模式和 SSE 测试。
- 前端用模拟 IPC 和剪贴板验证交互；本机文件由 Rust 测试验证。真实桌面窗口保存/恢复与 GDI 检查由 `npm run verify:capture` 验证，报告为 `artifacts/local/capture-report.json`。
- 本次无额外真实模型计费请求。此前官方 API 的流式输出、低思考与系统提示词测试记录仍保留。

GDI 检查不代表腾讯会议、飞书、钉钉接收端已验收。截图预览在 `artifacts/local/chat-markdown-light.png`、`chat-dark.png` 和 `history-light.png`。

参考：[Tauri WebviewWindow API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)、[Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)。

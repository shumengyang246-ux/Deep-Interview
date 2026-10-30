# 联网检索

2026-10-30。输入框底部左侧新增「联网搜索」开关，默认关闭，保存后跨重启保留。生成期间不能切换，停止后可切换并重新生成。

## 使用与行为

1. 设置中保存 DeepSeek Key。
2. 开启输入框左下角「联网搜索」，提交需要查证的问题。
3. 查看检索状态，随后收到流式回答；回答中可通过 `[编号]` 标识引用。
4. 展开「参考来源」，点击标题在默认浏览器打开，或复制 URL。原始 Markdown 内的任意链接仍只显示文字。

关闭开关时走原问答链路，不调用搜索或检索规划接口。关闭不会删除已有来源。开关允许模型按需检索：不需要查询的任务可能显示“本次问题无需联网检索”。空结果明确显示“未找到可用来源”；失败/超时会报错并停止，没有自动重试或静默降级。

搜索和模型规划可能产生额外 API 用量，复用现有 Windows 凭据管理器中的 DeepSeek Key。联网开关不是免费搜索承诺。

## 实际调用链

```text
App 联网开关 → set_web_search → assistant-settings.json
发送 → llm::start_chat 配置快照 → memory::prepare
  → web_search::research（不思考的检索规划）
      → Chat Completions tools=[web_search], tool_choice=auto
      → 校验模型返回的 tool_calls、id、函数名、query
      → POST https://api.deepseek.com/v1/tools/search
      → 限长、过滤、去重与稳定来源编号
      → role=tool + tool_call_id 回传结果给规划模型，按需追加搜索
  → 把最终检索证据加入本次问题的有效上下文
  → 原 stream 链路按用户所选思考程度输出正文
  → Channel 状态/来源事件 → useChat → 历史保存与 SearchSources
```

这里使用真实 Function Calling，不靠模型文本中假装“搜索了什么”。规划任务与最终回答分开：规划关闭思考，最终回答保留 off/low/high/max；原始 reasoning_content 不回传前端或写入历史。这也避免在读取旧会话时为带工具的思考请求补造或持久化原始推理内容。每个工具调用后都携带对应结果，最多 3 次检索；到达上限直接用已获得的证据回答。

网络请求只发往固定 DeepSeek 对话/搜索地址，禁止重定向。搜索使用 `count=5`、`need_content=false`，读取供应商给出的网页摘要，没有实现任意网页全文抓取。搜索返回内容始终作为用户层的证据；额外系统规则要求忽略网页指令、标注来源、不捏造事实。该边界不能保证模型绝不受恶意网页影响。

联网模式会提供本机当前时间及 UTC 偏移，帮助模型理解“今天”“今年”。来源时间保留在本次证据中；缺少日期不被当作最新。来源编号对应本条回答，下一次请求重新编号；历史回答的来源标题/URL 随已完成问答一起加入后续上下文。

## 容量与异常处理

| 项目 | 实现 |
| --- | --- |
| 工具次数 | 每次提问最多 3 次真实搜索，最多 3 次规划请求；不自动重试失败调用 |
| 搜索词 | 1～128 Unicode 字符；函数名固定，参数必须是严格可解析的 query 对象 |
| 来源 | 每次搜索最多 5 条，总计最多 15 条；按 URL 去重，已分配编号不改变 |
| 文本 | 标题最多 300 字节、展示摘要 600 字节、模型用摘要 1500 字节，按 UTF-8 边界截断 |
| 证据预算 | 序列化证据条目总计最多 24000 字节，预先为检索预留 30000 工作单位 |
| HTTP 响应 | 规划最多 128 KiB、搜索最多 512 KiB；无效 JSON/超限直接报错 |
| 超时 | 连接 15 秒、单次规划/搜索 45 秒、整个检索阶段 180 秒；最终回答使用原有超时 |
| 停止 | 复用包围整个 run_chat 的 CancellationToken；停止可中断规划、搜索及最终回答 |
| 失败 | 保留已接收来源与正文，显示错误；用户手动重试，可先关闭联网 |
| 链接 | 只接受有效 HTTP/HTTPS，无用户名密码、控制字符；Windows ShellExecuteW 直接打开 URL，不拼接命令 |

保存结构兼容旧记录：偏好缺少 webSearch 时取 false；消息新增可选 webSearch、searchNote、sources。Rust 校验来源大小/链接/唯一编号，前端按 requestId 丢弃旧事件。来源不进入其他会话。搜索证据只修改请求上下文，不修改或替换用户原始消息；持久化的是来源标题、URL 和简短展示摘要。

## 验证与复现

- 前端：26 项通过，新增开关默认关闭、持久化/保存失败、最小窗口位置、请求锁定、检索进度、来源打开/复制/重载、追问引用、取消、过期事件、失败后关闭联网重试和非法链接处理。
- Rust：新增 8 项离线测试，覆盖工具循环/预算/去重、无需搜索/错误、参数校验、UTF-8 与来源安全、取消、HTTP 响应限制、偏好迁移回滚、来源存档恢复。原 16 项保持通过。
- 真实接口：固定 Rust 文档问题成功调用 1 次搜索，返回 5 个来源，最终收到思考进度及引用来源编号的正文，正常 stop。没有使用用户聊天记录或提示词文件。报告在忽略目录 `artifacts/local/web-search-live.json`。
- 真实接口验证最初将“引用正确”错误限定为引用 `[1]`；测试现已改为检查引用是否属于返回的来源集合，允许模型选取更相关的 `[2]` 等来源，修正后通过。
- 浏览器截图：`artifacts/local/web-search-progress.png`、`web-search-answer.png`、`web-search-dark-small.png`；截图使用合成数据。默认浏览器打开的 OS 行为仍建议在桌面上点一次验收，浏览器测试只验证发出的命令。

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run desktop:build:debug
```

真实验证为 ignored 测试，只有显式运行才调用收费接口：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml live_web_search_answer -- --ignored --nocapture
```

手动验收：首次默认关闭 → 开启并搜索 → 展开/复制/打开来源 → 停止搜索 → 重启确认开关及来源恢复 → 关闭后普通提问。多会话隔离、捕获保护等原行为继续适用；本次不新增会议远端捕获结论。

## 官方依据

- [Search & Fetch](https://api-docs.deepseek.com/guides/search/)：接口地址、共享鉴权及计费边界。
- [Search API](https://api-docs.deepseek.com/api/search/)：查询及结果字段。
- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)：模型选工具、客户端执行、tool 消息回传。
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)：带 tools 的思考请求需回传 reasoning_content，因此本实现隔离检索规划与最终回答。

import { test, expect, type Page } from "@playwright/test";
async function nativeMock(page: Page, hasKey = true, delayAck = false) {
  await page.addInitScript(
    ({ hasKey, delayAck }) => {
      const w = window as any;
      w.isTauri = true;
      w.requests = [];
      w.cancelled = [];
      const windowStatus = () => ({
        captureExcluded: true,
        affinity: 17,
        alwaysOnTop: true,
        shortcutRegistered: true,
      });
      w.savedArchive = null;
      w.clipboardText = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (w.failCopy) throw new Error("denied");
            w.clipboardText = text;
          },
        },
      });
      w.openedPrompt = false;
      w.promptPreview = "你是一位可靠的私人 AI 助手。";
      const settings = () => ({
        thinking: localStorage.getItem("mockThinking") || "off",
        webSearch: localStorage.getItem("mockWebSearch") === "true",
        promptPath: "C:\\Deep-Interview\\system-prompt.txt",
        promptCharacters: w.promptPreview.length,
        promptPreview: w.promptPreview,
        promptError: null,
      });
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => Math.floor(Math.random() * 100000),
        unregisterCallback: () => {},
        invoke: async (cmd: string, args: any) => {
          if (cmd === "load_conversations") {
            if (w.failLoad) throw "历史读取失败，原文件已保留。";
            return JSON.parse(localStorage.getItem("mockArchive") || "null");
          }
          if (cmd === "save_conversations") {
            if (w.failHistorySave) throw "本机数据保存失败，原文件已保留。";
            w.savedArchive = JSON.parse(JSON.stringify(args.archive));
            localStorage.setItem("mockArchive", JSON.stringify(args.archive));
          }
          if (cmd === "ui_settings")
            return JSON.parse(
              localStorage.getItem("mockAppearance") ||
                '{"theme":"light","opacity":97}',
            );
          if (cmd === "set_appearance")
            localStorage.setItem(
              "mockAppearance",
              JSON.stringify(args.appearance),
            );
          if (cmd === "window_status") return windowStatus();
          if (cmd === "model_status")
            return {
              hasKey,
              model: "deepseek-flash",
              endpoint: "https://api.deepseek.com/chat/completions",
            };
          if (cmd === "assistant_settings") return settings();
          if (cmd === "set_thinking") {
            if (w.failSave) throw "无法保存思考程度。";
            localStorage.setItem("mockThinking", args.thinking);
            return settings();
          }
          if (cmd === "set_web_search") {
            if (w.failSave) throw "无法保存联网设置。";
            localStorage.setItem("mockWebSearch", String(args.enabled));
            return settings();
          }
          if (cmd === "open_source") w.openedSource = args.url;
          if (cmd === "open_system_prompt") w.openedPrompt = true;
          if (cmd === "save_api_key") hasKey = true;
          if (cmd === "delete_api_key") hasKey = false;
          if (cmd === "start_chat") {
            args.effectiveThinking = settings().thinking;
            args.effectiveWebSearch = settings().webSearch;
            w.requests.push(args);
            if (delayAck)
              await new Promise((resolve) => {
                w.releaseAck = resolve;
              });
          }
          if (cmd === "cancel_chat") {
            w.cancelled.push(args.requestId);
            const request = w.requests.find(
              (r: any) => r.requestId === args.requestId,
            );
            request.onEvent.onmessage({
              requestId: args.requestId,
              kind: "cancelled",
              text: "已停止生成",
            });
          }
        },
      };
      w.emit = (i: number, kind: string, text: string) => {
        const r = w.requests[i];
        r.onEvent.onmessage({ requestId: r.requestId, kind, text });
      };
    },
    { hasKey, delayAck },
  );
  await page.goto("/");
}
async function emit(page: Page, index: number, kind: string, text = "") {
  await page.evaluate(
    ({ index, kind, text }) => (window as any).emit(index, kind, text),
    { index, kind, text },
  );
}

async function sendQuestion(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息输入" }).fill(text);
  await page.getByRole("textbox", { name: "消息输入" }).press("Enter");
}

test("web search toggle sits at bottom left, persists, and does not enable on failed save", async ({
  page,
}) => {
  await nativeMock(page);
  const toggle = page.getByRole("switch", { name: "联网搜索" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await sendQuestion(page, "不联网的问题");
  expect(
    await page.evaluate(() => (window as any).requests[0].effectiveWebSearch),
  ).toBe(false);
  await emit(page, 0, "delta", "普通回答");
  await emit(page, 0, "done");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await toggle.click();
  await expect(page.getByRole("alert")).toContainText("无法保存联网设置");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.setViewportSize({ width: 360, height: 540 });
  const toggleBox = (await toggle.boundingBox())!;
  const inputBox = (await page
    .getByRole("textbox", { name: "消息输入" })
    .boundingBox())!;
  const sendBox = (await page
    .getByRole("button", { name: "发送消息" })
    .boundingBox())!;
  expect(toggleBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height);
  expect(toggleBox.x + toggleBox.width).toBeLessThan(sendBox.x);
  expect(toggleBox.y + toggleBox.height).toBeLessThan(540);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
});

test("web search shows progress, saves sources, opens a source and keeps follow-up citations", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByRole("switch", { name: "联网搜索" }).click();
  await sendQuestion(page, "查询 Rust 官方信息");
  expect(
    await page.evaluate(() => (window as any).requests[0].effectiveWebSearch),
  ).toBe(true);
  await expect(page.getByRole("switch", { name: "联网搜索" })).toBeDisabled();
  await emit(page, 0, "search_status", "正在搜索：Rust 官方信息");
  await expect(
    page.getByText("正在搜索：Rust 官方信息", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/local/web-search-progress.png" });
  const sources = [
    {
      id: 1,
      title: "Rust 官方网站",
      url: "https://www.rust-lang.org/",
      snippet: "可靠的官方来源",
    },
  ];
  await emit(page, 0, "sources", JSON.stringify(sources));
  await emit(page, 0, "search_complete", "已检索 1 次 · 找到 1 个来源");
  await emit(
    page,
    0,
    "delta",
    "根据 Rust 官方资料，Rust 注重可靠性与效率。[1]",
  );
  await emit(page, 0, "done");
  await expect(
    page.getByText("正在搜索：Rust 官方信息", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("参考来源 · 1", { exact: false }).click();
  await page.getByRole("button", { name: "打开来源 1：Rust 官方网站" }).click();
  expect(await page.evaluate(() => (window as any).openedSource)).toBe(
    sources[0].url,
  );
  await page.getByRole("button", { name: "复制链接", exact: true }).click();
  expect(await page.evaluate(() => (window as any).clipboardText)).toBe(
    sources[0].url,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).savedArchive?.sessions[0].messages[1].sources,
      ),
    )
    .toEqual(sources);
  await page.screenshot({ path: "artifacts/local/web-search-answer.png" });
  await page.reload();
  await page.getByText("参考来源 · 1", { exact: false }).click();
  await expect(
    page.getByRole("button", { name: "打开来源 1：Rust 官方网站" }),
  ).toBeVisible();
  await sendQuestion(page, "上面的来源链接是什么？");
  const messages = await page.evaluate(
    () => (window as any).requests[0].messages,
  );
  expect(messages[1].content).toContain(sources[0].url);
  await page.getByRole("button", { name: "停止生成" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("combobox", { name: "外观主题" }).selectOption("dark");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 540 });
  await page.screenshot({ path: "artifacts/local/web-search-dark-small.png" });
});

test("search cancellation ignores stale sources and a new session starts without evidence", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByRole("switch", { name: "联网搜索" }).click();
  await sendQuestion(page, "搜索中断");
  await emit(page, 0, "search_status", "正在搜索：测试");
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.getByText("已停止", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新对话" }).click();
  await sendQuestion(page, "新问题");
  await emit(
    page,
    0,
    "sources",
    JSON.stringify([
      { id: 1, title: "旧来源", url: "https://example.com/old", snippet: "旧" },
    ]),
  );
  await emit(page, 0, "search_complete", "旧搜索完成");
  await expect(page.getByText("参考来源 · 1", { exact: false })).toHaveCount(0);
  await expect(page.getByText("旧搜索完成")).toHaveCount(0);
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests[1].messages).toEqual([{ role: "user", content: "新问题" }]);
});

test("search error stays actionable and retry can explicitly disable networking", async ({
  page,
}) => {
  await nativeMock(page);
  const toggle = page.getByRole("switch", { name: "联网搜索" });
  await toggle.click();
  await sendQuestion(page, "搜索失败后重试");
  await emit(page, 0, "search_status", "正在分析检索问题…");
  await emit(page, 0, "error", "联网检索失败：请求过于频繁（HTTP 429）");
  await expect(page.getByRole("alert")).toContainText("联网检索失败");
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "重新生成" }).click();
  expect(
    await page.evaluate(() => (window as any).requests[1].effectiveWebSearch),
  ).toBe(false);
  await emit(page, 1, "delta", "不联网回答");
  await emit(page, 1, "done");
  await expect(page.locator(".message.user")).toHaveCount(1);
  await expect(
    page.getByText("正在分析检索问题…", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".search-sources")).toHaveCount(0);
});

test("empty search results are disclosed and unsafe source events stop the request", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByRole("switch", { name: "联网搜索" }).click();
  await sendQuestion(page, "没有结果的问题");
  await emit(page, 0, "sources", "[]");
  await emit(page, 0, "search_complete", "未找到可用来源，将说明信息限制");
  await emit(page, 0, "delta", "没有检索到可用资料，无法确认。");
  await emit(page, 0, "done");
  await expect(
    page.getByText("未找到可用来源，将说明信息限制", { exact: true }),
  ).toBeVisible();
  await sendQuestion(page, "坏来源");
  await emit(
    page,
    1,
    "sources",
    JSON.stringify([
      { id: 1, title: "bad", url: "javascript:alert(1)", snippet: "bad" },
    ]),
  );
  await expect(page.getByRole("alert")).toContainText("检索来源格式无效");
  expect(await page.evaluate(() => (window as any).cancelled.length)).toBe(1);
  await expect(
    page.getByRole("button", { name: "打开来源 1：bad" }),
  ).toHaveCount(0);
});

test("memory checkpoint survives reload, stays per-session and does not replace transcript", async ({
  page,
}) => {
  await nativeMock(page);
  await sendQuestion(page, "记住项目名称是青竹");
  await emit(page, 0, "delta", "好的，项目名是青竹。");
  await emit(page, 0, "done");
  await sendQuestion(page, "接着讨论");
  await emit(page, 1, "compacting");
  await expect(
    page.getByText("正在整理会话记忆…", { exact: true }),
  ).toBeVisible();
  const memory = {
    version: 1,
    summary: "用户事实：项目名青竹。待办：接着讨论。",
    coveredMessages: 2,
    digest: "a".repeat(64),
    updatedAt: Date.now(),
  };
  await emit(page, 1, "memory", JSON.stringify(memory));
  await emit(page, 1, "answering");
  await emit(page, 1, "delta", "继续讨论青竹项目。");
  await emit(page, 1, "done");
  await expect(page.locator(".memory-preview summary")).toContainText(
    "已整理 1 轮",
  );
  await expect(page.locator(".message.user")).toHaveCount(2);
  await expect(page.getByText("已保存至本机", { exact: true })).toBeVisible();
  await page.reload();
  await page.locator(".memory-preview summary").click();
  await expect(page.locator(".memory-preview pre")).toContainText("项目名青竹");
  await sendQuestion(page, "项目叫什么");
  expect(
    await page.evaluate(() => (window as any).requests[0].priorMemory),
  ).toEqual(memory);
  expect(
    await page.evaluate(() => (window as any).requests[0].messages.length),
  ).toBe(5);
  await emit(page, 0, "compacting");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.locator(".answer-status").last()).toHaveText("已停止");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.locator(".memory-preview")).toHaveCount(0);
  await sendQuestion(page, "独立新话题");
  expect(
    await page.evaluate(() => (window as any).requests[1].priorMemory),
  ).toBeNull();
});

test("compaction failure keeps original history for retry and stale memory is ignored", async ({
  page,
}) => {
  await nativeMock(page);
  await sendQuestion(page, "重要事实");
  await emit(page, 0, "delta", "原始回答");
  await emit(page, 0, "done");
  await sendQuestion(page, "后续问题");
  await emit(page, 1, "compacting");
  await emit(page, 1, "error", "上下文压缩失败，原始历史已保留，可重试。");
  await expect(page.getByRole("alert")).toContainText("压缩失败");
  await expect(page.locator(".message.assistant").first()).toContainText(
    "原始回答",
  );
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).requests[2].messages),
  ).toEqual([
    { role: "user", content: "重要事实" },
    { role: "assistant", content: "原始回答" },
    { role: "user", content: "后续问题" },
  ]);
  await emit(
    page,
    1,
    "memory",
    JSON.stringify({
      version: 1,
      summary: "STALE",
      coveredMessages: 2,
      digest: "a".repeat(64),
      updatedAt: 1,
    }),
  );
  await expect(page.locator(".memory-preview")).toHaveCount(0);
});
test("shows partial content before completion and includes prior answers in follow-up", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByRole("textbox", { name: "消息输入" }).fill("你好");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新对话" })).toBeDisabled();
  await emit(page, 0, "delta", "你好，");
  await expect(page.locator(".message.assistant")).toContainText("你好，");
  await emit(page, 0, "delta", "**今天想聊什么？**");
  await expect(page.locator(".message.assistant strong")).toHaveText(
    "今天想聊什么？",
  );
  await emit(page, 0, "done");
  await page.getByRole("textbox", { name: "消息输入" }).fill("继续");
  await page.getByRole("textbox", { name: "消息输入" }).press("Enter");
  await expect
    .poll(() => page.evaluate(() => (window as any).requests.length))
    .toBe(2);
  expect(
    await page.evaluate(() => (window as any).requests[1].messages),
  ).toEqual([
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好，**今天想聊什么？**" },
    { role: "user", content: "继续" },
  ]);
  await emit(page, 0, "delta", "STALE");
  await expect(page.locator(".messages")).not.toContainText("STALE");
});
test("stop during pending native acknowledgement cancels once accepted", async ({
  page,
}) => {
  await nativeMock(page, true, true);
  await page.getByRole("textbox").fill("长问题");
  await page.getByRole("textbox").press("Enter");
  await page.getByRole("button", { name: "停止生成" }).click();
  await page.evaluate(() => (window as any).releaseAck());
  await expect(page.getByText("已停止生成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).cancelled.length)).toBe(1);
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeVisible();
});
test("error is actionable; retry does not duplicate user turn or include partial answer", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByRole("textbox").fill("测试重试");
  await page.getByRole("textbox").press("Enter");
  await emit(page, 0, "delta", "未完成的回答");
  await emit(page, 0, "error", "账户余额不足（HTTP 402）");
  await expect(page.getByRole("alert")).toContainText("HTTP 402");
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.locator(".message.user")).toHaveCount(1);
  expect(
    await page.evaluate(() => (window as any).requests[1].messages),
  ).toEqual([{ role: "user", content: "测试重试" }]);
  await emit(
    page,
    1,
    "delta",
    "<script>alert(1)</script>\n\n![image](https://example.invalid/tracker.png)",
  );
  await emit(page, 1, "done");
  await expect(page.locator(".markdown img,.markdown script")).toHaveCount(0);
});
test("missing key opens configuration without sending a request", async ({
  page,
}) => {
  await nativeMock(page, false);
  await page.getByRole("textbox", { name: "消息输入" }).fill("测试");
  await page.getByRole("textbox", { name: "消息输入" }).press("Enter");
  await expect(page.locator("#api-key")).toBeVisible();
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(0);
});

test("thinking selection persists, is shared with settings, and locks during streaming", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByLabel("思考程度").selectOption("high");
  await expect(page.getByLabel("思考程度")).toHaveValue("high");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("思考程度")).toHaveValue("high");
  await page.reload();
  await expect(page.getByLabel("思考程度")).toHaveValue("high");
  await page.getByRole("textbox", { name: "消息输入" }).fill("请仔细思考");
  await page.getByRole("textbox", { name: "消息输入" }).press("Enter");
  await expect(page.getByLabel("思考程度")).toBeDisabled();
  expect(
    await page.evaluate(() => (window as any).requests[0].effectiveThinking),
  ).toBe("high");
  await emit(page, 0, "thinking");
  await expect(page.getByText("正在思考…", { exact: true })).toBeVisible();
  await emit(page, 0, "delta", "结论如下");
  await expect(page.getByText("正在生成…", { exact: true })).toBeVisible();
  await emit(page, 0, "done");
  await expect(page.getByLabel("思考程度")).toBeEnabled();
});

test("failed preference save retains previous mode", async ({ page }) => {
  await nativeMock(page);
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await page.getByLabel("思考程度").selectOption("max");
  await expect(page.getByRole("alert")).toContainText("无法保存思考程度");
  await expect(page.getByLabel("思考程度")).toHaveValue("off");
});

test("settings support independent key replacement and prompt preview refresh", async ({
  page,
}) => {
  await nativeMock(page, false);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator("#api-key").fill("test-placeholder");
  await page.getByRole("button", { name: "保存 Key", exact: true }).click();
  await expect(page.getByText("已保存至 Windows 凭据管理器")).toBeVisible();
  await expect(page.locator("#api-key")).toHaveValue("");
  await page.getByRole("button", { name: "删除本机 Key", exact: true }).click();
  await expect(page.getByText("尚未配置", { exact: true })).toBeVisible();
  await expect(page.getByLabel("系统提示词文件路径")).toContainText(
    "system-prompt.txt",
  );
  await page
    .getByRole("button", { name: "打开提示词文件", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).openedPrompt)).toBe(true);
  await page.evaluate(() => {
    (window as any).promptPreview = "请以简洁的中文回答。";
  });
  await page.getByRole("button", { name: "刷新预览", exact: true }).click();
  await page.locator(".prompt-card summary").click();
  await expect(page.locator(".prompt-card pre")).toHaveText(
    "请以简洁的中文回答。",
  );
  await page
    .locator(".prompt-card")
    .screenshot({ path: "artifacts/local/prompt-settings-preview.png" });
});

test("Enter sends, Shift Enter adds a line, and IME confirmation does not send", async ({
  page,
}) => {
  await nativeMock(page);
  const input = page.getByRole("textbox", { name: "消息输入" });
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.pressSequentially("第二行");
  await expect(input).toHaveValue("第一行\n第二行");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(0);
  await input.press("Enter");
  expect(
    await page.evaluate(() => (window as any).requests[0].messages[0].content),
  ).toBe("第一行\n第二行");
  await expect(input).toHaveValue("");
  await emit(page, 0, "done");
});

test("Markdown code and full answers copy exact text and report clipboard errors", async ({
  page,
}) => {
  await nativeMock(page);
  await sendQuestion(page, "给我示例");
  const answer =
    "## 示例\n\n```python\nprint('你好')\n```\n\n| 名称 | 数量 |\n| --- | --- |\n| 示例 | 1 |";
  await emit(page, 0, "delta", answer);
  await emit(page, 0, "done");
  await expect(page.locator(".markdown h2")).toHaveText("示例");
  await expect(page.locator(".markdown table")).toBeVisible();
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await page.evaluate(() => (window as any).clipboardText)).toBe(
    "print('你好')\n",
  );
  await page.getByRole("button", { name: "复制回答", exact: true }).click();
  expect(await page.evaluate(() => (window as any).clipboardText)).toBe(answer);
  await page.evaluate(() => {
    (window as any).failCopy = true;
  });
  await page.getByRole("button", { name: "复制回答", exact: true }).click();
  await expect(page.getByText("复制失败，请选中文字复制")).toBeVisible();
  await page.locator(".conversation").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "artifacts/local/chat-markdown-light.png" });
});

test("new sessions remain independent and history can reopen, restart, and delete", async ({
  page,
}) => {
  await nativeMock(page);
  await sendQuestion(page, "第一段对话");
  await emit(page, 0, "delta", "第一段回答");
  await emit(page, 0, "done");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.locator(".message")).toHaveCount(0);
  await sendQuestion(page, "第二段对话");
  expect(
    await page.evaluate(() => (window as any).requests[1].messages),
  ).toEqual([{ role: "user", content: "第二段对话" }]);
  await emit(page, 1, "delta", "第二段回答");
  await emit(page, 1, "done");
  await expect(page.getByText("已保存至本机", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".message.assistant")).toContainText("第二段回答");
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.locator(".history-item")).toHaveCount(2);
  await page.screenshot({ path: "artifacts/local/history-light.png" });
  await page
    .getByRole("button", { name: "打开会话：第一段对话", exact: true })
    .click();
  await expect(page.locator(".message.assistant")).toContainText("第一段回答");
  await sendQuestion(page, "继续第一段");
  expect(
    await page.evaluate(() => (window as any).requests[0].messages),
  ).toEqual([
    { role: "user", content: "第一段对话" },
    { role: "assistant", content: "第一段回答" },
    { role: "user", content: "继续第一段" },
  ]);
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "删除会话：第一段对话", exact: true }),
  ).toBeDisabled();
  await emit(page, 0, "cancelled", "已停止生成");
  await page
    .getByRole("button", { name: "删除会话：第一段对话", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("mockArchive")!).sessions.length,
      ),
    )
    .toBe(1);
  await page.reload();
  await expect(page.locator(".message.assistant")).toContainText("第二段回答");
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开会话：第一段对话", exact: true }),
  ).toHaveCount(0);
});

test("interrupted stream restores partial answer as stopped and cannot enter context", async ({
  page,
}) => {
  await nativeMock(page);
  await sendQuestion(page, "中断的问题");
  await emit(page, 0, "delta", "未完成内容");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("mockArchive") || "null")?.sessions[0]
            .messages[1]?.text,
      ),
    )
    .toBe("未完成内容");
  await page.reload();
  await expect(page.locator(".answer-status")).toHaveText("已停止");
  await expect(page.locator(".message.assistant")).toContainText("未完成内容");
  await sendQuestion(page, "新的问题");
  expect(
    await page.evaluate(() => (window as any).requests[0].messages),
  ).toEqual([{ role: "user", content: "新的问题" }]);
});

test("failed history save can retry and unreadable history is not overwritten", async ({
  page,
}) => {
  await nativeMock(page);
  await page.evaluate(() => {
    (window as any).failHistorySave = true;
  });
  await sendQuestion(page, "保存失败测试");
  await emit(page, 0, "delta", "重要回答");
  await emit(page, 0, "done");
  await expect(page.getByRole("alert")).toContainText("本机数据保存失败");
  await page.evaluate(() => {
    (window as any).failHistorySave = false;
  });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByText("已保存至本机", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".message.assistant")).toContainText("重要回答");
  await page.evaluate(() =>
    localStorage.setItem("mockArchive", "invalid json"),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重新加载历史" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "消息输入" }).fill("不能覆盖原记录");
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("mockArchive"))).toBe(
    "invalid json",
  );
});

test("theme and opacity persist and system theme follows OS changes", async ({
  page,
}) => {
  await nativeMock(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("外观主题").selectOption("dark");
  await page.getByRole("slider").fill("85");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("mockAppearance") || "null")?.opacity,
      ),
    )
    .toBe(85);
  await page.reload();
  await expect(page.locator(".shell")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".shell")).toHaveCSS("--panel-opacity", "0.85");
  await sendQuestion(page, "整理我的学习计划");
  await emit(
    page,
    0,
    "delta",
    "## 今天的安排\n\n- 阅读项目代码\n- 完成一个小功能\n\n```ts\nconst progress = '一步一步来';\n```\n\n保持清晰，也留一点休息时间。",
  );
  await emit(page, 0, "done");
  await page.locator(".conversation").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "artifacts/local/chat-dark.png" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("外观主题").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".shell")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".shell")).toHaveAttribute("data-theme", "dark");
});

test("stream follows bottom until user reads upward, then resumes on demand", async ({
  page,
}) => {
  await nativeMock(page);
  await sendQuestion(page, "给我一个长回答");
  const conversation = page.locator(".conversation");
  await emit(
    page,
    0,
    "delta",
    Array.from({ length: 35 }, (_, i) => `第 ${i + 1} 段内容。\n\n`).join(""),
  );
  const gap = () =>
    conversation.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
    );
  await expect.poll(gap).toBeLessThan(10);
  await conversation.hover();
  await page.mouse.wheel(0, -500);
  await expect(
    page.getByRole("button", { name: "回到最新 · 恢复跟随" }),
  ).toBeVisible();
  const before = await conversation.evaluate((el) => el.scrollTop);
  await emit(page, 0, "delta", "后续新增段落。\n\n".repeat(10));
  expect(
    Math.abs((await conversation.evaluate((el) => el.scrollTop)) - before),
  ).toBeLessThan(2);
  await page.getByRole("button", { name: "回到最新 · 恢复跟随" }).click();
  await expect.poll(gap).toBeLessThan(10);
  await emit(page, 0, "delta", "继续追加。\n\n".repeat(8));
  await expect.poll(gap).toBeLessThan(10);
  await emit(page, 0, "done");
});

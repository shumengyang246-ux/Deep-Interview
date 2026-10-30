import { test, expect } from "@playwright/test";
import { buildContext, type ChatMessage } from "../src/chatData";
test("local manager receives every complete pair beyond ten turns but no failed partial answers", () => {
  const history: ChatMessage[] = [];
  for (let i = 0; i < 15; i++)
    history.push(
      { id: `u${i}`, role: "user", text: `问题${i}`, status: "complete" },
      { id: `a${i}`, role: "assistant", text: `回答${i}`, status: "complete" },
    );
  history.push(
    { id: "bad-u", role: "user", text: "失败问题", status: "complete" },
    { id: "bad-a", role: "assistant", text: "失败内容", status: "error" },
  );
  const context = buildContext(history, "现在的问题");
  expect(context).toHaveLength(31);
  expect(context[0].content).toBe("问题0");
  expect(context.at(-1)?.content).toBe("现在的问题");
  expect(JSON.stringify(context)).not.toContain("失败");
});
test("large old pairs reach the local compressor intact while current prompt is validated", () => {
  const history: ChatMessage[] = [];
  for (let i = 0; i < 4; i++)
    history.push(
      { id: `u${i}`, role: "user", text: `问题${i}`, status: "complete" },
      {
        id: `a${i}`,
        role: "assistant",
        text: "中文".repeat(5000),
        status: "complete",
      },
    );
  const context = buildContext(history, "当前问题");
  expect(context).toHaveLength(9);
  expect(context[0].content).toBe("问题0");
  expect(
    context.reduce(
      (sum, m) => sum + new TextEncoder().encode(m.content).length,
      0,
    ),
  ).toBeGreaterThan(48000);
  expect(() => buildContext([], "中".repeat(16001))).toThrow("当前问题过长");
});

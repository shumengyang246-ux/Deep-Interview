import { test, expect } from "@playwright/test";

test("preview never claims capture protection; native actions report unavailable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("界面预览 · 窗口功能请在桌面应用中体验"),
  ).toBeVisible();
  await page.getByRole("button", { name: "隐藏到托盘", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请在桌面应用中");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByText("浏览器预览不提供捕获保护")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "窗口捕获排除", exact: true }),
  ).toHaveCount(0);
});

test("minimum window keeps composer usable and settings can scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 540 });
  await page.goto("/");
  const box = await page.getByRole("textbox").boundingBox();
  expect(box!.y + box!.height).toBeLessThan(540);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("slider")).toBeVisible();
});

test("save reviewable interface previews", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: "artifacts/local/ui-preview.png" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: "artifacts/local/settings-preview.png" });
});

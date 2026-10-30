import { invoke, isTauri } from "@tauri-apps/api/core";
export type WindowStatus = {
  captureExcluded: boolean;
  affinity: number;
  alwaysOnTop: boolean;
  shortcutRegistered: boolean;
  shortcutError: string | null;
};
export const desktop = isTauri();
export async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw new Error("请在桌面应用中使用窗口功能。浏览器仅用于界面预览。");
  return invoke<T>(name, args);
}

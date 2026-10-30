import { useEffect, useRef, useState } from "react";
import { command, desktop } from "./native";
export type Appearance = {
  theme: "light" | "dark" | "system";
  opacity: number;
};
export function useAppearance() {
  const [value, setValue] = useState<Appearance>({
    theme: "light",
    opacity: 97,
  });
  const [ready, setReady] = useState(!desktop);
  const [error, setError] = useState("");
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const latest = useRef(value);
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (desktop)
      void command<Appearance>("ui_settings")
        .then((v) => {
          if (!cancelled) {
            latest.current = v;
            setValue(v);
            setReady(true);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => {
      cancelled = true;
      media.removeEventListener("change", changed);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  function save() {
    const snapshot = latest.current;
    if (!desktop) return;
    queue.current = queue.current.then(async () => {
      try {
        await command("set_appearance", { appearance: snapshot });
        if (snapshot === latest.current) setError("");
      } catch (e) {
        setError(String(e));
      }
    });
  }
  function update(patch: Partial<Appearance>) {
    latest.current = { ...latest.current, ...patch };
    setValue(latest.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 250);
  }
  return {
    ...value,
    resolvedTheme:
      value.theme === "system" ? (systemDark ? "dark" : "light") : value.theme,
    ready,
    error,
    update,
    save,
  };
}

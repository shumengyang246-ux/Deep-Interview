import { useLayoutEffect, useRef, useState } from "react";
export function useFollowOutput(
  content: unknown,
  sessionId: string | undefined,
  visible: boolean,
) {
  const container = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const [paused, setPaused] = useState(false);
  function pause() {
    follow.current = false;
    setPaused(true);
  }
  function resume() {
    follow.current = true;
    setPaused(false);
    const el = container.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }
  useLayoutEffect(() => {
    resume();
  }, [sessionId, visible]);
  useLayoutEffect(() => {
    const el = container.current;
    if (el && follow.current) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }, [content, visible]);
  function onScroll() {
    const el = container.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
    if (bottom) {
      follow.current = true;
      setPaused(false);
    } else if (el.scrollTop < lastTop.current - 1) pause();
    lastTop.current = el.scrollTop;
  }
  return { container, paused, pause, resume, onScroll };
}

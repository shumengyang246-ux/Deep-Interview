import { useEffect, useRef, useState, type SetStateAction } from "react";
import { command, desktop } from "./native";
import {
  newArchive,
  newConversation,
  recoverArchive,
  type Archive,
  type ChatMessage,
  type SessionMemory,
} from "./chatData";

export function useConversations() {
  const [archive, setArchive] = useState<Archive | null>(null);
  const current = useRef<Archive | null>(null);
  const [storageError, setStorageError] = useState("");
  const [saved, setSaved] = useState(true);
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function persist() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = current.current;
    if (!snapshot || !desktop) return;
    setSaved(false);
    queue.current = queue.current.then(async () => {
      try {
        await command("save_conversations", { archive: snapshot });
        if (current.current === snapshot) {
          setSaved(true);
          setStorageError("");
        }
      } catch (e) {
        setStorageError(String(e));
      }
    });
  }
  function commit(next: Archive, immediate = true) {
    current.current = next;
    setArchive(next);
    setSaved(false);
    if (immediate) persist();
    else if (!timer.current) timer.current = setTimeout(persist, 800);
  }
  async function reload() {
    try {
      const loaded = desktop
        ? await command<Archive | null>("load_conversations")
        : null;
      const next = loaded ? recoverArchive(loaded) : newArchive();
      current.current = next;
      setArchive(next);
      setSaved(true);
      setStorageError("");
    } catch (e) {
      setStorageError(String(e));
    }
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = desktop
          ? await command<Archive | null>("load_conversations")
          : null;
        if (cancelled) return;
        const next = loaded ? recoverArchive(loaded) : newArchive();
        current.current = next;
        setArchive(next);
      } catch (e) {
        if (!cancelled) setStorageError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);
  function setMessages(update: SetStateAction<ChatMessage[]>) {
    const a = current.current;
    if (!a) return;
    const session = a.sessions.find((s) => s.id === a.activeSessionId)!;
    const messages =
      typeof update === "function" ? update(session.messages) : update;
    const immediate =
      messages.length !== session.messages.length ||
      !messages.some((m) => m.status === "streaming");
    commit(
      {
        ...a,
        sessions: a.sessions.map((s) =>
          s.id === a.activeSessionId
            ? {
                ...s,
                messages,
                title:
                  messages
                    .find((m) => m.role === "user")
                    ?.text.replace(/\s+/g, " ")
                    .slice(0, 32) || "新对话",
                updatedAt: Date.now(),
              }
            : s,
        ),
      },
      immediate,
    );
  }
  function createSession() {
    const a = current.current;
    if (!a) return;
    const empty = a.sessions.find((s) => s.messages.length === 0),
      fresh = empty ?? newConversation();
    commit({
      ...a,
      activeSessionId: fresh.id,
      sessions: empty ? a.sessions : [fresh, ...a.sessions],
    });
  }
  function setMemory(sessionId: string, memory: SessionMemory | null) {
    const a = current.current;
    if (!a || !a.sessions.some((s) => s.id === sessionId)) return;
    commit({
      ...a,
      sessions: a.sessions.map((s) =>
        s.id === sessionId ? { ...s, memory } : s,
      ),
    });
  }
  function selectSession(id: string) {
    const a = current.current;
    if (a?.sessions.some((s) => s.id === id))
      commit({ ...a, activeSessionId: id });
  }
  function deleteSession(id: string) {
    const a = current.current;
    if (!a) return;
    const sessions = a.sessions.filter((s) => s.id !== id);
    if (!sessions.length) sessions.push(newConversation());
    commit({
      ...a,
      sessions,
      activeSessionId:
        a.activeSessionId === id ? sessions[0].id : a.activeSessionId,
    });
  }
  return {
    memory:
      archive?.sessions.find((s) => s.id === archive.activeSessionId)?.memory ??
      null,
    setMemory,
    messages:
      archive?.sessions.find((s) => s.id === archive.activeSessionId)
        ?.messages ?? [],
    setMessages,
    createSession,
    selectSession,
    deleteSession,
    sessions: archive?.sessions ?? [],
    activeSessionId: archive?.activeSessionId,
    ready: !!archive,
    storageError,
    saved,
    retryStorage: archive ? persist : reload,
  };
}

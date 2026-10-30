import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { command } from "./native";
import {
  buildContext,
  parseSources,
  type ChatMessage,
  type SessionMemory,
} from "./chatData";
import { useConversations } from "./useConversations";
type StreamEvent = {
  requestId: string;
  kind:
    | "delta"
    | "thinking"
    | "done"
    | "error"
    | "cancelled"
    | "compacting"
    | "memory"
    | "search_status"
    | "search_complete"
    | "sources"
    | "answering";
  text: string;
};
export function useChat(webSearch = false) {
  const conversations = useConversations();
  const { messages, setMessages } = conversations;
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const active = useRef<{
    id: string;
    accepted: boolean;
    cancel: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      if (active.current) {
        active.current.cancel = true;
        void command("cancel_chat", { requestId: active.current.id }).catch(
          () => {},
        );
      }
    },
    [],
  );
  async function start(history: ChatMessage[], question: ChatMessage) {
    if (active.current) return;
    const sessionId = conversations.activeSessionId;
    if (!sessionId) return;
    const id = crypto.randomUUID();
    const request = { id, accepted: false, cancel: false };
    active.current = request;
    const assistantId = crypto.randomUUID();
    setStreaming(true);
    setStopping(false);
    setCompacting(false);
    setSearchStatus("");
    setMessages([
      ...history,
      question,
      {
        id: assistantId,
        role: "assistant",
        text: "",
        status: "streaming",
        webSearch,
      },
    ]);
    const finish = (status: ChatMessage["status"], note: string) => {
      if (active.current?.id !== id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, status, note } : m)),
      );
      active.current = null;
      setStreaming(false);
      setStopping(false);
      setCompacting(false);
      setSearchStatus("");
    };
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (event) => {
      if (event.requestId !== active.current?.id) return;
      if (event.kind === "compacting") setCompacting(true);
      else if (event.kind === "answering") setCompacting(false);
      else if (event.kind === "search_status") setSearchStatus(event.text);
      else if (event.kind === "search_complete") {
        setSearchStatus("");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, searchNote: event.text } : m,
          ),
        );
      } else if (event.kind === "sources") {
        try {
          const sources = parseSources(event.text);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, sources } : m)),
          );
        } catch {
          request.cancel = true;
          finish("error", "检索来源格式无效，已停止回答，请重试。");
          if (request.accepted)
            void command("cancel_chat", { requestId: id }).catch(() => {});
        }
      } else if (event.kind === "memory") {
        try {
          conversations.setMemory(
            sessionId,
            JSON.parse(event.text) as SessionMemory | null,
          );
        } catch {
          finish("error", "会话记忆更新失败，原始记录已保留，请重试。");
        }
      } else if (event.kind === "delta")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: m.text + event.text } : m,
          ),
        );
      else if (event.kind === "thinking")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, thinking: true } : m,
          ),
        );
      else if (
        event.kind === "done" ||
        event.kind === "error" ||
        event.kind === "cancelled"
      )
        finish(event.kind === "done" ? "complete" : event.kind, event.text);
    };
    try {
      await command("start_chat", {
        requestId: id,
        messages: buildContext(history, question.text),
        priorMemory: conversations.memory,
        onEvent: channel,
      });
      request.accepted = true;
      if (request.cancel) await command("cancel_chat", { requestId: id });
    } catch (e) {
      finish("error", String(e));
    }
  }
  function send(text: string) {
    if (!conversations.ready || active.current || !text.trim()) return false;
    void start(messages, {
      id: crypto.randomUUID(),
      role: "user",
      text: text.trim(),
      status: "complete",
    });
    return true;
  }
  function retry() {
    if (active.current) return;
    const index = messages.map((m) => m.role).lastIndexOf("user");
    if (index >= 0) void start(messages.slice(0, index), messages[index]);
  }
  async function stop() {
    const request = active.current;
    if (!request) return;
    request.cancel = true;
    setStopping(true);
    try {
      if (request.accepted)
        await command("cancel_chat", { requestId: request.id });
    } catch {
      setStopping(false);
    }
  }
  return {
    ...conversations,
    messages,
    streaming,
    stopping,
    compacting,
    searchStatus,
    send,
    retry,
    stop,
    createSession: () => {
      if (!active.current) conversations.createSession();
    },
    selectSession: (id: string) => {
      if (!active.current) conversations.selectSession(id);
    },
    deleteSession: (id: string) => {
      if (!active.current) conversations.deleteSession(id);
    },
  };
}

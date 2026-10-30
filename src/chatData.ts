export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "complete" | "streaming" | "error" | "cancelled";
  note?: string;
  thinking?: boolean;
};
export type SessionMemory = {
  version: 1;
  summary: string;
  coveredMessages: number;
  digest: string;
  updatedAt: number;
};
export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  memory?: SessionMemory | null;
};
export type Archive = {
  version: 1;
  activeSessionId: string;
  sessions: Conversation[];
};
export function newConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}
export function newArchive(): Archive {
  const session = newConversation();
  return { version: 1, activeSessionId: session.id, sessions: [session] };
}
export function recoverArchive(archive: Archive): Archive {
  return {
    ...archive,
    sessions: archive.sessions.map((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.status === "streaming"
          ? {
              ...m,
              status: "cancelled",
              note: "上次生成因应用关闭而中断，已保留收到的内容。",
            }
          : m,
      ),
    })),
  };
}
// Send all complete turns to the local Rust context manager; it owns compression.
export function buildContext(history: ChatMessage[], question: string) {
  if (new TextEncoder().encode(question).length > 48000)
    throw new Error("当前问题过长，请精简后发送。");
  const context: { role: string; content: string }[] = [];
  for (let i = 0; i < history.length - 1; i++) {
    const u = history[i],
      a = history[i + 1];
    if (
      u.role === "user" &&
      a.role === "assistant" &&
      a.status === "complete" &&
      a.text
    ) {
      context.push(
        { role: "user", content: u.text },
        { role: "assistant", content: a.text },
      );
      i++;
    }
  }
  return [...context, { role: "user", content: question }];
}

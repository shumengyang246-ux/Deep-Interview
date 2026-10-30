export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "complete" | "streaming" | "error" | "cancelled";
  note?: string;
  thinking?: boolean;
  webSearch?: boolean;
  searchNote?: string;
  sources?: SearchSource[];
};
export type SearchSource = {
  id: number;
  title: string;
  url: string;
  snippet: string;
};
export function parseSources(text: string): SearchSource[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 15)
    throw new Error("检索来源格式无效");
  const ids = new Set<number>();
  for (const source of value) {
    if (
      !source ||
      !Number.isInteger(source.id) ||
      source.id < 1 ||
      source.id > 15 ||
      ids.has(source.id) ||
      typeof source.title !== "string" ||
      !source.title.trim() ||
      typeof source.snippet !== "string" ||
      typeof source.url !== "string"
    ) {
      throw new Error("检索来源格式无效");
    }
    const url = new URL(source.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("检索来源链接无效");
    }
    ids.add(source.id);
  }
  return value as SearchSource[];
}
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
        {
          role: "assistant",
          content:
            a.text +
            (a.sources?.length
              ? `\n\n该回答的检索来源：${JSON.stringify(a.sources.map(({ id, title, url }) => ({ id, title, url })))}`
              : ""),
        },
      );
      i++;
    }
  }
  return [...context, { role: "user", content: question }];
}

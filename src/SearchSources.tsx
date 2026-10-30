import { useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import type { SearchSource } from "./chatData";
import { command } from "./native";
import { CopyButton } from "./MessageContent";

export function SearchSources({
  sources,
  note,
}: {
  sources?: SearchSource[];
  note?: string;
}) {
  const [error, setError] = useState("");
  async function open(url: string) {
    setError("");
    try {
      await command("open_source", { url });
    } catch (e) {
      setError(String(e));
    }
  }
  if (!sources?.length)
    return note ? (
      <p className="search-note">
        <Globe size={12} />
        {note}
      </p>
    ) : null;
  return (
    <details className="search-sources">
      <summary>
        <Globe size={13} />
        参考来源 · {sources.length}
        <span>查看网页</span>
      </summary>
      {note && <p className="search-note">{note}</p>}
      <ol>
        {sources.map((source) => (
          <li key={source.id} value={source.id}>
            <button
              className="source-link"
              title={source.url}
              aria-label={`打开来源 ${source.id}：${source.title}`}
              onClick={() => void open(source.url)}
            >
              <span>{source.title}</span>
              <ExternalLink size={12} />
            </button>
            <small className="source-url">{source.url}</small>
            {source.snippet && <p>{source.snippet}</p>}
            <CopyButton text={source.url} label="复制链接" />
          </li>
        ))}
      </ol>
      {error && (
        <p className="message-note error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

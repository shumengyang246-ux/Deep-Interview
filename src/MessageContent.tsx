import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CopyButton({
  text,
  label,
}: {
  text: string | (() => string);
  label: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        typeof text === "function" ? text() : text,
      );
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }
  return (
    <span className="copy-control">
      <button
        className="copy-button"
        aria-label={label}
        onClick={() => void copy()}
        title={label}
      >
        {status === "copied" ? <Check size={12} /> : <Copy size={12} />}
        {status === "copied" ? "已复制" : label}
      </button>
      {status === "error" && (
        <span role="status" className="copy-error">
          复制失败，请选中文字复制
        </span>
      )}
    </span>
  );
}
function CodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const code = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>代码</span>
        <CopyButton
          label="复制代码"
          text={() => code.current?.textContent ?? ""}
        />
      </div>
      <pre ref={code}>{children}</pre>
    </div>
  );
}
export function MessageContent({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre: CodeBlock,
          img: ({ alt }) => <span>{alt || "图片"}</span>,
          a: ({ children, href }) => (
            <span className="answer-link" title={href}>
              {children}
            </span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

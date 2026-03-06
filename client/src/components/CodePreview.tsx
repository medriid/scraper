import { useState, useEffect, useRef } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";

// Monochrome override on top of oneDark
const monoStyle: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...((oneDark as Record<string, React.CSSProperties>)['pre[class*="language-"]'] ?? {}),
    background: "var(--bg)",
    margin: 0,
    borderRadius: 0,
    fontSize: "0.78rem",
    lineHeight: "1.7",
  },
  'code[class*="language-"]': {
    ...((oneDark as Record<string, React.CSSProperties>)['code[class*="language-"]'] ?? {}),
    background: "transparent",
    fontSize: "0.78rem",
  },
};

interface Props {
  code: string;
  filename?: string;
  streaming?: boolean;
  maxHeight?: number;
  showCopy?: boolean;
}

export default function CodePreview({
  code,
  filename = "scraper.ts",
  streaming = false,
  maxHeight = 480,
  showCopy = true,
}: Props) {
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll while streaming
  useEffect(() => {
    if (streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [code, streaming]);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const lineCount = code.split("\n").length;

  return (
    <div className="code-stream-wrapper">
      <div className="code-stream-header">
        <div className={`code-stream-filename ${streaming ? "streaming" : ""}`}>
          {filename}
          {streaming && (
            <span style={{ marginLeft: 8, fontSize: "0.7rem", color: "var(--text-4)" }}>
              {lineCount} lines…
            </span>
          )}
          {!streaming && (
            <span style={{ marginLeft: 8, fontSize: "0.7rem", color: "var(--text-4)" }}>
              {lineCount} lines
            </span>
          )}
        </div>
        {showCopy && !streaming && (
          <button className="copy-btn" onClick={handleCopy} title="Copy code">
            {copied ? (
              <><Check size={11} style={{ display: "inline", marginRight: 4 }} />copied</>
            ) : (
              <><Copy size={11} style={{ display: "inline", marginRight: 4 }} />copy</>
            )}
          </button>
        )}
      </div>

      <div
        ref={bodyRef}
        className="code-stream-body"
        style={{ maxHeight }}
      >
        <SyntaxHighlighter
          language="typescript"
          style={monoStyle}
          showLineNumbers
          lineNumberStyle={{
            color: "var(--text-4)",
            fontSize: "0.72rem",
            minWidth: "2.5em",
            userSelect: "none",
          }}
          wrapLongLines={false}
        >
          {code || "// Waiting for AI…"}
        </SyntaxHighlighter>
        {streaming && <span className="code-cursor" />}
      </div>
    </div>
  );
}

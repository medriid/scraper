import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, Download, AlertTriangle } from "lucide-react";
import type { SessionResult, OutputLanguage } from "../types";
import CodePreview from "./CodePreview";
import SchemaViewer from "./SchemaViewer";

interface Props {
  result: SessionResult | null;
  error: string | null;
  codeStream: string;
  onReset: () => void;
  language: OutputLanguage;
}

type Tab = "schema" | "prompt" | "analysis" | "file";

export default function ResultsPanel({ result, error, codeStream, onReset, language }: Props) {
  const [tab, setTab] = useState<Tab>("file");

  const apiFile = result?.apiFile ?? codeStream;
  const ext = language === "python" ? "py" : "ts";
  const filename = `scraper.${ext}`;

  function handleDownload() {
    if (!apiFile) return;
    const blob = new Blob([apiFile], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Error state */}
      {error && (
        <motion.div
          className="error-msg panel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: "var(--space-md)" }}
        >
          <strong>Session failed:</strong> {error}
        </motion.div>
      )}

      {/* Truncation warning */}
      {result?.wasTruncated && (
        <motion.div
          className="warning-msg panel truncation-warning"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ 
            marginBottom: "var(--space-md)", 
            background: "rgba(234, 179, 8, 0.1)",
            border: "1px solid rgba(234, 179, 8, 0.3)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-sm) var(--space-md)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            color: "#eab308",
            fontSize: "0.85rem",
          }}
        >
          <AlertTriangle size={16} />
          <span>
            <strong>Warning:</strong> The generated code may be incomplete. 
            The model output was truncated before completion. 
            Try simplifying your request or running again.
          </span>
        </motion.div>
      )}

      {/* Results */}
      {result && (
        <motion.div
          className="panel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Tabs */}
          <div className="tabs">
            {(["file", "schema", "prompt", "analysis"] as Tab[]).map((t) => (
              <button
                key={t}
                className={`tab ${tab === t ? "tab--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "file"
                  ? filename
                  : t === "schema"
                  ? "JSON Schema"
                  : t === "prompt"
                  ? "Refined Prompt"
                  : "Analysis"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {tab === "file" && (
              <motion.div
                key="file"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <CodePreview
                  code={apiFile}
                  filename={filename}
                  streaming={false}
                  maxHeight={520}
                  showCopy
                />
              </motion.div>
            )}

            {tab === "schema" && (
              <motion.div
                key="schema"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <SchemaViewer schema={result.schema} />
              </motion.div>
            )}

            {tab === "prompt" && (
              <motion.div
                key="prompt"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <pre className="refined-prompt">{result.refinedPrompt}</pre>
              </motion.div>
            )}

            {tab === "analysis" && (
              <motion.div
                key="analysis"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <pre className="refined-prompt">{result.analysis}</pre>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Show code stream if no result yet */}
      {!result && !error && codeStream.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <CodePreview
            code={codeStream}
            filename={filename}
            streaming={false}
            maxHeight={520}
            showCopy
          />
        </motion.div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginTop: "var(--space-lg)", justifyContent: "flex-end" }}>
        {apiFile && (
          <button className="btn btn-secondary" onClick={handleDownload}>
            <Download size={14} />
            Download {filename}
          </button>
        )}
        <button className="btn btn-secondary" onClick={onReset}>
          <RotateCcw size={14} />
          New session
        </button>
      </div>
    </div>
  );
}

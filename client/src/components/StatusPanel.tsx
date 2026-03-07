import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Brain,
  Globe,
  Download,
  Search,
  Radar,
  Network,
  Wand2,
  Code2,
  Hammer,
  CheckCircle2,
  XCircle,
  Loader2,
  FlaskConical,
  ShieldCheck,
  Layers,
  Copy,
  Check,
  FileDown,
} from "lucide-react";
import { useState } from "react";
import type { AgentStep, SessionPhase, SessionConfig } from "../types";
import CodePreview from "./CodePreview";

interface Props {
  config: SessionConfig | null;
  steps: AgentStep[];
  codeStream: string;
  phase: SessionPhase;
  onClose: () => void;
  onCancel?: () => void;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  thinking: <Brain size={13} />,
  browsing: <Globe size={13} />,
  fetching: <Download size={13} />,
  analyzing: <Search size={13} />,
  discovering: <Radar size={13} />,
  distilling: <Layers size={13} />,
  crawling: <Network size={13} />,
  refining: <Wand2 size={13} />,
  testing: <FlaskConical size={13} />,
  validating: <ShieldCheck size={13} />,
  building: <Hammer size={13} />,
  generating: <Code2 size={13} />,
  complete: <CheckCircle2 size={13} />,
  error: <XCircle size={13} />,
};

const STEP_COLORS: Record<string, string> = {
  thinking: "var(--step-thinking)",
  browsing: "var(--step-browsing)",
  fetching: "var(--step-fetching)",
  analyzing: "var(--step-analyzing)",
  discovering: "var(--step-discovering)",
  distilling: "#b8a9d4",
  crawling: "var(--step-crawling)",
  refining: "var(--step-refining)",
  testing: "var(--step-testing)",
  validating: "var(--step-validating)",
  building: "var(--step-building)",
  generating: "var(--step-generating)",
  complete: "var(--step-complete)",
  error: "var(--step-error)",
};

type PanelTab = "steps" | "code";

export default function StatusPanel({ config, steps, codeStream, phase, onClose, onCancel }: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>("steps");
  const [copied, setCopied] = useState(false);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  const isRunning = phase === "running";
  const isComplete = phase === "complete";
  const isError = phase === "error";

  // Auto-switch to code tab when code starts streaming
  useEffect(() => {
    if (codeStream.length > 100 && isRunning) {
      setActiveTab("code");
    }
  }, [codeStream.length, isRunning]);

  // Scroll to bottom of steps
  useEffect(() => {
    if (activeTab === "steps") {
      stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [steps.length, activeTab]);

  function handleCopy() {
    if (codeStream) {
      navigator.clipboard.writeText(codeStream).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDownload() {
    if (!codeStream) return;
    const ext = config?.language === "python" ? "py" : "ts";
    const blob = new Blob([codeStream], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scraper.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Progress bar value
  const lastStep = steps[steps.length - 1];
  const ORDERED_PHASES = ["discovering", "distilling", "crawling", "analyzing", "thinking", "refining", "building", "generating"];
  const phaseIdx = ORDERED_PHASES.indexOf(lastStep?.type ?? "");
  const progressPct = isComplete ? 100 : isError ? 0 : Math.max(5, ((phaseIdx + 1) / ORDERED_PHASES.length) * 95);

  return (
    <div className="status-panel">
      {/* Header */}
      <div className="status-panel__header">
        <div className="status-panel__header-left">
          <div className={`status-indicator ${isRunning ? "status-indicator--running" : isComplete ? "status-indicator--complete" : isError ? "status-indicator--error" : ""}`}>
            {isRunning && (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                <Loader2 size={13} />
              </motion.div>
            )}
            {isComplete && <CheckCircle2 size={13} />}
            {isError && <XCircle size={13} />}
            {!isRunning && !isComplete && !isError && <Loader2 size={13} />}
          </div>
          <span className="status-panel__status-text">
            {isRunning ? "Agent running…" : isComplete ? "Scraper ready" : isError ? "Session failed" : "Starting…"}
          </span>
        </div>
        <div className="status-panel__header-actions">
          {isRunning && onCancel && (
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>
              Stop
            </button>
          )}
          <button className="status-panel__close-btn" onClick={onClose} title="Close panel">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="status-panel__progress-track">
        <motion.div
          className={`status-panel__progress-fill ${isComplete ? "status-panel__progress-fill--complete" : isError ? "status-panel__progress-fill--error" : ""}`}
          initial={{ width: "5%" }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      {/* Config summary */}
      {config && (
        <div className="status-panel__config">
          <span className="status-panel__config-url" title={config.websiteUrl}>
            <Globe size={11} />
            {config.websiteUrl.replace(/^https?:\/\//, "").slice(0, 50)}
          </span>
          <span className="status-panel__config-sep">·</span>
          <span className="status-panel__config-model">{config.modelId}</span>
          <span className="status-panel__config-sep">·</span>
          <span className="status-panel__config-lang">{config.language}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="status-panel__tabs">
        <button
          className={`status-panel__tab ${activeTab === "steps" ? "status-panel__tab--active" : ""}`}
          onClick={() => setActiveTab("steps")}
        >
          Steps
          {steps.length > 0 && <span className="status-panel__tab-badge">{steps.length}</span>}
        </button>
        <button
          className={`status-panel__tab ${activeTab === "code" ? "status-panel__tab--active" : ""}`}
          onClick={() => setActiveTab("code")}
          disabled={!codeStream}
        >
          Code
          {codeStream && <span className="status-panel__tab-badge status-panel__tab-badge--green">✓</span>}
        </button>
      </div>

      {/* Panel body */}
      <div className="status-panel__body">
        {activeTab === "steps" && (
          <div className="status-steps">
            <AnimatePresence initial={false}>
              {steps.map((step, i) => (
                <motion.div
                  key={i}
                  className={`status-step status-step--${step.type}`}
                  initial={{ opacity: 0, x: -8, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  transition={{ duration: 0.2, delay: 0 }}
                >
                  <div className="status-step__icon" style={{ color: STEP_COLORS[step.type] ?? "var(--text-3)" }}>
                    {STEP_ICONS[step.type] ?? <Brain size={13} />}
                  </div>
                  <div className="status-step__content">
                    <div className="status-step__message">{step.message}</div>
                    {step.detail && (
                      <div className="status-step__detail">{step.detail}</div>
                    )}
                  </div>
                  {i === steps.length - 1 && isRunning && (
                    <motion.div
                      className="status-step__pulse"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {steps.length === 0 && (
              <div className="status-steps__empty">
                <motion.div
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-4)" }}
                >
                  <Loader2 size={13} />
                  Initialising…
                </motion.div>
              </div>
            )}

            <div ref={stepsEndRef} />
          </div>
        )}

        {activeTab === "code" && (
          <div className="status-code-panel">
            <div className="status-code-toolbar">
              <span className="status-code-filename">
                scraper.{config?.language === "python" ? "py" : "ts"}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-xs" onClick={handleCopy}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button className="btn btn-ghost btn-xs" onClick={handleDownload} disabled={!codeStream}>
                  <FileDown size={12} />
                  Download
                </button>
              </div>
            </div>
            {codeStream ? (
              <div className="status-code-content">
                <CodePreview code={codeStream} filename={`scraper.${config?.language === "python" ? "py" : "ts"}`} streaming={isRunning} maxHeight={600} />
              </div>
            ) : (
              <div className="status-code-empty">
                <motion.div
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ color: "var(--text-4)", fontSize: "0.85rem" }}
                >
                  Code will appear here once generation starts…
                </motion.div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

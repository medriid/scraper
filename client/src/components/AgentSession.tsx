import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Globe,
  Search,
  Wand2,
  Hammer,
  Code2,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
} from "lucide-react";
import type { AgentStep, SessionConfig, SessionPhase } from "../types";
import CodePreview from "./CodePreview";

interface Props {
  config: SessionConfig;
  steps: AgentStep[];
  codeStream: string;
  phase: SessionPhase;
  onCancel: () => void;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  thinking: <Brain size={13} />,
  browsing: <Globe size={13} />,
  analyzing: <Search size={13} />,
  refining: <Wand2 size={13} />,
  building: <Hammer size={13} />,
  generating: <Code2 size={13} />,
  complete: <CheckCircle2 size={13} />,
  error: <XCircle size={13} />,
};

const STEP_LABELS: Record<string, string> = {
  thinking: "Thinking",
  browsing: "Browsing",
  analyzing: "Analyzing",
  refining: "Refining",
  building: "Building",
  generating: "Generating Code",
  complete: "Complete",
  error: "Error",
};

const PHASE_STEPS = ["browsing", "analyzing", "refining", "building", "generating"] as const;

export default function AgentSession({ config, steps, codeStream, phase, onCancel }: Props) {
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  const isRunning = phase === "running";
  const isComplete = phase === "complete";
  const isError = phase === "error";

  const lastStep = steps[steps.length - 1];
  const currentStepType = lastStep?.type ?? "browsing";

  // Determine progress (0–5 steps)
  const stepProgress = PHASE_STEPS.indexOf(currentStepType as typeof PHASE_STEPS[number]);
  const progressPercent = isComplete ? 100 : isError ? 0 : Math.max(0, ((stepProgress + 1) / PHASE_STEPS.length) * 100);

  return (
    <div className="agent-session">
      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="agent-status-bar">
        <div className="agent-status-left">
          {isRunning && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              style={{ color: "var(--text-2)", display: "flex" }}
            >
              <Loader2 size={14} />
            </motion.div>
          )}
          {isComplete && <CheckCircle2 size={14} style={{ color: "#5ad98a" }} />}
          {isError && <XCircle size={14} style={{ color: "var(--step-error)" }} />}
          <span className="agent-status-label">
            {isRunning ? "Agent running…" : isComplete ? "Script ready" : "Session failed"}
          </span>
          <span className="agent-status-url">{config.websiteUrl}</span>
        </div>
        {isRunning && (
          <button className="btn btn-ghost agent-cancel-btn" onClick={onCancel} title="Cancel">
            <X size={13} />
            Cancel
          </button>
        )}
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────── */}
      {(isRunning || isComplete) && (
        <div className="agent-progress-track">
          <motion.div
            className="agent-progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      )}

      {/* ── Steps timeline ───────────────────────────────────────────────── */}
      <div className="agent-timeline">
        <AnimatePresence initial={false}>
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            return (
              <motion.div
                key={i}
                className={`agent-step-row ${isLast && isRunning ? "agent-step-row--active" : ""}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                {/* Timeline dot + connector */}
                <div className="agent-step-timeline">
                  <div className={`agent-step-dot step-dot--${step.type}`}>
                    {STEP_ICONS[step.type] ?? <Brain size={13} />}
                  </div>
                  {i < steps.length - 1 && <div className="agent-step-connector" />}
                </div>

                {/* Content */}
                <div className="agent-step-content">
                  <div className="agent-step-head">
                    <span className="agent-step-type">{STEP_LABELS[step.type] ?? step.type}</span>
                    <span className="agent-step-message">{step.message}</span>
                  </div>
                  {step.detail && (
                    <motion.p
                      className="agent-step-detail"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.1 }}
                    >
                      {step.detail}
                    </motion.p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Working indicator */}
        {isRunning && steps.length > 0 && (
          <motion.div
            className="agent-step-row agent-working-row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="agent-step-timeline">
              <div className="agent-step-dot step-dot--working">
                <ThinkingDots />
              </div>
            </div>
            <div className="agent-step-content">
              <span className="agent-step-type">Working</span>
            </div>
          </motion.div>
        )}

        <div ref={stepsEndRef} />
      </div>

      {/* ── Live code stream ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {codeStream.length > 0 && (
          <motion.div
            className="agent-code-section"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="agent-code-header">
              <Code2 size={13} />
              <span>scraper.ts</span>
              {isRunning && <span className="agent-code-streaming">streaming…</span>}
            </div>
            <CodePreview
              code={codeStream}
              filename="scraper.ts"
              streaming={isRunning}
              maxHeight={380}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--text-3)",
            display: "inline-block",
          }}
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

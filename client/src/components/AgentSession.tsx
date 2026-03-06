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
  thinking: <Brain size={14} />,
  browsing: <Globe size={14} />,
  analyzing: <Search size={14} />,
  refining: <Wand2 size={14} />,
  building: <Hammer size={14} />,
  generating: <Code2 size={14} />,
  complete: <CheckCircle2 size={14} />,
  error: <XCircle size={14} />,
};

const STEP_SEQUENCE_LABEL: Record<string, string> = {
  thinking: "thinking",
  browsing: "browsing",
  analyzing: "analyzing",
  refining: "refining",
  building: "building",
  generating: "generating code",
  complete: "done",
  error: "error",
};

export default function AgentSession({ config, steps, codeStream, phase, onCancel }: Props) {
  const stepsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll steps
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  const isRunning = phase === "running";

  return (
    <div className="agent-container">
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-md) var(--space-lg)",
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isRunning && (
            <motion.div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--text-2)",
              }}
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
          )}
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)" }}>
            {isRunning ? "Agent running…" : phase === "complete" ? "Agent complete" : "Agent session"}
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-4)",
              fontFamily: "var(--font-mono)",
              maxWidth: 280,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {config.websiteUrl}
          </span>
        </div>
        {isRunning && (
          <button className="btn btn-ghost" onClick={onCancel} title="Cancel session">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Steps list */}
      <div
        className="agent-steps"
        style={{ maxHeight: 480, overflowY: "auto", paddingRight: 4 }}
      >
        <AnimatePresence initial={false}>
          {steps.map((step, i) => (
            <motion.div
              key={i}
              className="agent-step"
              initial={{ opacity: 0, x: -16, height: 0 }}
              animate={{ opacity: 1, x: 0, height: "auto" }}
              transition={{ duration: 0.3, delay: 0.05 }}
            >
              {/* Icon */}
              <div className={`step-icon-wrap step-icon--${step.type}`}>
                {STEP_ICONS[step.type] ?? <Brain size={14} />}
              </div>

              {/* Body */}
              <div className="step-body">
                <div className="step-type-label">
                  {STEP_SEQUENCE_LABEL[step.type] ?? step.type}
                </div>
                <div className="step-message">{step.message}</div>
                {step.detail && (
                  <motion.div
                    className="step-detail"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: 0.25, delay: 0.1 }}
                  >
                    {step.detail}
                  </motion.div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Thinking indicator while running */}
        {isRunning && steps.length > 0 && (
          <motion.div
            className="agent-step"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ borderStyle: "dashed" }}
          >
            <div className="step-icon-wrap">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
              >
                <Brain size={14} style={{ color: "var(--text-3)" }} />
              </motion.div>
            </div>
            <div className="step-body">
              <div className="step-type-label">working</div>
              <ThinkingDots />
            </div>
          </motion.div>
        )}

        <div ref={stepsEndRef} />
      </div>

      {/* Live code stream */}
      <AnimatePresence>
        {codeStream.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <CodePreview
              code={codeStream}
              filename="scraper.ts"
              streaming={isRunning}
              maxHeight={360}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", height: 20 }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--text-3)",
            display: "inline-block",
          }}
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -4, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

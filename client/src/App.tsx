import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, History, LogOut, User } from "lucide-react";
import { fetchModels } from "./lib/api";
import { startAgentSession } from "./lib/api";
import type { ModelOption, AgentStep, SessionPhase, SessionConfig, SessionResult } from "./types";
import ConfigForm from "./components/ConfigForm";
import AgentSession from "./components/AgentSession";
import ResultsPanel from "./components/ResultsPanel";
import StepBar from "./components/StepBar";
import SessionHistory from "./components/SessionHistory";
import LandingPage from "./components/LandingPage";
import ScrapexLogo from "./components/icons/ScrapexLogo";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

type AppStep = "config" | "running" | "results";
type AppView = "landing" | "app";

function AppContent() {
  const [view, setView] = useState<AppView>("landing");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [keyStatus, setKeyStatus] = useState({ gemini: 0, openrouter: 0 });
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [appStep, setAppStep] = useState<AppStep>("config");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [codeChunks, setCodeChunks] = useState<string>("");
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  const { user, profile, signOut } = useAuth();

  useEffect(() => {
    if (view === "app") {
      fetchModels()
        .then(({ models, keyStatus }) => {
          setModels(models);
          setKeyStatus({ gemini: keyStatus.gemini ?? 0, openrouter: keyStatus.openrouter ?? 0 });
        })
        .catch(console.warn);
    }
  }, [view]);

  const handleStart = useCallback((cfg: SessionConfig) => {
    setConfig(cfg);
    setAppStep("running");
    setPhase("running");
    setSteps([]);
    setCodeChunks("");
    setResult(null);
    setError(null);

    const cancel = startAgentSession(
      cfg.websiteUrl,
      cfg.instructions,
      cfg.modelId,
      (step) => {
        setSteps((prev) => [...prev, step]);
        if (step.type === "complete" && step.data) {
          const d = step.data;
          setResult({
            schema: d.schema ?? {},
            refinedPrompt: d.refinedPrompt ?? "",
            analysis: d.analysis ?? "",
            apiFile: d.apiFile ?? "",
          });
        }
      },
      (chunk) => setCodeChunks((prev) => prev + chunk),
      (_sid) => {
        setPhase("complete");
        setAppStep("results");
      },
      (msg) => {
        setError(msg);
        setPhase("error");
        setAppStep("results");
      }
    );
    setCancelFn(() => cancel);
  }, []);

  const handleReset = () => {
    cancelFn?.();
    setAppStep("config");
    setPhase("idle");
    setSteps([]);
    setCodeChunks("");
    setResult(null);
    setError(null);
    setCancelFn(null);
  };

  const stepIndex = appStep === "config" ? 0 : appStep === "running" ? 1 : 2;

  if (view === "landing") {
    return <LandingPage onEnterApp={() => setView("app")} />;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <a
              href="/"
              className="logo"
              onClick={(e) => { e.preventDefault(); setView("landing"); handleReset(); }}
            >
              <ScrapexLogo size={20} className="logo-icon" />
              Scrapex
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {user && (
                <div className="header-user">
                  <User size={12} />
                  <span>{profile?.display_name ?? user.email?.split("@")[0]}</span>
                  {profile?.is_owner && <span className="owner-badge">owner</span>}
                </div>
              )}
              <div className="header-status">
                <span
                  className={`status-dot ${keyStatus.gemini > 0 || keyStatus.openrouter > 0 ? "online" : ""}`}
                />
                {keyStatus.gemini > 0 && (
                  <span>{keyStatus.gemini} Gemini key{keyStatus.gemini !== 1 ? "s" : ""}</span>
                )}
                {keyStatus.openrouter > 0 && (
                  <span>{keyStatus.openrouter} OR key{keyStatus.openrouter !== 1 ? "s" : ""}</span>
                )}
                {keyStatus.gemini === 0 && keyStatus.openrouter === 0 && (
                  <span style={{ color: "var(--step-error)" }}>no keys configured</span>
                )}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setShowHistory((v) => !v)}
                title="Session history"
              >
                <History size={15} />
              </button>
              {user && (
                <button
                  className="btn btn-ghost"
                  onClick={signOut}
                  title="Sign out"
                >
                  <LogOut size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="main">
        <div className="container">
          {/* Hero */}
          <AnimatePresence>
            {appStep === "config" && (
              <motion.div
                className="hero"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="hero-badge">
                  <Zap size={10} />
                  Agentic Web Extraction
                </div>
                <h1>Scrape any website<br />with AI-generated TypeScript</h1>
                <p>
                  Give the AI a URL and instructions. It will analyse the site,
                  design a data schema, refine the prompt, and write a production-ready
                  TypeScript scraper — live, step by step.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step bar */}
          <StepBar current={stepIndex} />

          {/* Panel area */}
          <AnimatePresence mode="wait">
            {appStep === "config" && (
              <motion.div
                key="config"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
              >
                <ConfigForm models={models} keyStatus={keyStatus} onStart={handleStart} />
              </motion.div>
            )}

            {appStep === "running" && (
              <motion.div
                key="running"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
              >
                <AgentSession
                  config={config!}
                  steps={steps}
                  codeStream={codeChunks}
                  phase={phase}
                  onCancel={handleReset}
                />
              </motion.div>
            )}

            {appStep === "results" && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
              >
                <ResultsPanel
                  result={result}
                  error={error}
                  codeStream={codeChunks}
                  onReset={handleReset}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Session history drawer */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.25 }}
              >
                <SessionHistory onClose={() => setShowHistory(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <p>Scrapex — Agentic Web Extraction · Heroku + Supabase + Gemini + OpenRouter</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

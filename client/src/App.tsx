import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal,
  History,
  BookOpen,
  Settings,
  LogOut,
  User,
  Lock,
  Zap,
  ChevronRight,
} from "lucide-react";
import { fetchModels } from "./lib/api";
import { startAgentSession } from "./lib/api";
import { supabase } from "./lib/supabase";
import type { ModelOption, AgentStep, SessionPhase, SessionConfig, SessionResult } from "./types";
import ConfigForm from "./components/ConfigForm";
import AgentSession from "./components/AgentSession";
import ResultsPanel from "./components/ResultsPanel";
import StepBar from "./components/StepBar";
import SessionHistory from "./components/SessionHistory";
import ScraperLibrary from "./components/ScraperLibrary";
import SettingsPanel from "./components/SettingsPanel";
import LandingPage from "./components/LandingPage";
import AuthModal from "./components/AuthModal";
import ScrapexLogo from "./components/icons/ScrapexLogo";
import DbStatusBadge from "./components/DbStatusBadge";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

const SHOW_DB_STATUS = import.meta.env.VITE_SHOW_DB_STATUS === "true";
const THEME_KEY = "scrapex-theme";

type AppStep = "config" | "running" | "results";
type AppView = "landing" | "app";
type SidebarTab = "session" | "history" | "library" | "settings";

const TAB_LABELS: Record<SidebarTab, string> = {
  session: "New Session",
  history: "History",
  library: "Library",
  settings: "Settings",
};

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return { theme, setTheme };
}

function AppContent() {
  const [view, setView] = useState<AppView>("landing");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("session");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [keyStatus, setKeyStatus] = useState({ gemini: 0, openrouter: 0, groq: 0 });
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [appStep, setAppStep] = useState<AppStep>("config");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [codeChunks, setCodeChunks] = useState<string>("");
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  const [gateAuthOpen, setGateAuthOpen] = useState(false);
  const [prefillConfig, setPrefillConfig] = useState<Partial<SessionConfig> | null>(null);
  const { user, profile, signOut, session, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const supabaseEnabled = supabase !== null;

  // Use a ref so handleStart always reads the latest session token
  // without needing session in its dependency array (avoids recreating
  // the callback every time the token refreshes while a session runs).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (view === "app") {
      fetchModels()
        .then(({ models, keyStatus }) => {
          setModels(models);
          setKeyStatus({
            gemini: keyStatus.gemini ?? 0,
            openrouter: keyStatus.openrouter ?? 0,
            groq: keyStatus.groq ?? 0,
          });
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

    // Always read the latest token via the ref — fixes the stale-closure
    // bug that caused "Authentication required" even for owner accounts.
    const token = sessionRef.current?.access_token;

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
      },
      token
    );
    setCancelFn(() => cancel);
  }, []);

  const handleReset = useCallback(() => {
    cancelFn?.();
    setAppStep("config");
    setPhase("idle");
    setSteps([]);
    setCodeChunks("");
    setResult(null);
    setError(null);
    setCancelFn(null);
    setPrefillConfig(null);
  }, [cancelFn]);

  // Re-run a session from the library
  const handleRerun = useCallback(
    (websiteUrl: string, instructions: string, modelId: string) => {
      handleReset();
      setPrefillConfig({ websiteUrl, instructions, modelId });
      setSidebarTab("session");
    },
    [handleReset]
  );

  const stepIndex = appStep === "config" ? 0 : appStep === "running" ? 1 : 2;

  // ── Landing ───────────────────────────────────────────────────────────────
  if (view === "landing") {
    return <LandingPage onEnterApp={() => setView("app")} />;
  }

  // ── Auth gates ────────────────────────────────────────────────────────────
  if (supabaseEnabled && loading) {
    return (
      <div className="access-gate">
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (supabaseEnabled && !user) {
    return (
      <>
        <div className="access-gate">
          <ScrapexLogo size={48} />
          <div className="access-gate-icon">
            <Lock size={20} />
          </div>
          <h2>Sign in to continue</h2>
          <p>Scrapex is restricted to authorized users. Sign in to check your access.</p>
          <button className="hero-btn-primary" onClick={() => setGateAuthOpen(true)}>
            Sign in →
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setView("landing")}
            style={{ fontSize: "0.82rem" }}
          >
            ← Back to home
          </button>
        </div>
        <AnimatePresence>
          {gateAuthOpen && (
            <AuthModal
              onClose={() => setGateAuthOpen(false)}
              onSuccess={() => setGateAuthOpen(false)}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  if (supabaseEnabled && user && profile != null && !profile.is_owner) {
    return (
      <div className="access-gate">
        <ScrapexLogo size={48} />
        <div className="access-gate-icon">
          <Lock size={20} />
        </div>
        <h2>Access restricted</h2>
        <p>
          Hi {profile.display_name ?? user.email?.split("@")[0] ?? "there"}, your account doesn't
          have access to Scrapex. Contact the owner to request access.
        </p>
        <button className="btn btn-ghost" onClick={signOut}>
          Sign out
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setView("landing")}
          style={{ fontSize: "0.82rem" }}
        >
          ← Back to home
        </button>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const sidebarItems: Array<{ id: SidebarTab; icon: React.ReactNode; label: string }> = [
    { id: "session", icon: <Terminal size={16} />, label: "New Session" },
    { id: "history", icon: <History size={16} />, label: "History" },
    { id: "library", icon: <BookOpen size={16} />, label: "Library" },
    { id: "settings", icon: <Settings size={16} />, label: "Settings" },
  ];

  return (
    <div className="dashboard">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <button
            className="sidebar-logo-btn"
            onClick={() => {
              handleReset();
              setView("landing");
            }}
            title="Go to home"
          >
            <ScrapexLogo size={18} className="logo-icon" />
            <span className="sidebar-logo-text">Scrapex</span>
          </button>
        </div>

        <nav className="sidebar-nav">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              className={`sidebar-item${sidebarTab === item.id ? " active" : ""}`}
              onClick={() => setSidebarTab(item.id)}
              title={item.label}
            >
              <span className="sidebar-item-icon">{item.icon}</span>
              <span className="sidebar-item-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-key-status">
          <span
            className={`status-dot ${
              keyStatus.gemini + keyStatus.openrouter + keyStatus.groq > 0 ? "online" : ""
            }`}
          />
          <span className="sidebar-key-label">
            {keyStatus.gemini + keyStatus.openrouter + keyStatus.groq > 0
              ? `${keyStatus.gemini + keyStatus.openrouter + keyStatus.groq} API key${
                  keyStatus.gemini + keyStatus.openrouter + keyStatus.groq !== 1 ? "s" : ""
                }`
              : "no keys"}
          </span>
          {SHOW_DB_STATUS && <DbStatusBadge />}
        </div>

        <div className="sidebar-footer">
          {user ? (
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                <User size={13} />
              </div>
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">
                  {profile?.display_name ?? user.email?.split("@")[0]}
                </span>
                {profile?.is_owner && <span className="owner-badge">owner</span>}
              </div>
              <button
                className="btn btn-ghost btn-icon sidebar-signout"
                onClick={signOut}
                title="Sign out"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                <User size={13} />
              </div>
              <span className="sidebar-user-name sidebar-item-label">Guest</span>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────── */}
      <div className="dashboard-main">
        <div className="dashboard-topbar">
          <div className="dashboard-topbar-title">{TAB_LABELS[sidebarTab]}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {appStep !== "config" && sidebarTab === "session" && (
              <button
                className="btn btn-ghost"
                onClick={handleReset}
                style={{ fontSize: "0.8rem", gap: 6 }}
              >
                ← New session
              </button>
            )}
          </div>
        </div>

        <div className="dashboard-content">
          <AnimatePresence mode="wait">
            {/* Session tab */}
            {sidebarTab === "session" && (
              <motion.div
                key="session-tab"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2 }}
              >
                <AnimatePresence>
                  {appStep === "config" && (
                    <motion.div
                      className="hero"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -14 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="hero-badge">
                        <Zap size={10} />
                        Agentic Web Extraction
                      </div>
                      <h1>
                        Scrape any website
                        <br />
                        with AI-generated TypeScript
                      </h1>
                      <p>
                        Give the AI a URL and instructions. It will analyse the site, design a data
                        schema, refine the prompt, and write a production-ready TypeScript
                        scraper — live, step by step.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <StepBar current={stepIndex} />

                <AnimatePresence mode="wait">
                  {appStep === "config" && (
                    <motion.div
                      key="config"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.22 }}
                    >
                      <ConfigForm
                        models={models}
                        keyStatus={keyStatus}
                        onStart={handleStart}
                        prefill={prefillConfig ?? undefined}
                      />
                    </motion.div>
                  )}

                  {appStep === "running" && (
                    <motion.div
                      key="running"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.22 }}
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
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.22 }}
                    >
                      <ResultsPanel
                        result={result}
                        error={error}
                        codeStream={codeChunks}
                        onReset={handleReset}
                      />
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: "0.8rem", gap: 6 }}
                          onClick={() => setSidebarTab("library")}
                        >
                          View in Library
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* History tab */}
            {sidebarTab === "history" && (
              <motion.div
                key="history-tab"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2 }}
              >
                <SessionHistory
                  onClose={() => setSidebarTab("session")}
                  token={session?.access_token}
                  inline
                />
              </motion.div>
            )}

            {/* Library tab */}
            {sidebarTab === "library" && (
              <motion.div
                key="library-tab"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2 }}
              >
                <ScraperLibrary token={session?.access_token} onRerun={handleRerun} />
              </motion.div>
            )}

            {/* Settings tab */}
            {sidebarTab === "settings" && (
              <motion.div
                key="settings-tab"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2 }}
              >
                <SettingsPanel keyStatus={keyStatus} theme={theme} onThemeChange={setTheme} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
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

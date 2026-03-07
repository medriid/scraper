import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal,
  History,
  BookOpen,
  Settings,
  LogOut,
  User,
  Zap,
  Users,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { fetchModels, fetchUsage, startAgentSession } from "../lib/api";
import type { ModelOption, AgentStep, SessionPhase, SessionConfig, SessionResult, DailyUsage } from "../types";
import CrawlInterface from "./CrawlInterface";
import StatusPanel from "./StatusPanel";
import ResultsPanel from "./ResultsPanel";
import SessionHistory from "./SessionHistory";
import ScraperLibrary from "./ScraperLibrary";
import SettingsPanel from "./SettingsPanel";
import TeamsPanel from "./TeamsPanel";
import ScrapexLogo from "./icons/ScrapexLogo";
import DbStatusBadge from "./DbStatusBadge";
import { useAuth } from "../contexts/AuthContext";

const SHOW_DB_STATUS = import.meta.env.VITE_SHOW_DB_STATUS === "true";

type SidebarTab = "session" | "history" | "library" | "teams" | "settings";

interface DashboardPageProps {
  onGoHome: () => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}

export default function DashboardPage({ onGoHome, theme, setTheme }: DashboardPageProps) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("session");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [keyStatus, setKeyStatus] = useState({ gemini: 0, openrouter: 0, groq: 0 });
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [codeChunks, setCodeChunks] = useState<string>("");
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  const [prefillConfig, setPrefillConfig] = useState<Partial<SessionConfig> | null>(null);
  const [usage, setUsage] = useState<DailyUsage | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { user, profile, signOut, session } = useAuth();

  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  useEffect(() => {
    fetchModels()
      .then(({ models, keyStatus }) => {
        setModels(models);
        setKeyStatus({ gemini: keyStatus.gemini ?? 0, openrouter: keyStatus.openrouter ?? 0, groq: keyStatus.groq ?? 0 });
      })
      .catch(console.warn);
  }, []);

  useEffect(() => {
    if (session?.access_token) {
      fetchUsage(session.access_token)
        .then((data) => setUsage(data.usage))
        .catch(console.warn);
    }
  }, [session?.access_token]);

  const handleStart = useCallback((cfg: SessionConfig) => {
    setConfig(cfg);
    setPhase("running");
    setSteps([]);
    setCodeChunks("");
    setResult(null);
    setError(null);
    setPanelOpen(true);

    const token = sessionRef.current?.access_token;

    const cancel = startAgentSession(
      cfg.websiteUrl,
      cfg.instructions,
      cfg.modelId,
      cfg.language,
      cfg.extractionMode,
      cfg.credentials,
      (step) => {
        setSteps((prev) => [...prev, step]);
        if (step.type === "complete" && step.data) {
          const d = step.data as { schema?: Record<string, unknown>; refinedPrompt?: string; analysis?: string; apiFile?: string };
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
        if (sessionRef.current?.access_token) {
          fetchUsage(sessionRef.current.access_token)
            .then((data) => setUsage(data.usage))
            .catch(console.warn);
        }
      },
      (msg) => {
        setError(msg);
        setPhase("error");
      },
      token
    );
    setCancelFn(() => cancel);
  }, []);

  const handleReset = useCallback(() => {
    cancelFn?.();
    setPhase("idle");
    setSteps([]);
    setCodeChunks("");
    setResult(null);
    setError(null);
    setCancelFn(null);
    setPrefillConfig(null);
    setPanelOpen(false);
  }, [cancelFn]);

  const handleRerun = useCallback(
    (websiteUrl: string, instructions: string, modelId: string) => {
      handleReset();
      setPrefillConfig({ websiteUrl, instructions, modelId });
      setSidebarTab("session");
    },
    [handleReset]
  );

  const isOwner = profile?.is_owner ?? false;
  const totalKeys = keyStatus.gemini + keyStatus.openrouter + keyStatus.groq;
  const isRunning = phase === "running";
  const isLimitReached = !isOwner && !!usage && usage.used >= usage.limit;

  const sidebarItems: Array<{ id: SidebarTab; icon: React.ReactNode; label: string }> = [
    { id: "session", icon: <Terminal size={16} />, label: "New Session" },
    { id: "history", icon: <History size={16} />, label: "History" },
    { id: "library", icon: <BookOpen size={16} />, label: "Library" },
    { id: "teams", icon: <Users size={16} />, label: "Teams" },
    { id: "settings", icon: <Settings size={16} />, label: "Settings" },
  ];

  return (
    <div className="dashboard">
      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {!sidebarCollapsed && (
          <motion.aside
            className="sidebar"
            initial={{ width: 0, minWidth: 0, opacity: 0 }}
            animate={{ width: 220, minWidth: 220, opacity: 1 }}
            exit={{ width: 0, minWidth: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            <div className="sidebar-logo">
              <button
                className="sidebar-logo-btn"
                onClick={() => { handleReset(); onGoHome(); }}
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

            {!isOwner && usage && (
              <div className="sidebar-usage">
                <div className="sidebar-usage-label">
                  <AlertCircle size={11} />
                  <span>Daily usage</span>
                </div>
                <div className="sidebar-usage-bar">
                  <div
                    className="sidebar-usage-fill"
                    style={{
                      width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                      background: usage.used >= usage.limit ? "var(--step-error)" : "var(--text-2)",
                    }}
                  />
                </div>
                <span className="sidebar-usage-count">
                  {usage.used}/{usage.limit} prompt{usage.limit !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            <div className="sidebar-key-status">
              <span className={`status-dot ${totalKeys > 0 ? "online" : ""}`} />
              <span className="sidebar-key-label">
                {totalKeys > 0 ? `${totalKeys} API key${totalKeys !== 1 ? "s" : ""}` : "no keys"}
              </span>
              {SHOW_DB_STATUS && <DbStatusBadge />}
            </div>

            <div className="sidebar-footer">
              {user ? (
                <div className="sidebar-user">
                  <div className="sidebar-user-avatar">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt={profile.display_name ?? "User avatar"} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                    ) : (
                      <User size={13} />
                    )}
                  </div>
                  <div className="sidebar-user-info">
                    <span className="sidebar-user-name">
                      {profile?.display_name ?? user.email?.split("@")[0]}
                    </span>
                    {isOwner && <span className="owner-badge">owner</span>}
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
                  <div className="sidebar-user-avatar"><User size={13} /></div>
                  <span className="sidebar-user-name sidebar-item-label">Guest</span>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main area ─────────────────────────────────────────────────── */}
      <div className="dashboard-main">
        {/* Topbar */}
        <div className="dashboard-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <div className="dashboard-topbar-title">
              {sidebarTab === "session" ? "Scraper" : sidebarTab.charAt(0).toUpperCase() + sidebarTab.slice(1)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {(phase === "complete" || phase === "error") && sidebarTab === "session" && (
              <button className="btn btn-ghost" style={{ fontSize: "0.8rem", gap: 6 }} onClick={handleReset}>
                ← New session
              </button>
            )}
          </div>
        </div>

        {/* Split content: crawl interface + optional status panel */}
        <div className="dashboard-split">
          <AnimatePresence mode="wait">
            {/* SESSION TAB */}
            {sidebarTab === "session" && (
              <motion.div
                key="session"
                className="dashboard-session-area"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2 }}
              >
                {/* Center crawl interface */}
                <div className={`crawl-main ${panelOpen ? "crawl-main--panel-open" : ""}`}>
                  {isLimitReached && (
                    <div className="usage-limit-banner" style={{ marginBottom: 16 }}>
                      <AlertCircle size={14} />
                      <span>
                        Daily limit reached ({usage?.used}/{usage?.limit} prompts). Resets at midnight UTC.
                      </span>
                    </div>
                  )}

                  <CrawlInterface
                    models={models}
                    keyStatus={keyStatus}
                    onStart={handleStart}
                    prefill={prefillConfig ?? undefined}
                    disabled={isLimitReached}
                    isRunning={isRunning}
                    onCancel={handleReset}
                  />

                  {/* Results shown inline below the interface when complete */}
                  <AnimatePresence>
                    {(phase === "complete" || phase === "error") && (
                      <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        style={{ marginTop: "var(--space-xl)" }}
                      >
                        <ResultsPanel
                          result={result}
                          error={error}
                          codeStream={codeChunks}
                          onReset={handleReset}
                          language={config?.language ?? "typescript"}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Right status panel */}
                <AnimatePresence>
                  {panelOpen && (
                    <motion.div
                      className="status-panel-wrapper"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 420, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                      <StatusPanel
                        config={config}
                        steps={steps}
                        codeStream={codeChunks}
                        phase={phase}
                        onClose={() => setPanelOpen(false)}
                        onCancel={isRunning ? handleReset : undefined}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Re-open panel button when closed */}
                {!panelOpen && steps.length > 0 && (
                  <button
                    className="panel-reopen-btn"
                    onClick={() => setPanelOpen(true)}
                    title="Show agent status"
                  >
                    <Zap size={13} />
                    <span>Status</span>
                  </button>
                )}
              </motion.div>
            )}

            {sidebarTab === "history" && (
              <motion.div key="history" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.2 }} className="dashboard-content">
                <SessionHistory onClose={() => setSidebarTab("session")} token={session?.access_token} inline />
              </motion.div>
            )}

            {sidebarTab === "library" && (
              <motion.div key="library" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.2 }} className="dashboard-content">
                <ScraperLibrary token={session?.access_token} onRerun={handleRerun} />
              </motion.div>
            )}

            {sidebarTab === "teams" && (
              <motion.div key="teams" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.2 }} className="dashboard-content">
                <TeamsPanel token={session?.access_token} userId={user?.id} />
              </motion.div>
            )}

            {sidebarTab === "settings" && (
              <motion.div key="settings" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.2 }} className="dashboard-content">
                <SettingsPanel keyStatus={keyStatus} theme={theme} onThemeChange={setTheme} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

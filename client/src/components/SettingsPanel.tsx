import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Key, Monitor, Sun, Moon, Cpu, RefreshCw } from "lucide-react";
import { fetchModels } from "../lib/api";

interface Props {
  keyStatus: { gemini: number; openrouter: number; groq: number };
  theme: "dark" | "light";
  onThemeChange: (t: "dark" | "light") => void;
}

interface ModelStats {
  total: number;
  free: number;
}

export default function SettingsPanel({ keyStatus, theme, onThemeChange }: Props) {
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());

  const totalKeys = keyStatus.gemini + keyStatus.openrouter + keyStatus.groq;

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const { models } = await fetchModels();
      setModelStats({
        total: models.length,
        free: models.filter((m) => m.free).length,
      });
      setLastChecked(new Date());
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  const providers: Array<{
    label: string;
    key: keyof typeof keyStatus;
    hint: string;
  }> = [
    { label: "Google Gemini", key: "gemini", hint: "GEMINI_API_KEY_1, _2, …" },
    { label: "OpenRouter", key: "openrouter", hint: "OPENROUTER_API_KEY_1, _2, …" },
    { label: "Groq", key: "groq", hint: "GROQ_API_KEY_1, _2, …" },
  ];

  return (
    <div className="settings-page">
      {/* ── API Keys ── */}
      <motion.section
        className="settings-section"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="settings-section-header">
          <Key size={16} />
          <h3>AI Provider Keys</h3>
          <button
            className="btn btn-ghost btn-icon"
            onClick={refreshStatus}
            disabled={refreshing}
            title="Refresh key status"
          >
            <RefreshCw size={13} className={refreshing ? "spin" : ""} />
          </button>
        </div>
        <p className="settings-section-desc">
          Keys are configured server-side via environment variables. Multiple keys per provider are
          automatically round-robin rotated.
        </p>

        <div className="settings-key-list">
          {providers.map((p, i) => {
            const count = keyStatus[p.key];
            return (
              <motion.div
                key={p.key}
                className="settings-key-row"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <div className="settings-key-info">
                  <span className="settings-key-label">{p.label}</span>
                  <span className="settings-key-hint">{p.hint}</span>
                </div>
                <div className={`settings-key-badge ${count > 0 ? "badge-ok" : "badge-missing"}`}>
                  {count > 0 ? `${count} key${count !== 1 ? "s" : ""}` : "not configured"}
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="settings-key-summary">
          <span
            className={`status-dot ${totalKeys > 0 ? "online" : ""}`}
            style={{ flexShrink: 0 }}
          />
          {totalKeys > 0
            ? `${totalKeys} total key${totalKeys !== 1 ? "s" : ""} active`
            : "No keys configured — add at least one key to run agent sessions"}
          {modelStats && (
            <span style={{ marginLeft: "auto", color: "var(--text-4)", fontSize: "0.75rem" }}>
              {modelStats.total} models ({modelStats.free} free)
            </span>
          )}
        </div>

        {lastChecked && (
          <p style={{ fontSize: "0.73rem", color: "var(--text-4)", marginTop: 4 }}>
            Last checked: {lastChecked.toLocaleTimeString()}
          </p>
        )}
      </motion.section>

      {/* ── Models ── */}
      <motion.section
        className="settings-section"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.08 }}
      >
        <div className="settings-section-header">
          <Cpu size={16} />
          <h3>Available Models</h3>
        </div>
        <p className="settings-section-desc">
          Models are available based on which API keys are configured. Select a model per session in
          the New Session tab.
        </p>
        {modelStats ? (
          <div className="settings-model-stats">
            <div className="settings-stat-card">
              <div className="settings-stat-value">{modelStats.total}</div>
              <div className="settings-stat-label">Total models</div>
            </div>
            <div className="settings-stat-card">
              <div className="settings-stat-value">{modelStats.free}</div>
              <div className="settings-stat-label">Free tier</div>
            </div>
            <div className="settings-stat-card">
              <div className="settings-stat-value">{modelStats.total - modelStats.free}</div>
              <div className="settings-stat-label">Paid</div>
            </div>
          </div>
        ) : (
          <div className="settings-placeholder">Loading model info…</div>
        )}
      </motion.section>

      {/* ── Appearance ── */}
      <motion.section
        className="settings-section"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.14 }}
      >
        <div className="settings-section-header">
          <Monitor size={16} />
          <h3>Appearance</h3>
        </div>
        <p className="settings-section-desc">Choose your preferred color scheme.</p>

        <div className="theme-toggle-group">
          <button
            className={`theme-option ${theme === "dark" ? "theme-option--active" : ""}`}
            onClick={() => onThemeChange("dark")}
          >
            <Moon size={15} />
            <span>Dark</span>
          </button>
          <button
            className={`theme-option ${theme === "light" ? "theme-option--active" : ""}`}
            onClick={() => onThemeChange("light")}
          >
            <Sun size={15} />
            <span>Light</span>
          </button>
        </div>
      </motion.section>

      {/* ── About ── */}
      <motion.section
        className="settings-section"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        style={{ border: "none" }}
      >
        <p style={{ fontSize: "0.78rem", color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>
          Scrapex · AI-powered web scraping · Heroku + Supabase + Gemini / OpenRouter / Groq
        </p>
      </motion.section>
    </div>
  );
}

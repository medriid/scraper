import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Clock, ExternalLink } from "lucide-react";

interface HistorySession {
  id: string;
  website_url: string;
  instructions: string;
  model_id: string;
  created_at: string;
}

interface Props {
  onClose: () => void;
  token?: string;
  /** When true, renders as a full page panel instead of a floating drawer */
  inline?: boolean;
}

export default function SessionHistory({ onClose, token, inline }: Props) {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/scraper/sessions", { headers })
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="panel"
      style={{ marginTop: inline ? 0 : "var(--space-lg)" }}
    >
      <div className="panel-header">
        <div className="panel-icon"><Clock size={15} /></div>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Session History</div>
          <div className="panel-subtitle">Recent scraping sessions from Supabase</div>
        </div>
        {!inline && (
          <button className="btn btn-ghost" onClick={onClose}><X size={14} /></button>
        )}
      </div>

      {loading && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-3)", fontSize: "0.85rem" }}>
          <div className="spinner" />
          Loading sessions…
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>
          No sessions yet — or Supabase is not configured.
        </p>
      )}

      {!loading && sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {sessions.map((s) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              style={{
                padding: "var(--space-sm) var(--space-md)",
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.website_url}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-3)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.instructions}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--text-4)",
                    fontFamily: "var(--font-mono)",
                    marginTop: 4,
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <span>{s.model_id}</span>
                  <span>·</span>
                  <span>{new Date(s.created_at).toLocaleString()}</span>
                </div>
              </div>
              <a
                href={s.website_url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
                style={{ padding: 4, flexShrink: 0 }}
              >
                <ExternalLink size={12} />
              </a>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

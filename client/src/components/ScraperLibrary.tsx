import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, ExternalLink, Play, Clock, ChevronRight, Search, Download, Code } from "lucide-react";
import CodePreview from "./CodePreview";

interface LibrarySession {
  id: string;
  website_url: string;
  instructions: string;
  model_id: string;
  created_at: string;
  generated_api_file?: string | null;
}

interface Props {
  token?: string;
  onRerun: (websiteUrl: string, instructions: string, modelId: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ScraperLibrary({ token, onRerun }: Props) {
  const [sessions, setSessions] = useState<LibrarySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/scraper/sessions", { headers })
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = sessions.filter(
    (s) =>
      s.website_url.toLowerCase().includes(search.toLowerCase()) ||
      s.instructions.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="library-page">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="library-header"
      >
        <div className="library-title-row">
          <BookOpen size={18} />
          <h2>Scraper Library</h2>
        </div>
        <p className="library-subtitle">
          Browse and re-run your past scraping sessions. Click any entry to expand details.
        </p>

        {sessions.length > 0 && (
          <div className="library-search-wrap">
            <Search size={13} className="library-search-icon" />
            <input
              className="library-search"
              placeholder="Filter by URL or instructions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </motion.div>

      {/* Content */}
      {loading && (
        <div className="library-loading">
          <div className="spinner" />
          <span>Loading sessions…</span>
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <motion.div
          className="library-empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <BookOpen size={32} style={{ color: "var(--text-4)" }} />
          <p>No sessions yet. Run your first agent session to populate the library.</p>
        </motion.div>
      )}

      {!loading && sessions.length > 0 && filtered.length === 0 && (
        <motion.div className="library-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p>No sessions match your search.</p>
        </motion.div>
      )}

      <div className="library-list">
        <AnimatePresence initial={false}>
          {filtered.map((s, i) => (
            <motion.div
              key={s.id}
              className={`library-item ${expanded === s.id ? "library-item--expanded" : ""}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ delay: i * 0.03 }}
              layout
            >
              {/* Summary row */}
              <button
                className="library-item-row"
                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              >
                <div className="library-item-main">
                  <div className="library-item-url">{s.website_url}</div>
                  <div className="library-item-preview">{s.instructions}</div>
                </div>
                <div className="library-item-meta">
                  <span className="library-item-time">
                    <Clock size={11} />
                    {timeAgo(s.created_at)}
                  </span>
                  <span className="library-item-model">{s.model_id}</span>
                  <ChevronRight
                    size={13}
                    style={{
                      transform: expanded === s.id ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                      color: "var(--text-4)",
                    }}
                  />
                </div>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {expanded === s.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="library-item-detail"
                  >
                    <div className="library-detail-block">
                      <div className="library-detail-label">Instructions</div>
                      <p className="library-detail-text">{s.instructions}</p>
                    </div>
                    <div className="library-detail-block">
                      <div className="library-detail-label">Model</div>
                      <code className="library-detail-code">{s.model_id}</code>
                    </div>
                    <div className="library-detail-block">
                      <div className="library-detail-label">Created</div>
                      <p className="library-detail-text">
                        {new Date(s.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="library-detail-actions">
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: "0.82rem", gap: 6, padding: "7px 14px" }}
                        onClick={() => onRerun(s.website_url, s.instructions, s.model_id)}
                      >
                        <Play size={12} />
                        Run again
                      </button>
                      {s.generated_api_file && (
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: "0.82rem", gap: 6, padding: "7px 14px" }}
                          onClick={() => {
                            const blob = new Blob([s.generated_api_file!], { type: "text/plain" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `scraper-${new Date(s.created_at).toISOString().slice(0, 10)}.ts`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          <Download size={12} />
                          Download code
                        </button>
                      )}
                      <a
                        href={s.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary"
                        style={{ fontSize: "0.82rem", gap: 6, padding: "7px 14px" }}
                      >
                        <ExternalLink size={12} />
                        Visit site
                      </a>
                    </div>

                    {s.generated_api_file && (
                      <div style={{ marginTop: "var(--space-md)" }}>
                        <div className="library-detail-label" style={{ marginBottom: "var(--space-sm)", display: "flex", alignItems: "center", gap: 6 }}>
                          <Code size={12} />
                          Generated Code
                        </div>
                        <CodePreview
                          code={s.generated_api_file}
                          filename="scraper"
                          streaming={false}
                          maxHeight={300}
                          showCopy
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {!loading && filtered.length > 0 && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-4)", textAlign: "center", marginTop: 16 }}>
          {filtered.length} session{filtered.length !== 1 ? "s" : ""}
          {search ? ` matching "${search}"` : ""}
        </p>
      )}
    </div>
  );
}

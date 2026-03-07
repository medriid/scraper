import { useEffect, useState } from "react";
import { Database, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type DbStatus = "checking" | "connected" | "disconnected";

interface DbStatusData {
  connected: boolean;
  latencyMs?: number;
  message?: string;
}

/**
 * Shows a Supabase database connection status badge.
 *
 * Controlled by the `VITE_SHOW_DB_STATUS` environment variable.
 * Set `VITE_SHOW_DB_STATUS=true` to display it on the website.
 * Set it to `false` (or omit it) to hide it entirely.
 */
export default function DbStatusBadge() {
  const [status, setStatus] = useState<DbStatus>("checking");
  const [data, setData] = useState<DbStatusData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/db-status");
        if (cancelled) return;
        if (res.ok) {
          const json: DbStatusData = await res.json();
          setData(json);
          setStatus(json.connected ? "connected" : "disconnected");
        } else {
          setStatus("disconnected");
          setData({ connected: false, message: `HTTP ${res.status}` });
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("disconnected");
        setData({ connected: false, message: String(err) });
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  const colors: Record<DbStatus, string> = {
    checking: "var(--text-4)",
    connected: "#6fcf97",
    disconnected: "var(--step-error)",
  };

  const icons: Record<DbStatus, React.ReactNode> = {
    checking: <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />,
    connected: <CheckCircle2 size={11} />,
    disconnected: <XCircle size={11} />,
  };

  const labels: Record<DbStatus, string> = {
    checking: "DB checking…",
    connected: data?.latencyMs != null ? `DB ${data.latencyMs}ms` : "DB connected",
    disconnected: data?.message ? `DB error: ${data.message}` : "DB disconnected",
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "0.75rem",
        fontFamily: "var(--font-mono)",
        color: colors[status],
        border: `1px solid ${colors[status]}44`,
        borderRadius: 999,
        padding: "2px 8px",
        background: `${colors[status]}11`,
        transition: "color 0.3s, border-color 0.3s",
        userSelect: "none",
      }}
      title={data?.message ?? undefined}
    >
      <Database size={11} />
      {icons[status]}
      <span>{labels[status]}</span>
    </div>
  );
}

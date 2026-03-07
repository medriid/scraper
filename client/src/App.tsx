import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { Lock } from "lucide-react";
import { supabase } from "./lib/supabase";
import LandingPage from "./components/LandingPage";
import DashboardPage from "./components/DashboardPage";
import AuthModal from "./components/AuthModal";
import ScrapexLogo from "./components/icons/ScrapexLogo";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

const THEME_KEY = "scrapex-theme";

type AppView = "landing" | "app";

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
  const [gateAuthOpen, setGateAuthOpen] = useState(false);
  const { user, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const supabaseEnabled = supabase !== null;

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

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <DashboardPage
      onGoHome={() => setView("landing")}
      theme={theme}
      setTheme={setTheme}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}


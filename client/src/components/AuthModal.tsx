import { useState } from "react";
import { motion } from "framer-motion";
import { X, Github } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import ScrapexLogo from "./icons/ScrapexLogo";

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type Mode = "signin" | "signup";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.35 11.1H12.18V13.83H18.69C18.36 17.64 15.19 19.27 12.19 19.27C8.36 19.27 5 16.25 5 12C5 7.9 8.2 4.73 12.2 4.73C15.29 4.73 17.1 6.7 17.1 6.7L19 4.72C19 4.72 16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12C2.03 17.05 6.16 22 12.25 22C17.6 22 21.5 18.33 21.5 12.91C21.5 11.76 21.35 11.1 21.35 11.1Z" />
    </svg>
  );
}

export default function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle, signInWithGitHub } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "github" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "signin") {
      const { error: err } = await signIn(email, password);
      if (err) {
        setError(err);
      } else {
        onSuccess();
      }
    } else {
      const { error: err } = await signUp(email, password, displayName || undefined);
      if (err) {
        setError(err);
      } else {
        setMessage("Check your email for a confirmation link.");
      }
    }

    setLoading(false);
  };

  const handleGoogle = async () => {
    setSocialLoading("google");
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) { setError(err); setSocialLoading(null); }
    // On success: browser redirects away, no further action needed
  };

  const handleGitHub = async () => {
    setSocialLoading("github");
    setError(null);
    const { error: err } = await signInWithGitHub();
    if (err) { setError(err); setSocialLoading(null); }
  };

  return (
    <motion.div
      className="auth-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="auth-modal"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="auth-close" onClick={onClose}>
          <X size={16} />
        </button>

        <div className="auth-header">
          <ScrapexLogo size={36} />
          <h2>Scrapex</h2>
          <p>{mode === "signin" ? "Sign in to your account" : "Create your account"}</p>
        </div>

        {/* Social login */}
        <div className="auth-social-btns">
          <button
            className="auth-social-btn"
            onClick={handleGoogle}
            disabled={!!socialLoading || loading}
          >
            {socialLoading === "google" ? <span className="auth-social-spinner" /> : <GoogleIcon />}
            Continue with Google
          </button>
          <button
            className="auth-social-btn"
            onClick={handleGitHub}
            disabled={!!socialLoading || loading}
          >
            {socialLoading === "github" ? <span className="auth-social-spinner" /> : <Github size={16} />}
            Continue with GitHub
          </button>
        </div>

        {/* Unified error display — covers both social and email errors */}
        {error && <p className="auth-error" style={{ marginBottom: 4 }}>{error}</p>}

        <div className="auth-divider"><span>or continue with email</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "signup" && (
            <div className="form-field">
              <label htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder={mode === "signup" ? "Min. 6 characters" : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>

          {message && <p className="auth-success">{message}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading || !!socialLoading} style={{ width: "100%" }}>
            {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="auth-footer">
          {mode === "signin" ? (
            <p>
              Don't have an account?{" "}
              <button className="auth-link" onClick={() => { setMode("signup"); setError(null); setMessage(null); }}>
                Sign up
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{" "}
              <button className="auth-link" onClick={() => { setMode("signin"); setError(null); setMessage(null); }}>
                Sign in
              </button>
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

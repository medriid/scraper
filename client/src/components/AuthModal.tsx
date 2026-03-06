import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import ScrapexLogo from "./icons/ScrapexLogo";

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type Mode = "signin" | "signup";

export default function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
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

          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-success">{message}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
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

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Globe,
  Zap,
  Shield,
  FileCode,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { ModelOption, SessionConfig, OutputLanguage, ExtractionMode, AuthCredentials } from "../types";

interface Props {
  models: ModelOption[];
  keyStatus: { gemini: number; openrouter: number; groq: number };
  onStart: (config: SessionConfig) => void;
  prefill?: Partial<SessionConfig>;
  disabled?: boolean;
  isRunning?: boolean;
  onCancel?: () => void;
}

const EXE_MODELS = ["exe-pro-1", "exe-light-1"];

export default function CrawlInterface({
  models,
  keyStatus,
  onStart,
  prefill,
  disabled = false,
  isRunning = false,
  onCancel,
}: Props) {
  const [url, setUrl] = useState(prefill?.websiteUrl ?? "");
  const [instructions, setInstructions] = useState(prefill?.instructions ?? "");
  const [selectedModel, setSelectedModel] = useState(prefill?.modelId ?? "exe-pro-1");
  const [language, setLanguage] = useState<OutputLanguage>(prefill?.language ?? "typescript");
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(
    prefill?.extractionMode ?? "scraper"
  );
  const [credentials, setCredentials] = useState<AuthCredentials>(prefill?.credentials ?? {});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [confirmPending, setConfirmPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefill?.websiteUrl) setUrl(prefill.websiteUrl);
    if (prefill?.instructions) setInstructions(prefill.instructions);
    if (prefill?.modelId) setSelectedModel(prefill.modelId);
    if (prefill?.language) setLanguage(prefill.language);
    if (prefill?.extractionMode) setExtractionMode(prefill.extractionMode);
    if (prefill?.credentials) setCredentials(prefill.credentials);
  }, [prefill]);

  const anyKeyAvailable = keyStatus.gemini > 0 || keyStatus.openrouter > 0 || keyStatus.groq > 0;

  function validateUrl(val: string): string | null {
    try {
      const u = new URL(val.startsWith("http") ? val : `https://${val}`);
      return u.href;
    } catch {
      return null;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || isRunning) return;

    const validUrl = validateUrl(url);
    if (!validUrl) {
      setUrlError("Enter a valid URL (e.g. https://example.com)");
      return;
    }
    if (instructions.trim().length < 5) return;
    setUrlError("");
    setConfirmPending(true);
  }

  function handleConfirm() {
    const validUrl = validateUrl(url)!;
    setConfirmPending(false);
    onStart({
      websiteUrl: validUrl,
      instructions: instructions.trim(),
      modelId: selectedModel,
      language,
      extractionMode,
      ...(extractionMode === "data_api" ? { credentials } : {}),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  // Derive selected model info
  const allModels = models;
  const exeModels = allModels.filter((m) => EXE_MODELS.includes(m.id));
  const otherModels = allModels.filter((m) => !EXE_MODELS.includes(m.id));
  const selectedModelInfo = allModels.find((m) => m.id === selectedModel);

  const canSubmit =
    !disabled &&
    !isRunning &&
    url.trim().length > 0 &&
    instructions.trim().length >= 5 &&
    anyKeyAvailable;

  return (
    <div className="crawl-interface">
      {/* Header */}
      <div className="crawl-interface__header">
        <div className="crawl-interface__title-row">
          <Sparkles size={18} style={{ color: "var(--text-2)" }} />
          <h2 className="crawl-interface__title">What do you want to scrape?</h2>
        </div>
        <p className="crawl-interface__subtitle">
          Enter a URL and describe the data you want — the AI will analyse the site, build a schema, and write production-ready scraper code.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="crawl-interface__form">
        {/* URL bar */}
        <div className="crawl-input-group">
          <div className="crawl-input-url">
            <Globe size={14} style={{ color: "var(--text-4)", flexShrink: 0 }} />
            <input
              className="crawl-url-input"
              type="text"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setUrlError(""); }}
              disabled={isRunning || disabled}
              autoFocus
            />
            {urlError && <span className="crawl-url-error">{urlError}</span>}
          </div>
        </div>

        {/* Instructions box + send */}
        <div className="crawl-prompt-box">
          <textarea
            ref={inputRef}
            className="crawl-prompt-input"
            placeholder={
              "Describe what data you want to extract…\n\nExamples:\n• Extract product names, prices, and ratings\n• Get all article titles, authors, and publish dates\n• Scrape job listings with company, title, and salary\n\nPress ⌘+Enter to start"
            }
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={6}
            disabled={isRunning || disabled}
          />
          <div className="crawl-prompt-footer">
            <div className="crawl-model-badge" onClick={() => setShowAdvanced((v) => !v)}>
              <Zap size={11} />
              <span>{selectedModelInfo?.name ?? selectedModel}</span>
              <ChevronDown size={11} />
            </div>
            <div className="crawl-prompt-actions">
              {isRunning && onCancel && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
                  <X size={13} />
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="btn btn-primary btn-sm crawl-send-btn"
                disabled={!canSubmit}
              >
                {isRunning ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}>
                      <Loader2 size={13} />
                    </motion.div>
                    Running…
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    Start
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Advanced options */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="crawl-advanced"
            >
              <div className="crawl-advanced__inner">
                {/* Model selection */}
                <div className="crawl-adv-section">
                  <div className="crawl-adv-label">
                    <Zap size={12} />
                    AI Model
                  </div>

                  {/* Exe presets — shown first */}
                  {exeModels.length > 0 && (
                    <div style={{ marginBottom: "var(--space-sm)" }}>
                      <div className="crawl-adv-sublabel">Scrapex Presets</div>
                      <div className="crawl-model-grid">
                        {exeModels.map((m) => (
                          <ModelChip
                            key={m.id}
                            model={m}
                            selected={selectedModel === m.id}
                            onSelect={() => m.available && setSelectedModel(m.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other models — collapsed by default */}
                  <ExpandableModelGroup models={otherModels} selectedModel={selectedModel} onSelect={setSelectedModel} />
                </div>

                {/* Language */}
                <div className="crawl-adv-section">
                  <div className="crawl-adv-label">
                    <FileCode size={12} />
                    Output Language
                  </div>
                  <div className="crawl-toggle-group">
                    {(["typescript", "python"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={`crawl-toggle ${language === lang ? "crawl-toggle--active" : ""}`}
                        onClick={() => setLanguage(lang)}
                      >
                        {lang === "typescript" ? "TypeScript" : "Python"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Extraction mode */}
                <div className="crawl-adv-section">
                  <div className="crawl-adv-label">
                    <Shield size={12} />
                    Extraction Mode
                  </div>
                  <div className="crawl-toggle-group">
                    {(["scraper", "data_api"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`crawl-toggle ${extractionMode === mode ? "crawl-toggle--active" : ""}`}
                        onClick={() => setExtractionMode(mode)}
                      >
                        {mode === "scraper" ? "Public Scraper" : "Authenticated API"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Credentials */}
                {extractionMode === "data_api" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="crawl-adv-section"
                  >
                    <div className="crawl-adv-label">Authentication Credentials</div>
                    <div className="crawl-credentials">
                      {[
                        { key: "email" as const, label: "Email", type: "email", placeholder: "user@example.com" },
                        { key: "password" as const, label: "Password", type: "password", placeholder: "••••••••" },
                        { key: "token" as const, label: "API Token", type: "text", placeholder: "Bearer token…" },
                        { key: "cookies" as const, label: "Cookies", type: "text", placeholder: "session=abc; token=xyz" },
                      ].map((field) => (
                        <div key={field.key} className="crawl-cred-field">
                          <label>{field.label}</label>
                          <input
                            className="form-input"
                            type={field.type}
                            placeholder={field.placeholder}
                            value={credentials[field.key] ?? ""}
                            onChange={(e) => setCredentials((c) => ({ ...c, [field.key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              <button
                type="button"
                className="crawl-advanced-close"
                onClick={() => setShowAdvanced(false)}
              >
                <ChevronUp size={13} /> Hide options
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {!showAdvanced && (
          <button
            type="button"
            className="crawl-show-options"
            onClick={() => setShowAdvanced(true)}
          >
            <ChevronDown size={12} />
            Options
          </button>
        )}
      </form>

      {/* Confirmation dialog */}
      <AnimatePresence>
        {confirmPending && (
          <motion.div
            className="crawl-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="crawl-confirm-dialog"
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ duration: 0.18 }}
            >
              <div className="crawl-confirm-title">Start crawl?</div>
              <div className="crawl-confirm-details">
                <div className="crawl-confirm-url">{url}</div>
                <div className="crawl-confirm-instruction">{instructions.slice(0, 120)}{instructions.length > 120 ? "…" : ""}</div>
              </div>
              <div className="crawl-confirm-meta">
                <span className="badge badge-exe">{selectedModelInfo?.name ?? selectedModel}</span>
                <span className="badge badge-lang">{language}</span>
                <span className="badge badge-mode">{extractionMode === "scraper" ? "public" : "auth"}</span>
              </div>
              <div className="crawl-confirm-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmPending(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleConfirm}>
                  <Zap size={13} />
                  Run Agent
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Model chip (compact) ─────────────────────────────────────────────────────

function ModelChip({
  model,
  selected,
  onSelect,
}: {
  model: ModelOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`crawl-model-chip ${selected ? "crawl-model-chip--selected" : ""} ${!model.available ? "crawl-model-chip--disabled" : ""}`}
      onClick={onSelect}
      disabled={!model.available}
      title={model.description}
    >
      <span className="crawl-model-chip-name">{model.name}</span>
      <span className="crawl-model-chip-ctx">{model.contextWindow}</span>
    </button>
  );
}

// ─── Expandable model group ───────────────────────────────────────────────────

function ExpandableModelGroup({
  models,
  selectedModel,
  onSelect,
}: {
  models: ModelOption[];
  selectedModel: string;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // If selected model is in this group, expand automatically
  useEffect(() => {
    if (models.some((m) => m.id === selectedModel)) setExpanded(true);
  }, [selectedModel, models]);

  const providers = ["gemini", "groq", "openrouter"] as const;

  return (
    <div>
      <button
        type="button"
        className="crawl-adv-expand-btn"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {expanded ? "Hide" : "Show"} individual models
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            {providers.map((prov) => {
              const group = models.filter((m) => m.provider === prov);
              if (group.length === 0) return null;
              return (
                <div key={prov} style={{ marginBottom: "var(--space-sm)" }}>
                  <div className="crawl-adv-sublabel" style={{ textTransform: "capitalize" }}>{prov}</div>
                  <div className="crawl-model-grid">
                    {group.map((m) => (
                      <ModelChip
                        key={m.id}
                        model={m}
                        selected={selectedModel === m.id}
                        onSelect={() => m.available && onSelect(m.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

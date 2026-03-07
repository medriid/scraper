import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Cpu, ChevronRight, FileCode } from "lucide-react";
import type { ModelOption, SessionConfig, OutputLanguage } from "../types";

interface Props {
  models: ModelOption[];
  keyStatus: { gemini: number; openrouter: number; groq: number };
  onStart: (config: SessionConfig) => void;
  /** Optional pre-filled values (e.g. from "Run again" in the Library) */
  prefill?: Partial<SessionConfig>;
  /** Disable form when user has hit their daily limit */
  disabled?: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini API",
  openrouter: "OpenRouter",
  groq: "Groq",
};

export default function ConfigForm({ models, keyStatus, onStart, prefill, disabled = false }: Props) {
  const [websiteUrl, setWebsiteUrl] = useState(prefill?.websiteUrl ?? "");
  const [instructions, setInstructions] = useState(prefill?.instructions ?? "");
  const [selectedModel, setSelectedModel] = useState<string>(
    prefill?.modelId ?? "gemini-2.0-flash"
  );
  const [language, setLanguage] = useState<OutputLanguage>(
    prefill?.language ?? "typescript"
  );
  const [urlError, setUrlError] = useState("");

  // Sync when prefill changes (e.g. switching back to session tab after "Run again").
  // Use the whole `prefill` object as the dependency so all three fields are
  // applied in a single effect run, avoiding staggered re-renders.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.websiteUrl) setWebsiteUrl(prefill.websiteUrl);
    if (prefill.instructions) setInstructions(prefill.instructions);
    if (prefill.modelId) setSelectedModel(prefill.modelId);
    if (prefill.language) setLanguage(prefill.language);
  }, [prefill]);

  // Group models by provider
  const geminiModels = models.filter((m) => m.provider === "gemini");
  const openrouterModels = models.filter((m) => m.provider === "openrouter");
  const groqModels = models.filter((m) => m.provider === "groq");

  const selectedModelInfo = models.find((m) => m.id === selectedModel);
  const canSubmit =
    !disabled &&
    websiteUrl.trim().length > 0 &&
    instructions.trim().length >= 5 &&
    selectedModel.length > 0 &&
    (keyStatus.gemini > 0 || keyStatus.openrouter > 0 || keyStatus.groq > 0);

  function validateUrl(val: string) {
    try {
      const u = new URL(val.startsWith("http") ? val : `https://${val}`);
      return u.href;
    } catch {
      return null;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = validateUrl(websiteUrl);
    if (!url) {
      setUrlError("Please enter a valid URL (e.g. https://example.com)");
      return;
    }
    setUrlError("");
    onStart({
      websiteUrl: url,
      instructions: instructions.trim(),
      modelId: selectedModel,
      language,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Target website */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-icon"><Globe size={15} /></div>
          <div>
            <div className="panel-title">Target Website</div>
            <div className="panel-subtitle">URL to scrape + what data you want</div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Website URL</label>
          <input
            className="form-input"
            type="text"
            placeholder="https://news.ycombinator.com"
            value={websiteUrl}
            onChange={(e) => { setWebsiteUrl(e.target.value); setUrlError(""); }}
            required
          />
          {urlError && (
            <span style={{ fontSize: "0.78rem", color: "var(--step-error)" }}>{urlError}</span>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Scraping Instructions</label>
          <textarea
            className="form-textarea"
            placeholder="Extract all article titles, points, authors and comment counts. Handle pagination up to 3 pages."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            required
          />
          <span style={{ fontSize: "0.75rem", color: "var(--text-4)" }}>
            Be specific — describe the data fields, pagination, filters, etc.
          </span>
        </div>
      </div>

      {/* Output language */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-icon"><FileCode size={15} /></div>
          <div>
            <div className="panel-title">Output Language</div>
            <div className="panel-subtitle">Choose the language for the generated scraper</div>
          </div>
        </div>

        <div className="model-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <motion.div
            className={`model-card ${language === "typescript" ? "model-card--selected" : ""}`}
            onClick={() => setLanguage("typescript")}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.1 }}
          >
            <div className="model-card-name">TypeScript</div>
            <div className="model-card-desc">Playwright + Node.js</div>
            <div style={{ marginTop: 6 }}>
              <span className="model-card-badge badge-provider">.ts</span>
            </div>
          </motion.div>
          <motion.div
            className={`model-card ${language === "python" ? "model-card--selected" : ""}`}
            onClick={() => setLanguage("python")}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.1 }}
          >
            <div className="model-card-name">Python</div>
            <div className="model-card-desc">Playwright + Python</div>
            <div style={{ marginTop: 6 }}>
              <span className="model-card-badge badge-provider">.py</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Model selector */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-icon"><Cpu size={15} /></div>
          <div>
            <div className="panel-title">AI Model</div>
            <div className="panel-subtitle">
              {keyStatus.gemini} Gemini key{keyStatus.gemini !== 1 ? "s" : ""} ·{" "}
              {keyStatus.openrouter} OpenRouter key{keyStatus.openrouter !== 1 ? "s" : ""} ·{" "}
              {keyStatus.groq} Groq key{keyStatus.groq !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* Gemini models */}
        {geminiModels.length > 0 && (
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-4)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-sm)" }}>
              {PROVIDER_LABELS.gemini}
            </div>
            <div className="model-grid">
              {geminiModels.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  selected={selectedModel === m.id}
                  disabled={!m.available}
                  onSelect={() => m.available && setSelectedModel(m.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* OpenRouter models */}
        {openrouterModels.length > 0 && (
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-4)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-sm)" }}>
              {PROVIDER_LABELS.openrouter}
            </div>
            <div className="model-grid">
              {openrouterModels.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  selected={selectedModel === m.id}
                  disabled={!m.available}
                  onSelect={() => m.available && setSelectedModel(m.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Groq models */}
        {groqModels.length > 0 && (
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-4)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-sm)" }}>
              {PROVIDER_LABELS.groq}
            </div>
            <div className="model-grid">
              {groqModels.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  selected={selectedModel === m.id}
                  disabled={!m.available}
                  onSelect={() => m.available && setSelectedModel(m.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* No keys notice */}
        {keyStatus.gemini === 0 && keyStatus.openrouter === 0 && keyStatus.groq === 0 && (
          <p className="error-msg" style={{ marginTop: "var(--space-md)" }}>
            No API keys configured. Set GEMINI_API_KEY_1, OPENROUTER_API_KEY_1, or GROQ_API_KEY_1 in your .env file.
          </p>
        )}

        {/* Selected model summary */}
        {selectedModelInfo && (
          <motion.div
            key={selectedModel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              marginTop: "var(--space-md)",
              padding: "var(--space-sm) var(--space-md)",
              background: "var(--bg-3)",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              fontSize: "0.8rem",
              color: "var(--text-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span style={{ color: "var(--text-2)" }}>{selectedModelInfo.name}</span>
            {" · "}
            {selectedModelInfo.contextWindow} ctx
            {" · "}
            {selectedModelInfo.free ? "free tier" : "paid"}
            {" · "}
            {selectedModelInfo.description}
          </motion.div>
        )}
      </div>

      {/* Submit */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-lg)" }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit}
          style={{ gap: 8, paddingRight: 20 }}
          title={disabled ? "Daily prompt limit reached. Resets at midnight UTC." : undefined}
        >
          Start Agent Session
          <ChevronRight size={15} />
        </button>
      </div>
    </form>
  );
}

function ModelCard({
  model,
  selected,
  disabled,
  onSelect,
}: {
  model: ModelOption;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.div
      className={`model-card ${selected ? "model-card--selected" : ""} ${disabled ? "model-card--disabled" : ""}`}
      onClick={onSelect}
      whileHover={!disabled ? { scale: 1.01 } : {}}
      whileTap={!disabled ? { scale: 0.99 } : {}}
      transition={{ duration: 0.1 }}
      layout
    >
      <div className="model-card-name">{model.name}</div>
      <div className="model-card-desc">{model.description}</div>
      <div style={{ marginTop: 6 }}>
        {model.free && <span className="model-card-badge badge-free">free</span>}
        <span className="model-card-badge badge-provider">{model.provider}</span>
        <span className="model-card-badge badge-provider">{model.contextWindow}</span>
      </div>
    </motion.div>
  );
}

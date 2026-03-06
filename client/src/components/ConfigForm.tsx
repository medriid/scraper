import { useState } from "react";
import { motion } from "framer-motion";
import { Globe, Cpu, ChevronRight } from "lucide-react";
import type { ModelOption, SessionConfig } from "../types";

interface Props {
  models: ModelOption[];
  keyStatus: { gemini: number; openrouter: number; groq: number };
  onStart: (config: SessionConfig) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini API",
  openrouter: "OpenRouter",
  groq: "Groq",
};

export default function ConfigForm({ models, keyStatus, onStart }: Props) {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    // Default to first available model
    return "gemini-2.0-flash";
  });
  const [urlError, setUrlError] = useState("");

  // Group models by provider
  const geminiModels = models.filter((m) => m.provider === "gemini");
  const openrouterModels = models.filter((m) => m.provider === "openrouter");
  const groqModels = models.filter((m) => m.provider === "groq");

  const selectedModelInfo = models.find((m) => m.id === selectedModel);
  const canSubmit =
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

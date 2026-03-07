import { Router, Request, Response } from "express";
import { AVAILABLE_MODELS } from "../services/aiService.js";
import { EXE_MODELS } from "../services/LlmProvider.js";
import { getKeyCount, GEMINI_PREFIX, OPENROUTER_PREFIX, GROQ_PREFIX } from "../services/keyRotation.js";

const router = Router();

// GET /api/models — list available models with key availability info
router.get("/", (_req: Request, res: Response): void => {
  const geminiKeys = getKeyCount(GEMINI_PREFIX);
  const openrouterKeys = getKeyCount(OPENROUTER_PREFIX);
  const groqKeys = getKeyCount(GROQ_PREFIX);

  const anyKeyAvailable = geminiKeys > 0 || openrouterKeys > 0 || groqKeys > 0;

  // Exe models are available if any keys are configured
  const exeModels = EXE_MODELS.map((m) => ({
    ...m,
    available: anyKeyAvailable,
  }));

  const models = AVAILABLE_MODELS.map((m) => ({
    ...m,
    available:
      m.provider === "gemini"
        ? geminiKeys > 0
        : m.provider === "groq"
        ? groqKeys > 0
        : openrouterKeys > 0,
  }));

  res.json({
    models: [...exeModels, ...models],
    keyStatus: {
      gemini: geminiKeys,
      openrouter: openrouterKeys,
      groq: groqKeys,
    },
  });
});

export default router;

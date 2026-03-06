import { Router, Request, Response } from "express";
import { AVAILABLE_MODELS } from "../services/aiService.js";
import { getKeyCount, GEMINI_PREFIX, OPENROUTER_PREFIX } from "../services/keyRotation.js";

const router = Router();

// GET /api/models — list available models with key availability info
router.get("/", (_req: Request, res: Response): void => {
  const geminiKeys = getKeyCount(GEMINI_PREFIX);
  const openrouterKeys = getKeyCount(OPENROUTER_PREFIX);

  const models = AVAILABLE_MODELS.map((m) => ({
    ...m,
    available:
      m.provider === "gemini" ? geminiKeys > 0 : openrouterKeys > 0,
  }));

  res.json({
    models,
    keyStatus: {
      gemini: geminiKeys,
      openrouter: openrouterKeys,
    },
  });
});

export default router;

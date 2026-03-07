import { Router, Request, Response } from "express";
import { z } from "zod";
import { runAgentSession } from "../services/agentService.js";
import { chatCompletion } from "../services/aiService.js";
import {
  createSession,
  getSession,
  listSessions,
  getUserDailyUsage,
  incrementUserDailyUsage,
} from "../services/supabaseService.js";
import { requireAuth } from "./auth.js";

const router = Router();

// ─── Schema: Start session ────────────────────────────────────────────────────
const StartSessionSchema = z.object({
  websiteUrl: z.string().url("Invalid URL"),
  instructions: z.string().min(5, "Instructions too short").max(2000),
  modelId: z.string().min(1, "Model ID required"),
  language: z.enum(["typescript", "python"]).default("typescript"),
});

// POST /api/scraper/start — creates DB session + streams agent via SSE
router.post("/start", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = StartSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { websiteUrl, instructions, modelId, language } = parse.data;
  const userId = (req as Request & { userId: string }).userId;

  // ── Per-user daily rate limiting ──────────────────────────────────────────
  const usage = await getUserDailyUsage(userId);
  if (!usage.isOwner && usage.used >= usage.limit) {
    res.status(429).json({
      error: `Daily limit reached. You have used ${usage.used}/${usage.limit} prompt${usage.limit !== 1 ? "s" : ""} today. Your limit resets at midnight UTC.`,
      usage,
    });
    return;
  }

  // Increment usage before running (prevents concurrent abuse)
  if (!usage.isOwner) {
    await incrementUserDailyUsage(userId);
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Create DB session (best-effort; null if Supabase not configured)
  const sessionId = await createSession({ website_url: websiteUrl, instructions, model_id: modelId, user_id: userId });

  await runAgentSession(sessionId, websiteUrl, instructions, modelId, language, res);
});

// GET /api/scraper/sessions — list recent sessions
router.get("/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const sessions = await listSessions(20, userId);
  res.json({ sessions });
});

// GET /api/scraper/sessions/:id — get single session
router.get("/sessions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const session = await getSession(String(req.params.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (session.user_id && session.user_id !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  res.json({ session });
});

// POST /api/scraper/schema — quick schema generation (no full session)
const QuickSchemaSchema = z.object({
  websiteUrl: z.string().url(),
  instructions: z.string().min(5).max(2000),
  modelId: z.string().min(1),
});

router.post("/schema", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = QuickSchemaSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { websiteUrl, instructions, modelId } = parse.data;

  try {
    const prompt = `Generate a JSON schema for scraping this website.
Website: ${websiteUrl}
Instructions: ${instructions}

Return ONLY valid JSON object representing one scraped record. No explanation, no markdown.`;

    const result = await chatCompletion(modelId, [{ role: "user", content: prompt }], 0.2, 1024);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    const schema = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "", url: "" };
    res.json({ schema });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI call failed";
    res.status(500).json({ error: message });
  }
});

// GET /api/scraper/usage — get current user's daily usage
router.get("/usage", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const usage = await getUserDailyUsage(userId);
  res.json({ usage });
});

export default router;

import { Router, Request, Response } from "express";
import { z } from "zod";
import { runAgentSession } from "../services/agentService.js";
import { chatCompletion } from "../services/aiService.js";
import {
  createSession,
  getSession,
  listSessions,
} from "../services/supabaseService.js";

const router = Router();

// ─── Schema: Start session ────────────────────────────────────────────────────
const StartSessionSchema = z.object({
  websiteUrl: z.string().url("Invalid URL"),
  instructions: z.string().min(5, "Instructions too short").max(2000),
  modelId: z.string().min(1, "Model ID required"),
});

// POST /api/scraper/start — creates DB session + streams agent via SSE
router.post("/start", async (req: Request, res: Response): Promise<void> => {
  const parse = StartSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { websiteUrl, instructions, modelId } = parse.data;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Create DB session (best-effort; null if Supabase not configured)
  const sessionId = await createSession({ website_url: websiteUrl, instructions, model_id: modelId });

  await runAgentSession(sessionId, websiteUrl, instructions, modelId, res);
});

// GET /api/scraper/sessions — list recent sessions
router.get("/sessions", async (_req: Request, res: Response): Promise<void> => {
  const sessions = await listSessions(20);
  res.json({ sessions });
});

// GET /api/scraper/sessions/:id — get single session
router.get("/sessions/:id", async (req: Request, res: Response): Promise<void> => {
  const session = await getSession(String(req.params.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
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

router.post("/schema", async (req: Request, res: Response): Promise<void> => {
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

export default router;

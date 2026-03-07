import { Router, Request, Response } from "express";
import { z } from "zod";
import { runAgentSession, createJob, getJob, runJobInBackground } from "../services/agentService.js";
import { chatCompletion } from "../services/aiService.js";
import { mapSite } from "../services/Crawler.js";
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
  extractionMode: z.enum(["scraper", "data_api"]).default("scraper"),
  credentials: z.object({
    email: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    cookies: z.string().optional(),
  }).optional(),
});

// POST /api/scraper/start — creates DB session + streams agent via SSE
router.post("/start", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = StartSessionSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { websiteUrl, instructions, modelId, language, extractionMode, credentials } = parse.data;
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

  await runAgentSession(sessionId, websiteUrl, instructions, modelId, language, extractionMode, credentials, res);
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

// ─── Job Queue Endpoints ──────────────────────────────────────────────────────

const CrawlJobSchema = z.object({
  websiteUrl: z.string().url("Invalid URL"),
  instructions: z.string().min(5, "Instructions too short").max(2000),
  modelId: z.string().min(1, "Model ID required"),
  language: z.enum(["typescript", "python"]).default("typescript"),
  extractionMode: z.enum(["scraper", "data_api"]).default("scraper"),
  credentials: z.object({
    email: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    cookies: z.string().optional(),
  }).optional(),
});

// POST /api/scraper/crawl — submit a crawl job, returns jobId immediately
router.post("/crawl", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = CrawlJobSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { websiteUrl, instructions, modelId, language, extractionMode, credentials } = parse.data;
  const userId = (req as Request & { userId: string }).userId;

  const usage = await getUserDailyUsage(userId);
  if (!usage.isOwner && usage.used >= usage.limit) {
    res.status(429).json({
      error: `Daily limit reached (${usage.used}/${usage.limit}). Resets at midnight UTC.`,
      usage,
    });
    return;
  }

  if (!usage.isOwner) {
    await incrementUserDailyUsage(userId);
  }

  const sessionId = await createSession({ website_url: websiteUrl, instructions, model_id: modelId, user_id: userId });

  const job = createJob({ websiteUrl, instructions, modelId, language, extractionMode, credentials, sessionId });

  // Run in background — do NOT await
  runJobInBackground(job.jobId).catch((err) =>
    console.error(`Job ${job.jobId} background error:`, err)
  );

  res.json({ jobId: job.jobId, sessionId });
});

// GET /api/scraper/crawl/:jobId — poll job status and steps
router.get("/crawl/:jobId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const job = getJob(String(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // SSE streaming for real-time updates
  const acceptSSE = req.headers.accept?.includes("text/event-stream");
  if (acceptSSE) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let lastStepIdx = 0;
    let lastChunkIdx = 0;
    let lastStatus = "";
    let lastProgress = -1;

    const poll = setInterval(() => {
      // Send new steps
      while (lastStepIdx < job.steps.length) {
        res.write(`event: step\ndata: ${JSON.stringify(job.steps[lastStepIdx])}\n\n`);
        lastStepIdx++;
      }
      // Send new code chunks
      while (lastChunkIdx < job.codeChunks.length) {
        res.write(`event: code_chunk\ndata: ${JSON.stringify({ chunk: job.codeChunks[lastChunkIdx] })}\n\n`);
        lastChunkIdx++;
      }
      // Send status only when it changes
      if (job.status !== lastStatus || job.progress !== lastProgress) {
        res.write(`event: status\ndata: ${JSON.stringify({ status: job.status, progress: job.progress })}\n\n`);
        lastStatus = job.status;
        lastProgress = job.progress;
      }

      if (job.status === "completed" || job.status === "failed") {
        if (job.status === "completed") {
          res.write(`event: done\ndata: ${JSON.stringify({ sessionId: job.sessionId, result: job.result })}\n\n`);
        } else {
          res.write(`event: error\ndata: ${JSON.stringify({ message: job.error })}\n\n`);
        }
        clearInterval(poll);
        res.end();
      }
    }, 500);

    req.on("close", () => clearInterval(poll));
    return;
  }

  // JSON polling fallback
  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    steps: job.steps,
    codeGenerated: job.codeChunks.join(""),
    result: job.result,
    error: job.error,
  });
});

// POST /api/scraper/map — quickly map a site's link structure
const MapSchema = z.object({
  websiteUrl: z.string().url("Invalid URL"),
});

router.post("/map", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = MapSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { websiteUrl } = parse.data;

  try {
    const siteMap = await mapSite(websiteUrl, (_progress) => {
      // progress is informational only for /map
    });
    res.json({ siteMap });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Map failed";
    res.status(500).json({ error: message });
  }
});

export default router;

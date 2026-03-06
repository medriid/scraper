import { Router, Request, Response } from "express";
import { z } from "zod";
import { getUserProfile, upsertUserProfile, verifyUserToken } from "../services/supabaseService.js";

const router = Router();

// Middleware: extract Bearer token and attach userId to request
export async function requireAuth(req: Request, res: Response, next: import("express").NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = auth.slice(7);
  const user = await verifyUserToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as Request & { userId: string; userEmail: string }).userId = user.userId;
  (req as Request & { userId: string; userEmail: string }).userEmail = user.email;
  next();
}

// GET /api/auth/me — return current user's profile
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const profile = await getUserProfile(userId);
  if (!profile) {
    res.status(404).json({ error: "User profile not found" });
    return;
  }
  res.json({ user: profile });
});

// POST /api/auth/sync — upsert user profile after sign-in (called by client)
const SyncSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().optional(),
  avatar_url: z.string().url().nullish(),
});

router.post("/sync", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = SyncSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const profile = await upsertUserProfile(parse.data);
  if (!profile) {
    res.status(500).json({ error: "Failed to sync user profile" });
    return;
  }
  res.json({ user: profile });
});

export default router;

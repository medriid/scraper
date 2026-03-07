import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createTeam,
  listTeams,
  getTeam,
  deleteTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  getUserByEmail,
} from "../services/supabaseService.js";
import { requireAuth } from "./auth.js";

const router = Router();

// ─── List my teams ────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const teams = await listTeams(userId);
  res.json({ teams });
});

// ─── Create team ──────────────────────────────────────────────────────────────
const CreateTeamSchema = z.object({
  name: z.string().min(1).max(80),
});

router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = CreateTeamSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const userId = (req as Request & { userId: string }).userId;
  const team = await createTeam(parse.data.name, userId);
  if (!team) {
    res.status(500).json({ error: "Failed to create team" });
    return;
  }
  res.status(201).json({ team });
});

// ─── Get team ─────────────────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const team = await getTeam(String(req.params.id));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  // Only owner or member can view
  const members = await listTeamMembers(team.id);
  const isMember = team.owner_id === userId || members.some((m) => m.user_id === userId);
  if (!isMember) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json({ team, members });
});

// ─── Delete team ──────────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const team = await getTeam(String(req.params.id));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (team.owner_id !== userId) {
    res.status(403).json({ error: "Only the team owner can delete the team" });
    return;
  }

  await deleteTeam(team.id);
  res.json({ ok: true });
});

// ─── List team members ────────────────────────────────────────────────────────
router.get("/:id/members", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const team = await getTeam(String(req.params.id));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const members = await listTeamMembers(team.id);
  const isMember = team.owner_id === userId || members.some((m) => m.user_id === userId);
  if (!isMember) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json({ members });
});

// ─── Add/invite member ────────────────────────────────────────────────────────
const AddMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["editor", "viewer"]).default("viewer"),
});

router.post("/:id/members", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const team = await getTeam(String(req.params.id));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (team.owner_id !== userId) {
    res.status(403).json({ error: "Only the team owner can add members" });
    return;
  }

  const parse = AddMemberSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { email, role } = parse.data;

  // Look up user by email
  const targetUser = await getUserByEmail(email);
  if (!targetUser) {
    res.status(404).json({ error: `No user found with email: ${email}` });
    return;
  }

  if (targetUser.id === userId) {
    res.status(400).json({ error: "You are already the team owner" });
    return;
  }

  const member = await addTeamMember(team.id, targetUser.id, role, userId);
  if (!member) {
    res.status(500).json({ error: "Failed to add team member" });
    return;
  }

  res.status(201).json({ member });
});

// ─── Remove member ────────────────────────────────────────────────────────────
router.delete("/:id/members/:memberId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const team = await getTeam(String(req.params.id));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (team.owner_id !== userId) {
    res.status(403).json({ error: "Only the team owner can remove members" });
    return;
  }

  await removeTeamMember(team.id, String(req.params.memberId));
  res.json({ ok: true });
});

export default router;

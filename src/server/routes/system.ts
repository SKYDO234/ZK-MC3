import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { systemSnapshot } from "../services/proc";
import { buildUserDashboard } from "../services/stats";
import { notificationsFor, markRead } from "../services/notifications";
import { activityForUser, listActivity } from "../services/activity";
import { softwareHealth } from "../services/health";
import { getVersions, SOFTWARE_TYPES } from "../services/software";

const router = Router();

router.get("/bootstrap", async (_req, res) => {
  const snap = await systemSnapshot();
  res.json({ system: snap, software: SOFTWARE_TYPES });
});

router.get("/stats", requireAuth, async (_req, res) => {
  res.json(await systemSnapshot());
});

router.get("/software", requireAuth, async (_req, res) => {
  res.json(SOFTWARE_TYPES);
});

router.get("/versions", requireAuth, async (req, res) => {
  const software = String(req.query.software || "PAPER");
  const versions = await getVersions(software);
  res.json({ software, versions });
});

router.get("/dashboard", requireAuth, async (req: any, res) => {
  res.json(await buildUserDashboard(req.user.id, req.user.role));
});

router.get("/activity", requireAuth, async (req: any, res) => {
  const isAdmin = req.user.role === "admin" || req.user.role === "owner";
  res.json(isAdmin && req.query.all === "1" ? await listActivity(60) : await activityForUser(req.user.id, 25));
});

router.get("/notifications", requireAuth, async (req: any, res) => {
  res.json(await notificationsFor(req.user.id, req.user.role));
});

router.post("/notifications/read", requireAuth, async (req: any, res) => {
  await markRead(req.user.id, req.body?.id);
  res.json({ success: true });
});

router.get("/health", requireAuth, async (_req, res) => {
  res.json(await softwareHealth());
});

export default router;

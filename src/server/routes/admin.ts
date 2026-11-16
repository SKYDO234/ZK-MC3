import { Router } from "express";
import multer from "multer";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { requireAdmin, clientIp } from "../middleware/auth";
import { getSettings, saveSettings } from "../services/settings";
import { listActivity, logActivity } from "../services/activity";
import { listUsers } from "../services/users";
import { listServers } from "../services/runtime";
import { listNodes } from "../services/nodes";
import { buildDashboard } from "../services/stats";
import { notify } from "../services/notifications";
import { systemSnapshot } from "../services/proc";
import { softwareHealth } from "../services/health";
import { readJSON, writeJSON, UPLOADS_DIR } from "../services/db";

const router = Router();
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 8 * 1024 * 1024 } });

router.get("/dashboard", requireAdmin, async (_req, res) => {
  res.json(await buildDashboard());
});

router.get("/activity", requireAdmin, async (req, res) => {
  res.json(await listActivity(Number(req.query.limit) || 100));
});

router.get("/health", requireAdmin, async (_req, res) => {
  const [system, software] = await Promise.all([systemSnapshot(), softwareHealth()]);
  res.json({
    system,
    software,
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeVersion: process.version,
      platform: `${os.type()} ${os.release()}`,
      cwd: process.cwd(),
    },
  });
});

router.get("/settings", requireAdmin, async (_req, res) => {
  const settings = await getSettings();
  res.json({ ...settings, smtpPass: settings.smtpPass ? "********" : "" });
});

router.put("/settings", requireAdmin, async (req: any, res) => {
  const payload = req.body || {};
  const numericKeys = [
    "sessionTimeoutHours",
    "passwordMinLength",
    "smtpPort",
    "apiRateLimit",
    "apiKeyMaxPerUser",
    "apiKeyDefaultExpiryDays",
    "maxServersPerUser",
    "maxRamPerServer",
    "maxCpuPerServer",
    "maxDiskPerServer",
    "pricePerGbRam",
    "pricePerCpuCore",
    "pricePerGbDisk",
  ];
  for (const key of numericKeys) {
    if (payload[key] !== undefined) payload[key] = Number(payload[key]);
  }
  const settings = await saveSettings(payload);
  await logActivity({
    type: "admin",
    action: "settings",
    message: `${req.user.username} updated panel settings`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: "settings",
    ip: clientIp(req),
  });
  res.json({ ...settings, smtpPass: settings.smtpPass ? "********" : "" });
});

router.post("/settings/logo", requireAdmin, upload.single("logo"), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const ext = path.extname(req.file.originalname || ".png").toLowerCase() || ".png";
  if (![".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"].includes(ext))
    return res.status(400).json({ error: "Logo must be PNG, JPG, SVG or WEBP" });
  const fileName = `logo-${Date.now()}${ext}`;
  const target = path.join(process.cwd(), "public", "uploads", fileName);
  await fs.ensureDir(path.dirname(target));
  await fs.move(req.file.path, target, { overwrite: true });
  await saveSettings({ logoUrl: `/uploads/${fileName}`, faviconUrl: `/uploads/${fileName}` });
  res.json({ logoUrl: `/uploads/${fileName}` });
});

router.post("/notify", requireAdmin, async (req: any, res) => {
  const { title, message, type = "info", audience = "all" } = req.body || {};
  if (!title || !message) return res.status(400).json({ error: "Title and message are required" });
  const users = await listUsers();
  const targets =
    audience === "all"
      ? [{ id: "*" }]
      : audience === "admins"
      ? [{ id: "@admins" }]
      : users.filter((u) => u.id === audience).map((u) => ({ id: u.id }));
  if (!targets.length) return res.status(400).json({ error: "No recipients matched that audience" });
  for (const target of targets) {
    await notify({ userId: target.id, title, message, type, link: "" });
  }
  await logActivity({
    type: "admin",
    action: "broadcast",
    message: `${req.user.username} sent the announcement "${title}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: audience,
    ip: clientIp(req),
  });
  res.json({ success: true, recipients: targets.length });
});

router.get("/export", requireAdmin, async (_req, res) => {
  const [users, servers, nodes, settings, activity, keys] = await Promise.all([
    listUsers(),
    listServers(),
    listNodes(),
    getSettings(),
    listActivity(200),
    readJSON<any[]>("api_keys.json", []),
  ]);
  res.json({
    exportedAt: new Date().toISOString(),
    panel: "ZK-MC3-PANEL",
    users: users.map(({ password, ...rest }) => rest),
    servers,
    nodes,
    settings: { ...settings, smtpPass: settings.smtpPass ? "********" : "" },
    activity,
    apiKeys: keys.map(({ keyHash, ...rest }) => rest),
  });
});

router.post("/maintenance", requireAdmin, async (req: any, res) => {
  const enabled = Boolean(req.body?.enabled);
  await saveSettings({ maintenanceMode: enabled });
  await logActivity({
    type: "admin",
    action: "maintenance",
    message: `${req.user.username} ${enabled ? "enabled" : "disabled"} maintenance mode`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: "panel",
    ip: clientIp(req),
  });
  res.json({ success: true, maintenanceMode: enabled });
});

export default router;

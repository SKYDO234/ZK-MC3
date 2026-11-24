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
import { stopServer, clearConsoleLog } from "../services/runtime";
import { createBackupZip } from "../services/backups";
import { panelLogs } from "../services/panellog";

const router = Router();
// Wallpapers can be large (AMC allows 200 MB); everything else is small.
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 200 * 1024 * 1024 } });

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
  // Never cacheable: this is the form's source of truth. An ETag here lets a
  // browser revalidate to 304 with no body after a save, so the settings screen
  // would reopen showing values the operator already changed.
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
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
    "glassBlur",
    "wallpaperOpacity",
  ];
  for (const key of numericKeys) {
    if (payload[key] !== undefined) payload[key] = Number(payload[key]);
  }

  // An empty panel name is not a valid state: it renders as a blank sidebar, an
  // empty browser title and, until recently, an unusable settings page. Reject it
  // here rather than persisting something the operator cannot see or correct.
  if (payload.panelName !== undefined && !String(payload.panelName).trim())
    return res.status(400).json({ error: "Panel name cannot be empty" });
  if (payload.panelName !== undefined) payload.panelName = String(payload.panelName).trim().slice(0, 60);

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

/* ---------------------------------------------------------------------------
 * Appearance — wallpaper upload / presets
 * ---------------------------------------------------------------------------
 * A panel background can be an uploaded image or video, a direct URL, or one of
 * the built-in gradients. Files land in public/uploads so they are served by the
 * same static handler as the logo, and the URL is stored in settings so every
 * client picks it up on the next /api/settings poll.
 */
router.post("/settings/wallpaper/upload", requireAdmin, upload.single("file"), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const ext = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];
  const videoExts = [".mp4", ".webm", ".mov"];
  if (![...imageExts, ...videoExts].includes(ext))
    return res.status(400).json({ error: "Background must be JPG, PNG, GIF, WebP, AVIF, MP4 or WebM" });
  const fileName = `wallpaper-${Date.now()}${ext}`;
  const target = path.join(process.cwd(), "public", "uploads", fileName);
  await fs.ensureDir(path.dirname(target));
  await fs.move(req.file.path, target, { overwrite: true });
  const url = `/uploads/${fileName}`;
  const type = videoExts.includes(ext) ? "video" : "image";
  await saveSettings({ wallpaper: url, wallpaperType: type, wallpaperPreset: "" });
  res.json({ success: true, wallpaper: url, wallpaperType: type });
});

router.delete("/settings/wallpaper", requireAdmin, async (_req, res) => {
  await saveSettings({ wallpaper: "", wallpaperType: "", wallpaperPreset: "" });
  res.json({ success: true });
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

/**
 * Platform maintenance actions surfaced in the admin panel's system tools.
 * These are the operations a host operator actually needs during an incident.
 */
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

router.post("/system/action", requireAdmin, async (req: any, res) => {
  const action = String(req.body?.action || "");
  const actor = req.user.username || "admin";
  try {
    if (action === "backup-all") {
      const servers = await listServers();
      const results: { id: string; name: string; ok: boolean; fileName?: string; error?: string }[] = [];
      for (const server of servers) {
        try {
          const backup = await createBackupZip(server, "scheduled");
          results.push({ id: server.id, name: server.name, ok: true, fileName: backup.fileName });
        } catch (err: any) {
          results.push({ id: server.id, name: server.name, ok: false, error: err.message });
        }
      }
      await logActivity({
        type: "admin",
        action: "backup-all",
        message: `${actor} backed up ${results.filter((r) => r.ok).length}/${results.length} servers`,
        actorId: req.user.id,
        actorName: actor,
        target: "panel",
        ip: clientIp(req),
      });
      return res.json({ success: true, action, results });
    }

    if (action === "restart-panel") {
      await logActivity({
        type: "admin",
        action: "restart",
        message: `${actor} restarted the panel service`,
        actorId: req.user.id,
        actorName: actor,
        target: "panel",
        ip: clientIp(req),
      });
      res.json({ success: true, action, message: "Panel is restarting. Reconnect in a few seconds." });
      // Give the response time to flush, then let the process manager respawn us.
      setTimeout(() => process.exit(0), 600);
      return;
    }

    if (action === "clear-logs") {
      const servers = await listServers();
      let cleared = 0;
      for (const server of servers) {
        await clearConsoleLog(server.id).catch(() => {});
        cleared += 1;
      }
      await logActivity({
        type: "admin",
        action: "clear-logs",
        message: `${actor} cleared console logs for ${cleared} servers`,
        actorId: req.user.id,
        actorName: actor,
        target: "panel",
        ip: clientIp(req),
      });
      return res.json({ success: true, action, cleared });
    }

    if (action === "clear-cache") {
      await fs.emptyDir(UPLOADS_DIR);
      await logActivity({
        type: "admin",
        action: "clear-cache",
        message: `${actor} purged the upload cache`,
        actorId: req.user.id,
        actorName: actor,
        target: "panel",
        ip: clientIp(req),
      });
      return res.json({ success: true, action });
    }

    if (action === "stop-all") {
      const servers = await listServers();
      let stopped = 0;
      for (const server of servers) {
        try {
          await stopServer(server.id);
          stopped += 1;
        } catch {
          /* already offline */
        }
      }
      await logActivity({
        type: "admin",
        action: "stop-all",
        message: `${actor} stopped ${stopped} running servers`,
        actorId: req.user.id,
        actorName: actor,
        target: "panel",
        ip: clientIp(req),
      });
      return res.json({ success: true, action, stopped });
    }

    return res.status(400).json({ error: `Unknown system action "${action}"` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "System action failed" });
  }
});

/** Live platform log feed for the admin console (panel process output). */
router.get("/system/logs", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const logFile = path.join(process.cwd(), "crash.log");
  const lines = panelLogs(limit);
  res.json({
    lines,
    crashLog: (await fs.pathExists(logFile)) ? await fs.readFile(logFile, "utf8") : null,
    pid: process.pid,
    uptime: process.uptime(),
  });
});

export default router;

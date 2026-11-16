import { Router } from "express";
import crypto from "crypto";
import { requireAuth, clientIp, API_KEY_PREFIX } from "../middleware/auth";
import { readJSON, writeJSON, id, nowISO } from "../services/db";
import { isAdminRole } from "../services/users";
import { getSettings } from "../services/settings";
import { logActivity } from "../services/activity";

const router = Router();
router.use(requireAuth);

const SCOPES = [
  "servers.read",
  "servers.write",
  "servers.power",
  "files.read",
  "files.write",
  "backups.read",
  "backups.write",
  "users.read",
  "users.write",
  "nodes.read",
  "nodes.write",
  "settings.read",
  "settings.write",
  "*",
];

const publicKey = (k: any) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  maskedKey: `${k.prefix}${"•".repeat(20)}${(k.last4 || "").slice(-4)}`,
  scopes: k.scopes,
  userId: k.userId,
  username: k.username,
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt,
  expiresAt: k.expiresAt,
  revoked: k.revoked,
  requests: k.requests || 0,
});

router.get("/scopes", (_req, res) => res.json(SCOPES));

router.get("/", async (req: any, res) => {
  const keys = await readJSON<any[]>("api_keys.json", []);
  const mine = isAdminRole(req.user.role) ? keys : keys.filter((k) => k.userId === req.user.id);
  res.json(mine.map(publicKey));
});

router.post("/", async (req: any, res) => {
  const settings = await getSettings();
  if (!settings.apiEnabled) return res.status(403).json({ error: "API access is disabled by the administrator" });

  const keys = await readJSON<any[]>("api_keys.json", []);
  const mine = keys.filter((k) => k.userId === req.user.id && !k.revoked);
  if (mine.length >= settings.apiKeyMaxPerUser)
    return res.status(400).json({ error: `You can only have ${settings.apiKeyMaxPerUser} active API keys` });

  const { name, scopes, expiresInDays, userId: targetUserId } = req.body || {};
  if (!name || String(name).trim().length < 3)
    return res.status(400).json({ error: "Give your API key a descriptive name (min 3 characters)" });

  const requested = Array.isArray(scopes) && scopes.length ? scopes.filter((s: string) => SCOPES.includes(s)) : ["servers.read"];
  if (!isAdminRole(req.user.role) && requested.some((s) => !s.startsWith("servers") && !s.startsWith("files") && !s.startsWith("backups") && s !== "*"))
    return res.status(403).json({ error: "One or more scopes require administrator access" });
  if (!isAdminRole(req.user.role) && requested.includes("*"))
    return res.status(403).json({ error: "Wildcard scope requires administrator access" });

  const ownerId = isAdminRole(req.user.role) && targetUserId ? targetUserId : req.user.id;
  const raw = `${API_KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const days = Number(expiresInDays) || settings.apiKeyDefaultExpiryDays || 0;

  const record = {
    id: id("key_"),
    name: String(name).trim(),
    keyHash,
    prefix: raw.slice(0, 7),
    last4: raw.slice(-4),
    scopes: requested,
    userId: ownerId,
    username: req.user.username,
    createdAt: nowISO(),
    lastUsedAt: null,
    expiresAt: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
    revoked: false,
    requests: 0,
  };
  keys.push(record);
  await writeJSON("api_keys.json", keys);

  await logActivity({
    type: "api",
    action: "create",
    message: `${req.user.username} generated API key "${record.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: record.id,
    ip: clientIp(req),
  });

  res.status(201).json({ ...publicKey(record), key: raw });
});

router.patch("/:id", async (req: any, res) => {
  const keys = await readJSON<any[]>("api_keys.json", []);
  const idx = keys.findIndex((k) => k.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "API key not found" });
  if (!isAdminRole(req.user.role) && keys[idx].userId !== req.user.id)
    return res.status(403).json({ error: "Forbidden" });
  const { name, scopes } = req.body || {};
  if (name) keys[idx].name = String(name).trim();
  if (Array.isArray(scopes) && scopes.length) keys[idx].scopes = scopes.filter((s: string) => SCOPES.includes(s));
  await writeJSON("api_keys.json", keys);
  res.json(publicKey(keys[idx]));
});

router.post("/:id/revoke", async (req: any, res) => {
  const keys = await readJSON<any[]>("api_keys.json", []);
  const idx = keys.findIndex((k) => k.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "API key not found" });
  if (!isAdminRole(req.user.role) && keys[idx].userId !== req.user.id)
    return res.status(403).json({ error: "Forbidden" });
  keys[idx].revoked = true;
  await writeJSON("api_keys.json", keys);
  res.json({ success: true });
});

router.delete("/:id", async (req: any, res) => {
  const keys = await readJSON<any[]>("api_keys.json", []);
  const target = keys.find((k) => k.id === req.params.id);
  if (!target) return res.status(404).json({ error: "API key not found" });
  if (!isAdminRole(req.user.role) && target.userId !== req.user.id)
    return res.status(403).json({ error: "Forbidden" });
  await writeJSON("api_keys.json", keys.filter((k) => k.id !== target.id));
  await logActivity({
    type: "api",
    action: "delete",
    message: `${req.user.username} deleted API key "${target.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: target.id,
    ip: clientIp(req),
  });
  res.json({ success: true });
});

export default router;

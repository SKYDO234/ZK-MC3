import { Router } from "express";
import multer from "multer";
import fs from "fs-extra";
import path from "path";
import archiver from "archiver";
import extract from "extract-zip";
import { requireScope, requireAuth, requireAdmin, clientIp } from "../middleware/auth";
import { readJSON, writeJSON, id, nowISO, BACKUPS_DIR } from "../services/db";
import { getSettings } from "../services/settings";
import { isAdminRole, findUserById, listUsers } from "../services/users";
import { logActivity } from "../services/activity";
import { notify } from "../services/notifications";
import {
  ServerRecord,
  listServers,
  saveServers,
  findServer,
  updateServer,
  provisionServerFiles,
  provisionServerWithLogs,
  writeServerProperties,
  startServer,
  stopServer,
  restartServer,
  killServer,
  sendCommandToServer,
  getRuntimeState,
  readConsole,
  clearConsoleLog,
  diskUsageMb,
  deleteServerCompletely,
  serverDir,
  safeJoin,
} from "../services/runtime";
import { SOFTWARE_TYPES, javaVersionFor } from "../services/software";
import { createBackupZip, restoreBackupZip, listBackups } from "../services/backups";

const router = Router();

const upload = multer({
  dest: path.join(process.cwd(), ".data", "uploads"),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Local node resource totals (used for allocation bars)
// ---------------------------------------------------------------------------
const nodeTotals = async () => {
  const { systemSnapshot } = await import("../services/proc");
  const snap = await systemSnapshot();
  return {
    cpuCores: snap.cpuCores,
    memoryMb: snap.memoryTotalMb,
    diskMb: snap.diskTotalMb,
    memoryUsedMb: snap.memoryUsedMb,
    diskUsedMb: snap.diskUsedMb,
    loadPercent: snap.loadPercent,
  };
};

const guardServer = async (req: any, res: any) => {
  const server = await findServer(req.params.id);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return null;
  }
  const user = req.user;
  if (!isAdminRole(user.role) && server.owner !== user.id && !(server as any).subUsers?.includes?.(user.id)) {
    res.status(403).json({ error: "You do not have access to this server" });
    return null;
  }
  return server;
};

const decorate = async (server: ServerRecord) => {
  const state = await getRuntimeState(server.id);
  const disk = await diskUsageMb(server.id).catch(() => 0);
  return {
    ...server,
    status: state.running ? "online" : server.status === "installing" ? "installing" : server.status === "starting" ? "starting" : "offline",
    uptimeSeconds: state.uptimeSeconds,
    cpuUsage: state.cpu,
    ramUsage: state.ram,
    diskUsage: disk,
    pid: state.pid,
  };
};

// ---------------------------------------------------------------------------
// List & detail
// ---------------------------------------------------------------------------
router.get("/", requireScope("servers.read"), async (req: any, res) => {
  const servers = await listServers();
  const visible = isAdminRole(req.user.role) ? servers : servers.filter((s) => s.owner === req.user.id);
  const decorated = await Promise.all(visible.map(decorate));
  res.json(decorated);
});

router.get("/summary", requireScope("servers.read"), async (req: any, res) => {
  const servers = await listServers();
  const visible = isAdminRole(req.user.role) ? servers : servers.filter((s) => s.owner === req.user.id);
  const decorated = await Promise.all(visible.map(decorate));
  const totals = await nodeTotals();
  res.json({
    totals,
    servers: decorated,
    counts: {
      total: decorated.length,
      online: decorated.filter((s) => s.status === "online").length,
      offline: decorated.filter((s) => s.status !== "online").length,
      installed: decorated.filter((s) => s.status !== "installing").length,
    },
    allocated: {
      ram: decorated.reduce((a, s) => a + (s.ram || 0), 0),
      cpu: decorated.reduce((a, s) => a + (s.cpu || 0), 0),
      disk: decorated.reduce((a, s) => a + (s.disk || 0), 0),
    },
    used: {
      ram: decorated.reduce((a, s) => a + (s.ramUsage || 0), 0),
      cpu: decorated.reduce((a, s) => a + (s.cpuUsage || 0), 0),
      disk: decorated.reduce((a, s) => a + (s.diskUsage || 0), 0),
    },
  });
});

router.get("/check-port", requireScope("servers.read"), async (req: any, res) => {
  const port = Number(req.query.port);
  const servers = await listServers();
  res.json({ port, inUse: servers.some((s) => Number(s.port) === port) });
});

// Players (whitelist / operators / bans read from the vanilla JSON files)
// ---------------------------------------------------------------------------
const PLAYER_FILES: Record<string, string> = {
  whitelist: "whitelist.json",
  ops: "ops.json",
  banned: "banned-players.json",
  bannedIps: "banned-ips.json",
};

router.get("/:id/players", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const dir = serverDir(server.id);
  const read = async (file: string) => {
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const [whitelist, ops, banned, bannedIps] = await Promise.all([
    read(PLAYER_FILES.whitelist),
    read(PLAYER_FILES.ops),
    read(PLAYER_FILES.banned),
    read(PLAYER_FILES.bannedIps),
  ]);
  res.json({
    online: false,
    whitelistEnabled: await (async () => {
      try {
        const props = await fs.readFile(path.join(dir, "server.properties"), "utf8");
        return /^white-list=true$/m.test(props);
      } catch {
        return false;
      }
    })(),
    whitelist: whitelist.map((p: any) => ({ uuid: p.uuid, name: p.name })),
    ops: ops.map((p: any) => ({ uuid: p.uuid, name: p.name, level: p.level, bypassesPlayerLimit: p.bypassesPlayerLimit })),
    banned: banned.map((p: any) => ({ uuid: p.uuid, name: p.name, reason: p.reason, created: p.created })),
    bannedIps: bannedIps.map((p: any) => ({ ip: p.ip, reason: p.reason, created: p.created })),
  });
});

// Runs a whitelist / op / ban command through the live console, then re-reads the files.
router.post("/:id/players/:action", requireScope("servers.power"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const { action } = req.params;
  const target = String(req.body?.player || "").trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(target))
    return res.status(400).json({ error: "Enter a valid Minecraft username (letters, numbers, underscore)" });

  const commands: Record<string, string> = {
    whitelist_add: `whitelist add ${target}`,
    whitelist_remove: `whitelist remove ${target}`,
    op: `op ${target}`,
    deop: `deop ${target}`,
    ban: `ban ${target}${req.body?.reason ? ` ${String(req.body.reason).slice(0, 100)}` : ""}`,
    pardon: `pardon ${target}`,
    kick: `kick ${target}${req.body?.reason ? ` ${String(req.body.reason).slice(0, 100)}` : ""}`,
  };
  const command = commands[action];
  if (!command) return res.status(400).json({ error: "Unknown player action" });

  try {
    await sendCommandToServer(server.id, command);
  } catch {
    return res.status(409).json({ error: "The server must be online to run player commands" });
  }
  await logActivity({
    type: "server",
    action: `players.${action}`,
    message: `${req.user.username} ran "${command}" on server "${server.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: server.id,
    ip: clientIp(req),
  });
  res.json({ success: true, command });
});

router.get("/:id", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  res.json(await decorate(server));
});

router.get("/:id/stats", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const state = await getRuntimeState(server.id);
  const disk = await diskUsageMb(server.id).catch(() => 0);
  res.json({
    ...state,
    disk,
    limitRam: server.ram,
    limitCpu: server.cpu,
    limitDisk: server.disk,
  });
});

router.get("/:id/logs", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const lines = Number(req.query.lines) || 300;
  res.json({ logs: await readConsole(server.id, lines) });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
const lifecycle = (action: "start" | "stop" | "restart" | "kill") => async (req: any, res: any) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    if (action === "start") await startServer(server.id, req.user.username || req.user.id);
    if (action === "stop") await stopServer(server.id);
    if (action === "restart") await restartServer(server.id, req.user.username || req.user.id);
    if (action === "kill") await killServer(server.id);
    await logActivity({
      type: "server",
      action,
      message: `${req.user.username || "user"} ${action === "kill" ? "force-killed" : `${action}ed`} server "${server.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: server.id,
      ip: clientIp(req),
    });
    res.json({ success: true, status: action === "stop" || action === "kill" ? "offline" : "online" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

router.post("/:id/start", requireScope("servers.power"), lifecycle("start"));
router.post("/:id/stop", requireScope("servers.power"), lifecycle("stop"));
router.post("/:id/restart", requireScope("servers.power"), lifecycle("restart"));
router.post("/:id/kill", requireScope("servers.power"), lifecycle("kill"));

router.post("/:id/command", requireScope("servers.power"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    await sendCommandToServer(server.id, String(req.body?.command || "").slice(0, 2000));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/console/clear", requireScope("servers.power"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  await clearConsoleLog(server.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Settings / power user actions
// ---------------------------------------------------------------------------
router.patch("/:id", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const allowed = ["name", "description", "autoRestart", "notes", "startupCommand", "motd", "javaVersion"];
  const patch: any = {};
  for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key];
  if (patch.name !== undefined && String(patch.name).trim().length < 3) {
    return res.status(400).json({ error: "Server name must be at least 3 characters" });
  }
  const updated = await updateServer(server.id, patch);
  res.json(updated);
});

router.put("/:id/motd", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const { motd } = req.body;
  await writeServerProperties(server, { motd: String(motd).replace(/\n/g, " ").slice(0, 120) });
  res.json({ success: true, motd });
});

router.get("/:id/properties", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const file = path.join(serverDir(server.id), "server.properties");
  if (!(await fs.pathExists(file))) return res.json({ content: "" });
  res.json({ content: await fs.readFile(file, "utf8") });
});

router.put("/:id/properties", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const content = String(req.body?.content || "");
  const file = path.join(serverDir(server.id), "server.properties");
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, content);
  res.json({ success: true });
});

router.post("/:id/reinstall", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    await killServer(server.id).catch(() => {});
    const dir = serverDir(server.id);
    for (const entry of await fs.readdir(dir).catch(() => [])) {
      if (["server.jar", "libraries", "versions", "cache"].includes(entry) || entry.startsWith("server.jar")) {
        await fs.remove(path.join(dir, entry));
      }
    }
    await updateServer(server.id, { status: "installing" });
    await clearConsoleLog(server.id);
    await provisionServerWithLogs(server);
    await logActivity({
      type: "server",
      action: "reinstall",
      message: `${req.user.username} reinstalled server "${server.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: server.id,
      ip: clientIp(req),
    });
    res.json({ success: true });
  } catch (err: any) {
    await updateServer(server.id, { status: "offline" });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// File manager
// ---------------------------------------------------------------------------
const formatEntry = async (root: string, dir: string, entry: string) => {
  const full = path.join(dir, entry);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) return null;
  return {
    name: entry,
    path: path.relative(root, full).replace(/\\/g, "/"),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    editable: !stat.isDirectory() && /\.(txt|properties|yml|yaml|json|toml|conf|cfg|log|sh|js|ts|py|md|html|css|xml|ini|env)$/i.test(entry) && stat.size < 2 * 1024 * 1024,
  };
};

router.get("/:id/files", requireScope("files.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const root = serverDir(server.id);
  await fs.ensureDir(root);
  try {
    const dir = safeJoin(root, String(req.query.path || ""));
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: "Not a directory" });
    const entries = await fs.readdir(dir).catch(() => []);
    const items = (await Promise.all(entries.map((e) => formatEntry(root, dir, e)))).filter(Boolean);
    items.sort((a: any, b: any) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name));
    res.json({ path: path.relative(root, dir).replace(/\\/g, "/"), items });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/files/read", requireScope("files.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const file = safeJoin(serverDir(server.id), String(req.query.path || ""));
    const stat = await fs.stat(file);
    if (stat.size > 2 * 1024 * 1024) return res.status(400).json({ error: "File is too large to edit (max 2 MB)" });
    res.json({ content: await fs.readFile(file, "utf8"), size: stat.size });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/files/save", requireScope("files.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const file = safeJoin(serverDir(server.id), String(req.body?.path || ""));
    const existing = await fs.stat(file).catch(() => null);
    if (existing?.isDirectory()) return res.status(400).json({ error: "Path is a directory, not a file" });
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, String(req.body?.content ?? ""));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/files/create", requireScope("files.write"), upload.single("file"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const dir = safeJoin(serverDir(server.id), String(req.body?.path || ""));
    await fs.ensureDir(dir);
    if (req.file) {
      const target = safeJoin(dir, req.file.originalname);
      await fs.move(req.file.path, target, { overwrite: true });
    } else {
      const target = safeJoin(dir, String(req.body?.name || "new-file.txt"));
      await fs.ensureFile(target);
    }
    res.json({ success: true });
  } catch (err: any) {
    if (req.file) await fs.remove(req.file.path).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/files/mkdir", requireScope("files.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const target = safeJoin(serverDir(server.id), String(req.body?.path || ""));
    await fs.ensureDir(target);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/files/rename", requireScope("files.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const root = serverDir(server.id);
    const from = safeJoin(root, String(req.body?.from || ""));
    const to = safeJoin(root, String(req.body?.to || ""));
    await fs.move(from, to, { overwrite: false });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id/files", requireScope("files.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const target = safeJoin(serverDir(server.id), String(req.query.path || req.body?.path || ""));
    if (path.resolve(target) === path.resolve(serverDir(server.id)))
      return res.status(400).json({ error: "Refusing to delete the server root" });
    await fs.remove(target);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/files/zip", requireScope("files.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const root = serverDir(server.id);
    const target = safeJoin(root, String(req.body?.path || ""));
    const outName = `${path.basename(target)}-${Date.now()}.zip`;
    const outPath = safeJoin(root, outName);
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(output);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) archive.directory(target, path.basename(target));
    else archive.file(target, { name: path.basename(target) });
    await archive.finalize();
    await new Promise<void>((resolve) => output.on("close", () => resolve()));
    res.json({ success: true, fileName: outName });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/files/unzip", requireScope("files.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const root = serverDir(server.id);
    const target = safeJoin(root, String(req.body?.path || ""));
    await extract(target, { dir: path.dirname(target) });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------
router.get("/:id/backups", requireScope("backups.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  res.json(await listBackups(server.id));
});

router.post("/:id/backups", requireScope("backups.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const backup = await createBackupZip(server, String(req.body?.label || ""));
    await updateServer(server.id, { lastBackupAt: nowISO() });
    await logActivity({
      type: "backup",
      action: "create",
      message: `${req.user.username} created a backup of "${server.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: server.id,
      ip: clientIp(req),
    });
    res.json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/backups/:fileName/restore", requireScope("backups.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    await restoreBackupZip(server, req.params.fileName);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/backups/:fileName", requireScope("backups.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    await fs.remove(path.join(BACKUPS_DIR, server.id, path.basename(req.params.fileName)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/backups/:fileName/download", requireScope("backups.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const file = path.join(BACKUPS_DIR, server.id, path.basename(req.params.fileName));
  if (!(await fs.pathExists(file))) return res.status(404).json({ error: "Backup not found" });
  res.download(file);
});

// ---------------------------------------------------------------------------
// Admin-only server management
// ---------------------------------------------------------------------------
router.post("/", requireScope("servers.write"), async (req: any, res) => {
  const settings = await getSettings();
  const user = req.user;
  if (!isAdminRole(user.role) && !settings.allowUserServerCreation) {
    return res.status(403).json({ error: "Only administrators can create servers" });
  }

  const {
    name,
    ownerId,
    software = settings.defaultSoftware,
    version = settings.defaultVersion,
    ram,
    cpu,
    disk,
    port,
    nodeId = "local",
    description = "",
    javaVersion = "",
    autoRestart = false,
  } = req.body || {};

  if (!name || String(name).trim().length < 3)
    return res.status(400).json({ error: "Server name must be at least 3 characters" });
  if (!ram || Number(ram) < 512) return res.status(400).json({ error: "RAM must be at least 512 MB" });
  if (!port || Number(port) < 1024 || Number(port) > 65535)
    return res.status(400).json({ error: "Port must be between 1024 and 65535" });

  if (Number(ram) > settings.maxRamPerServer)
    return res.status(400).json({ error: `RAM cannot exceed the panel limit of ${settings.maxRamPerServer} MB` });
  if (cpu && Number(cpu) > settings.maxCpuPerServer)
    return res.status(400).json({ error: `CPU cannot exceed ${settings.maxCpuPerServer} cores` });
  if (disk && Number(disk) > settings.maxDiskPerServer)
    return res.status(400).json({ error: `Disk cannot exceed ${settings.maxDiskPerServer} MB` });

  const existing = await listServers();
  if (existing.some((s) => Number(s.port) === Number(port)))
    return res.status(400).json({ error: "That port is already allocated to another server" });

  const targetOwnerId = isAdminRole(user.role) && ownerId ? ownerId : user.id;
  const owner = await findUserById(targetOwnerId);
  if (!owner) return res.status(400).json({ error: "Selected owner account does not exist" });

  if (!isAdminRole(user.role)) {
    const mine = existing.filter((s) => s.owner === user.id);
    if (mine.length >= settings.maxServersPerUser)
      return res.status(400).json({ error: `You have reached the limit of ${settings.maxServersPerUser} servers` });
  }

  const record: ServerRecord = {
    id: id("srv_"),
    name: String(name).trim(),
    owner: owner.id,
    ownerName: owner.username,
    description: String(description || ""),
    software: String(software).toUpperCase(),
    version: String(version),
    runtime: "local",
    nodeId,
    ip: "0.0.0.0",
    port: Number(port),
    cpu: Number(cpu) || 1,
    ram: Number(ram),
    disk: Number(disk) || 10240,
    status: "installing",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    startedAt: null,
    lastBackupAt: null,
    pid: null,
    javaVersion: javaVersion || javaVersionFor(String(software), String(version)),
    autoRestart: Boolean(autoRestart),
    planLabel: `${Number(ram) / 1024} GB RAM`,
  };

  await saveServers([...existing, record]);
  res.status(201).json(record);

  // Provision in the background so the UI stays responsive
  (async () => {
    try {
      await provisionServerWithLogs(record);
      await notify({
        userId: owner.id,
        title: "Server ready",
        message: `Your server "${record.name}" has been created and is ready to start.`,
        type: "success",
        link: `/servers/${record.id}`,
      });
      await logActivity({
        type: "server",
        action: "create",
        message: `${req.user.username} created server "${record.name}" for ${owner.username}`,
        actorId: req.user.id,
        actorName: req.user.username || "",
        target: record.id,
        ip: clientIp(req),
      });
    } catch (err: any) {
      await notify({
        userId: owner.id,
        title: "Server installation failed",
        message: `"${record.name}" could not finish installation: ${err.message}`,
        type: "error",
        link: `/servers/${record.id}`,
      });
    }
  })();

  return;
});

router.put("/:id/resources", requireScope("servers.write"), async (req: any, res) => {
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Administrator access required" });
  const server = await guardServer(req, res);
  if (!server) return;
  const settings = await getSettings();
  const { ram, cpu, disk } = req.body || {};
  if (ram && (Number(ram) < 512 || Number(ram) > settings.maxRamPerServer))
    return res.status(400).json({ error: `RAM must be between 512 and ${settings.maxRamPerServer} MB` });
  const updated = await updateServer(server.id, {
    ...(ram ? { ram: Number(ram) } : {}),
    ...(cpu ? { cpu: Number(cpu) } : {}),
    ...(disk ? { disk: Number(disk) } : {}),
  });
  res.json(updated);
});

router.put("/:id/suspend", requireScope("servers.write"), async (req: any, res) => {
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Administrator access required" });
  const server = await guardServer(req, res);
  if (!server) return;
  const suspend = Boolean(req.body?.suspend);
  if (suspend) await killServer(server.id).catch(() => {});
  const updated = await updateServer(server.id, { status: suspend ? "suspended" : "offline" });
  await notify({
    userId: server.owner,
    title: suspend ? "Server suspended" : "Server unsuspended",
    message: `"${server.name}" has been ${suspend ? "suspended" : "reactivated"} by an administrator.`,
    type: suspend ? "warning" : "success",
    link: `/servers/${server.id}`,
  });
  res.json(updated);
});

router.put("/:id/owner", requireScope("servers.write"), async (req: any, res) => {
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Administrator access required" });
  const server = await guardServer(req, res);
  if (!server) return;
  const owner = await findUserById(String(req.body?.ownerId || ""));
  if (!owner) return res.status(400).json({ error: "Owner account not found" });
  const updated = await updateServer(server.id, { owner: owner.id, ownerName: owner.username });
  res.json(updated);
});

router.delete("/:id", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  if (!isAdminRole(req.user.role) && server.owner !== req.user.id)
    return res.status(403).json({ error: "Forbidden" });
  await deleteServerCompletely(server.id);
  const servers = await listServers();
  await saveServers(servers.filter((s) => s.id !== server.id));
  await logActivity({
    type: "server",
    action: "delete",
    message: `${req.user.username} deleted server "${server.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: server.id,
    ip: clientIp(req),
  });
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Plugin / mod installation (downloads jar into plugins/ or mods/)
// ---------------------------------------------------------------------------
router.post("/:id/plugins/install", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const { url, fileName, target = "plugins" } = req.body || {};
    if (!url || !/^https?:\/\//.test(String(url)))
      return res.status(400).json({ error: "A valid download URL is required" });
    const folder = target === "mods" ? "mods" : "plugins";
    const dir = path.join(serverDir(server.id), folder);
    await fs.ensureDir(dir);
    const safeName = String(fileName || "plugin.jar").replace(/[^a-zA-Z0-9._-]/g, "-");
    const dest = safeJoin(dir, safeName);

    const response = await fetch(String(url), {
      headers: { "User-Agent": "ZK-MC3-PANEL/1.0" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error("Downloaded file looks invalid (too small)");
    await fs.writeFile(dest, buffer);

    await logActivity({
      type: "server",
      action: "plugin-install",
      message: `${req.user.username} installed ${safeName} on "${server.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: server.id,
      ip: clientIp(req),
    });
    res.json({ success: true, fileName: safeName, size: buffer.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Port allocation helper for the create-server form
// ---------------------------------------------------------------------------
router.get("/meta/software", requireScope("servers.read"), async (_req, res) => {
  res.json(SOFTWARE_TYPES);
});

export default router;

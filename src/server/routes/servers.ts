import { Router } from "express";
import multer from "multer";
import fs from "fs-extra";
import path from "path";
import archiver from "archiver";
import extract from "extract-zip";
import { requireScope, requireAuth, requireAdmin, clientIp } from "../middleware/auth";
import {
  snapshot as playitSnapshot,
  startTunnel,
  stopTunnel,
  restartTunnel,
  resetTunnel,
  purgeTunnel,
} from "../services/playit";
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
import {
  SOFTWARE_TYPES,
  SOFTWARE_DEFINITION,
  javaVersionFor,
  isProxy,
  isRuntime,
  javaMajorFor,
  softwareSummary,
  modrinthLoadersFor,
} from "../services/software";
import { findPortOwners } from "../services/proc";
import {
  installProjectFile,
  searchCatalog,
  projectVersions,
  projectDetail,
  listInstalledFiles,
  removeInstalledFile,
  resolveModrinthVersion,
  serverLoader,
} from "../services/files";
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

/**
 * Reads the live player list out of the server's own log.
 * ---------------------------------------------------------------------------
 * Vanilla/Paper announce joins and leaves as "[Server thread/INFO]: <name>
 * joined the game". Recent log lines are replayed in order so the roster is a
 * real count of who is in the world right now — no RCON, no extra ports.
 */
const PLAYER_JOIN = /]:\s*([A-Za-z0-9_]{1,16}) joined the game/;
const PLAYER_LEAVE = /]:\s*([A-Za-z0-9_]{1,16}) (?:left the game|lost connection)/;

export const listOnlinePlayers = async (serverId: string) => {
  const online = new Set<string>();
  try {
    const raw = await readConsole(serverId, 4000);
    for (const line of raw.split(/\r?\n/)) {
      const join = PLAYER_JOIN.exec(line);
      if (join) {
        online.add(join[1]);
        continue;
      }
      const leave = PLAYER_LEAVE.exec(line);
      if (leave) online.delete(leave[1]);
    }
  } catch {
    /* empty roster */
  }
  return [...online];
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
  const onlinePlayers = await listOnlinePlayers(server.id);
  res.json({
    online: onlinePlayers.length > 0,
    onlinePlayers,
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
  // CPU is reported as a share of the cores allocated to this server so the
  // gauge matches the limit shown next to it in the console sidebar.
  const cpuPercent = server.cpu ? Math.round(state.cpu * 10) / 10 : state.cpu;
  res.json({
    ...state,
    // JTG-compatible field names so the console can mirror its layout exactly.
    isRunning: state.running,
    cpu: cpuPercent,
    disk,
    status: state.running ? "online" : server.status === "suspended" ? "suspended" : "offline",
    address: `${server.ip === "0.0.0.0" ? "0.0.0.0" : server.ip}:${server.port}`,
    limitRam: server.ram,
    limitCpu: server.cpu,
    limitDisk: server.disk,
    ramPercent: server.ram ? Math.min(100, Math.round((state.ram / server.ram) * 100)) : 0,
    cpuPercent: server.cpu ? Math.min(100 * server.cpu, Math.round((state.cpu / server.cpu) * 100)) : state.cpu,
    diskPercent: server.disk ? Math.min(100, Math.round((disk / server.disk) * 100)) : 0,
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
    console.log(`[lifecycle] ${req.user.username || "user"} -> ${action} "${server.name}" (${server.id})`);
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

  // `software` was never validated, so a removed type (or any typo) still
  // produced a server that could never install. Reject it at the door.
  if (!SOFTWARE_DEFINITION(String(software)))
    return res.status(400).json({
      error: `Unknown software type "${software}". Supported: ${SOFTWARE_TYPES.map((s) => s.id).join(", ")}`,
    });
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

  // A port can be free in the panel database yet already bound on the node
  // (another service, or an orphaned process). Catch it at creation time.
  if (nodeId === "local" && (await findPortOwners(Number(port))).length)
    return res.status(400).json({ error: `Port ${port} is already in use by another process on this node` });

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
  // Kill any playit agent first: it outlives the server directory otherwise.
  await purgeTunnel(server.id).catch(() => {});
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

/** Turns a raw axios/network failure into a message an operator can act on. */
const modrinthFailure = (err: any): string => {
  const code = String(err?.code || "");
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(code)) {
    return "This node cannot reach Modrinth (api.modrinth.com). Check outbound internet access, then retry.";
  }
  if (String(err?.message || "").includes("TLS") || String(err?.message || "").includes("socket disconnected")) {
    return "The connection to Modrinth was interrupted. Retry in a moment.";
  }
  return err?.message || "Could not reach Modrinth.";
};

// ---------------------------------------------------------------------------
// Plugin / mod manager (Modrinth)
// ---------------------------------------------------------------------------
const catalogTarget = (server: ServerRecord, requested?: string): "plugins" | "mods" => {
  if (requested === "mods" || requested === "plugins") return requested;
  return ["FABRIC", "FORGE", "NEOFORGE", "QUILT", "SPIGOT", "PAPER", "PURPUR", "VANILLA"].includes(
    (server.software || "").toUpperCase()
  ) && ["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes((server.software || "").toUpperCase())
    ? "mods"
    : "plugins";
};

/** Rejects proxy/vanilla servers before any Modrinth call is made. */
const requireModrinthServer = (server: ServerRecord, target: "plugins" | "mods") => {
  if (isProxy(server.software)) {
    throw new Error(
      `${server.software} is a proxy — plugins must be uploaded manually through the File Manager.`
    );
  }
  if (isRuntime(server.software)) {
    throw new Error(`${server.software} is an application runtime, not a Minecraft server.`);
  }
  if (target === "mods" && !["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes(server.software.toUpperCase())) {
    throw new Error(`${server.software} does not load Fabric/Forge mods. Use the Plugins tab instead.`);
  }
  if (target === "plugins" && ["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes(server.software.toUpperCase())) {
    throw new Error(`${server.software} does not load Bukkit plugins. Use the Mods tab instead.`);
  }
};

/** Search Modrinth for this server's software and game version. */
router.get("/:id/modrinth/search", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.query.target || ""));
  try {
    requireModrinthServer(server, target);
    const data = await searchCatalog(
      String(req.query.q || ""),
      target,
      String(req.query.version || server.version || ""),
      Number(req.query.limit) || 20
    );
    res.json({
      ...data,
      target,
      loader: serverLoader(server.software),
      software: server.software,
      version: server.version,
    });
  } catch (err: any) {
    res.status(502).json({ error: modrinthFailure(err) });
  }
});

/** Full detail for one project (used by the install modal). */
router.get("/:id/modrinth/project/:slug", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    res.json(await projectDetail(String(req.params.slug)));
  } catch (err: any) {
    res.status(502).json({ error: modrinthFailure(err) });
  }
});

/** Every published build for a project, annotated with compatibility. */
router.get("/:id/modrinth/versions/:slug", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.query.target || ""));
  try {
    requireModrinthServer(server, target);
    const loaders = modrinthLoadersFor(server.software).map((l) => l.toLowerCase());
    const versions = await projectVersions(String(req.params.slug));
    res.json({
      versions: versions.map((v) => ({
        ...v,
        compatible:
          (!loaders.length || v.loaders.some((l) => loaders.includes(l.toLowerCase()))) &&
          v.gameVersions.includes(String(server.version)),
      })),
      software: server.software,
      version: server.version,
      loader: serverLoader(server.software),
    });
  } catch (err: any) {
    res.status(502).json({ error: modrinthFailure(err) });
  }
});

/** One-click install: resolves the best compatible build automatically. */
router.post("/:id/modrinth/install", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.body?.target || ""));
  try {
    requireModrinthServer(server, target);
    const { projectId, projectName, projectSlug, versionId, url, fileName } = req.body || {};
    if (!projectId && !versionId && !url) {
      return res.status(400).json({ error: "A projectId, versionId or url is required" });
    }
    const installed = await installProjectFile(server.id, {
      projectId: projectId ? String(projectId) : undefined,
      projectName: projectName ? String(projectName) : undefined,
      projectSlug: projectSlug ? String(projectSlug) : undefined,
      versionId: versionId ? String(versionId) : undefined,
      url: url ? String(url) : undefined,
      fileName: fileName ? String(fileName) : undefined,
      target,
    });

    await logActivity({
      type: "server",
      action: "plugin-install",
      message: `${req.user.username} installed ${installed.fileName} on "${server.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: server.id,
      ip: clientIp(req),
    });

    res.json({
      success: true,
      ...installed,
      message: `${installed.fileName}${
        installed.versionNumber ? ` (${installed.versionNumber})` : ""
      } installed into ${installed.folder}/. Restart the server to load it.`,
    });
  } catch (err: any) {
    res.status(400).json({ error: modrinthFailure(err) });
  }
});

/** Jars present in plugins/ or mods/. */
router.get("/:id/modrinth/installed", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.query.target || ""));
  try {
    res.json({ target, items: await listInstalledFiles(server.id, target) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Removes one installed jar. */
router.delete("/:id/modrinth/installed/:filename", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.query.target || ""));
  try {
    const removed = await removeInstalledFile(server.id, target, String(req.params.filename));
    res.json({ success: true, message: `Removed ${removed} from ${target}/. Restart the server to apply.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** Which manager this server has, so the UI can hide the wrong tab. */
router.get("/:id/modrinth/meta", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const type = (server.software || "").toUpperCase();
  res.json({
    software: server.software,
    version: server.version,
    proxy: isProxy(type),
    runtime: isRuntime(type),
    supportsPlugins: !isProxy(type) && !isRuntime(type) && !["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes(type),
    supportsMods: !isProxy(type) && !isRuntime(type) && ["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes(type),
    loader: serverLoader(server.software),
    loaders: modrinthLoadersFor(server.software),
    java: javaMajorFor(server.software, server.version),
  });
});

// Legacy aliases kept so older console builds keep working.
router.post("/:id/plugins/install", requireScope("servers.write"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.body?.target || ""));
  try {
    requireModrinthServer(server, target);
    const installed = await installProjectFile(server.id, {
      projectId: req.body?.projectId ? String(req.body.projectId) : undefined,
      versionId: req.body?.versionId ? String(req.body.versionId) : undefined,
      url: req.body?.url ? String(req.body.url) : undefined,
      fileName: req.body?.fileName ? String(req.body.fileName) : undefined,
      projectName: req.body?.projectName ? String(req.body.projectName) : undefined,
      target,
    });
    res.json({ success: true, ...installed });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/plugins/catalog", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  const target = catalogTarget(server, String(req.query.target || ""));
  try {
    requireModrinthServer(server, target);
    const data = await searchCatalog(
      String(req.query.q || ""),
      target,
      String(req.query.version || server.version || ""),
      Number(req.query.limit) || 20
    );
    res.json({ ...data, loader: serverLoader(server.software), target });
  } catch (err: any) {
    res.status(502).json({ error: modrinthFailure(err) });
  }
});

router.get("/:id/plugins/versions", requireScope("servers.read"), async (req: any, res) => {
  const server = await guardServer(req, res);
  if (!server) return;
  try {
    const versions = await projectVersions(
      String(req.query.slug || ""),
      String(req.query.version || server.version || ""),
      String(req.query.loader || serverLoader(server.software))
    );
    res.json({ versions });
  } catch (err: any) {
    res.status(502).json({ error: modrinthFailure(err) });
  }
});

// ---------------------------------------------------------------------------
// Software catalogue for the create-server form
// ---------------------------------------------------------------------------
router.get("/meta/software", requireScope("servers.read"), async (_req, res) => {
  res.json(SOFTWARE_TYPES.map((s) => ({ ...s, java: s.java || "" })));
});

/** Java + Modrinth capability summary for one software/version pair. */
// ---------------------------------------------------------------------------
// Playit.gg tunnels
// ---------------------------------------------------------------------------
// Playit exposes a local port to the internet without port-forwarding. The panel
// supervises the official agent per server; the operator claims the agent once
// with the URL the agent prints, after which the tunnel is permanent.
//
// Gated by Panel Settings → Features → "Playit tunnels" so an operator can hide
// the feature entirely (matching how JTG exposes it).

const playitEnabled = async () => (await getSettings()).enablePlayit;
const playitGate = async (res: any) => {
  if (await playitEnabled()) return true;
  res.status(403).json({
    error: "Playit tunnels are disabled on this panel. An administrator can enable them in Panel Settings → Features.",
  });
  return false;
};

const tunnelPayload = (server: ServerRecord, state: any) => ({
  ...state,
  address: state.address || `${server.ip === "0.0.0.0" ? "0.0.0.0" : server.ip}:${server.port}`,
  localPort: server.port,
  enabled: true,
});

router.get("/:id/playit", requireScope("servers.read"), async (req: any, res) => {
  if (!(await playitGate(res))) return;
  const server = await guardServer(req, res);
  if (!server) return;
  res.json(tunnelPayload(server, playitSnapshot(server.id)));
});

router.post("/:id/playit/start", requireScope("servers.manage"), async (req: any, res) => {
  if (!(await playitGate(res))) return;
  const server = await guardServer(req, res);
  if (!server) return;
  const state = await startTunnel(server.id);
  res.json(tunnelPayload(server, state));
});

router.post("/:id/playit/restart", requireScope("servers.manage"), async (req: any, res) => {
  if (!(await playitGate(res))) return;
  const server = await guardServer(req, res);
  if (!server) return;
  const state = await restartTunnel(server.id);
  res.json(tunnelPayload(server, state));
});

router.post("/:id/playit/stop", requireScope("servers.manage"), async (req: any, res) => {
  if (!(await playitGate(res))) return;
  const server = await guardServer(req, res);
  if (!server) return;
  res.json(tunnelPayload(server, await stopTunnel(server.id)));
});

router.post("/:id/playit/reset", requireScope("servers.manage"), async (req: any, res) => {
  if (!(await playitGate(res))) return;
  const server = await guardServer(req, res);
  if (!server) return;
  res.json(tunnelPayload(server, await resetTunnel(server.id)));
});

router.get("/meta/software/:id", requireScope("servers.read"), async (req, res) => {
  res.json(softwareSummary(String(req.params.id), String(req.query.version || "")));
});

export default router;

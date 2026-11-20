import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import {
  listNodes,
  createNode,
  updateNode,
  deleteNode,
  nodeWithUsage,
  probeNode,
  findNode,
  saveNodes,
  localNode,
} from "../services/nodes";
import { listServers } from "../services/runtime";
import { logActivity } from "../services/activity";
import { clientIp } from "../middleware/auth";

const router = Router();
router.use(requireAdmin);

/**
 * Trimmed, validated body → the fields a node actually uses.
 * Only keys that were *sent* are returned, so a PATCH that changes one field
 * cannot blank the rest (that used to wipe ip/hostname and break the probe).
 */
const readNodeBody = (body: any, { partial = false }: { partial?: boolean } = {}) => {
  const out: Record<string, any> = {};
  const text = (v: any) => String(v ?? "").trim();
  const num = (v: any, min: number, max: number) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(min, Math.min(max, n));
  };
  const add = (key: string, value: any) => {
    if (value !== undefined) out[key] = value;
  };

  if (!partial || body?.name !== undefined) add("name", text(body?.name));
  if (!partial || body?.hostname !== undefined) add("hostname", text(body?.hostname));
  if (!partial || body?.ip !== undefined) add("ip", text(body?.ip));
  if (!partial || body?.port !== undefined) add("port", num(body?.port, 1, 65535) ?? 31120);
  add("cpuCores", num(body?.cpuCores, 1, 512));
  add("memoryMb", num(body?.memoryMb, 256, 64 * 1024 * 1024));
  add("diskMb", num(body?.diskMb, 1024, 1024 * 1024 * 1024));
  if (!partial || body?.location !== undefined) add("location", text(body?.location));
  if (!partial || body?.description !== undefined) add("description", text(body?.description));
  return out as {
    name?: string;
    hostname?: string;
    ip?: string;
    port?: number;
    cpuCores?: number;
    memoryMb?: number;
    diskMb?: number;
    location?: string;
    description?: string;
  };
};

/** Hostnames and IPv4 addresses only — anything else is a typo waiting to fail. */
const validHost = (value: string) =>
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value) ||
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value) ||
  value === "localhost";

router.get("/", async (_req, res) => {
  const nodes = await listNodes();
  const servers = await listServers();
  res.json(await Promise.all(nodes.map((n) => nodeWithUsage(n, servers))));
});

/** Validates the form before anything is persisted, and reports every problem. */
router.post("/validate", async (req: any, res) => {
  const input = readNodeBody(req.body);
  const errors: string[] = [];
  if (!input.name) errors.push("Give the node a name.");
  if (!input.ip) errors.push("Enter the node's public IP or hostname.");
  else if (!validHost(input.ip)) errors.push(`"${input.ip}" is not a valid IP address or hostname.`);
  if (errors.length) return res.status(400).json({ ok: false, errors });

  const probe = await probeNode({
    id: "pending",
    name: input.name,
    hostname: input.hostname || input.ip,
    ip: input.ip,
    port: input.port,
    type: "agent",
    token: String(req.body?.token || "").trim(),
    cpuCores: input.cpuCores || 4,
    memoryMb: input.memoryMb || 8192,
    diskMb: input.diskMb || 102400,
    location: input.location,
    status: "offline",
    lastSeen: null,
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: probe.authenticated, probe });
});

router.post("/", async (req: any, res) => {
  const input = readNodeBody(req.body);
  if (!input.name) return res.status(400).json({ error: "Node name is required" });
  if (!input.ip) return res.status(400).json({ error: "The node's public IP or hostname is required" });
  if (!validHost(input.ip)) return res.status(400).json({ error: `"${input.ip}" is not a valid IP address or hostname` });
  try {
    const node = await createNode(input);
    await logActivity({
      type: "node",
      action: "create",
      message: `${req.user.username} added the node "${node.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: node.id,
      ip: clientIp(req),
    });
    res.status(201).json(node);
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

/** Live probe — the operator can hit this before the node is reachable. */
router.post("/:id/test", async (req: any, res) => {
  const node = await findNode(req.params.id);
  if (!node) return res.status(404).json({ error: "Node not found" });
  if (node.id === "local") {
    return res.json({ ok: true, message: "Built-in node is always reachable.", latencyMs: 0 });
  }
  const probe = await probeNode(node, 5000);
  if (probe.authenticated) {
    // Adopt the real hostname/capacity the first time a node answers.
    const nodes = await listNodes();
    const stored = nodes.find((n) => n.id === node.id);
    if (stored) {
      await updateNode(node.id, {
        status: "online",
        lastSeen: new Date().toISOString(),
        hostname: probe.system?.hostname || stored.hostname,
        cpuCores: probe.system?.cpuCores || stored.cpuCores,
        memoryMb: probe.system?.memoryTotalMb || stored.memoryMb,
        diskMb: probe.system?.diskTotalMb || stored.diskMb,
      });
    }
  }
  res.json({ ok: probe.authenticated, probe });
});

/**
 * The real agent token, for the copy-paste install command.
 * Deliberately a separate endpoint so it is only ever handed out on demand —
 * node lists (and anything that renders their JSON) keep seeing the mask.
 */
router.get("/:id/token", async (req: any, res) => {
  const node = await findNode(req.params.id);
  if (!node) return res.status(404).json({ error: "Node not found" });
  if (node.id === "local") return res.status(400).json({ error: "The local node has no agent token" });
  res.json({ token: node.token, ip: node.ip, port: node.port, name: node.name });
});

/** Rotates the token; the operator must restart the agent with the new value. */
router.post("/:id/token/rotate", async (req: any, res) => {
  const node = await findNode(req.params.id);
  if (!node || node.id === "local") return res.status(400).json({ error: "Only remote nodes have tokens" });
  const token = `zkt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await updateNode(node.id, { token });
  await logActivity({
    type: "node",
    action: "token.rotate",
    message: `${req.user.username} rotated the agent token for "${node.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: node.id,
    ip: clientIp(req),
  });
  res.json({ token });
});

router.patch("/:id", async (req: any, res) => {
  if (req.params.id === "local") return res.status(400).json({ error: "The local node cannot be edited" });
  const input = readNodeBody(req.body, { partial: true });
  if (input.ip && !validHost(input.ip)) return res.status(400).json({ error: `"${input.ip}" is not a valid IP address or hostname` });
  const existing = await findNode(req.params.id);
  if (!existing) return res.status(404).json({ error: "Node not found" });
  if (input.ip && input.ip !== existing.ip) {
    const nodes = await listNodes();
    if (nodes.some((n) => n.id !== existing.id && n.ip === input.ip && n.port === input.port)) {
      return res.status(409).json({ error: `Another node already uses ${input.ip}:${input.port}` });
    }
  }
  const node = await updateNode(req.params.id, input as any);
  if (!node) return res.status(404).json({ error: "Node not found" });
  res.json({ ...node, token: node.token ? "••••••••" : "" });
});

router.delete("/:id", async (req: any, res) => {
  if (req.params.id === "local") return res.status(400).json({ error: "The local node cannot be removed" });
  const servers = await listServers();
  const mine = servers.filter((s) => s.nodeId === req.params.id);
  if (mine.length) {
    return res.status(400).json({
      error: `${mine.length} server${mine.length === 1 ? " is" : "s are"} still assigned to this node — move or delete them first.`,
    });
  }
  await deleteNode(req.params.id);
  res.json({ success: true });
});

/** Removes nodes whose agent has never answered, in one call. */
router.post("/prune/offline", async (req: any, res) => {
  const stored = (await listNodes()).filter((n) => n.id !== "local");
  const servers = await listServers();
  const removable = stored.filter((n) => !n.lastSeen && !servers.some((s) => s.nodeId === n.id));
  await saveNodes(stored.filter((n) => !removable.includes(n)));
  res.json({ removed: removable.length });
});

export default router;

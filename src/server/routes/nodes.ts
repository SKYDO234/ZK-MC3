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

/**
 * --- Agent-facing, deliberately unauthenticated by session -------------------
 * The agent has no login. Its bearer token *is* the credential, which is why
 * this router is mounted before `requireAdmin` below.
 */
export const agentRouter = Router();

/**
 * Called by the **agent**, not the operator.
 *
 * A node that was registered with no address cannot be probed — the panel has
 * nowhere to send the request. So the agent announces itself here the moment it
 * boots, and the panel fills in the address it reports. This is what makes
 * "paste one command and it connects itself" true: nothing had to be known in
 * advance.
 */
agentRouter.post("/api/nodes/self-register", async (req: any, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "Missing token" });

  // Resolve by the panel's view of the connection, not by what the agent claims.
  const seenIp =
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  const reported = req.body?.address || {};
  const ip = String(reported.host || seenIp || "").trim();
  const port = Number(reported.port) || 6768;
  const protocol = reported.protocol === "https" ? "https" : "http";

  const nodes = await listNodes();
  const node = nodes.find((n) => n.id !== "local" && n.token === token);
  if (!node) {
    return res.status(401).json({
      error: "Unknown token",
      hint: "Generate a fresh token in the panel — this one belongs to no node.",
    });
  }

  const address = ip && ip !== "0.0.0.0" ? ip : seenIp;
  if (!address) return res.status(400).json({ error: "The agent did not report a reachable address" });

  await updateNode(node.id, {
    ip: address,
    port,
    protocol,
    hostname: String(reported.nodeName || reported.hostname || node.hostname || address),
    status: "online",
    lastSeen: new Date().toISOString(),
    ...(Number(reported.cpuCores) ? { cpuCores: Number(reported.cpuCores) } : {}),
    ...(Number(reported.memoryTotalMb) ? { memoryMb: Number(reported.memoryTotalMb) } : {}),
    ...(Number(reported.diskTotalMb) ? { diskMb: Number(reported.diskTotalMb) } : {}),
  });

  res.json({
    ok: true,
    nodeId: node.id,
    nodeName: node.name,
    address: `${protocol}://${address}:${port}`,
  });
});

const router = Router();
router.use(requireAdmin);

/**
 * The token handed to an operator is base64url of `{ panel, t }`.
 *
 * The installer needs two facts — the secret and the address of the panel that
 * issued it — and asking for the second one is exactly where node setup used
 * to fall apart (people paste the panel's *public* URL, or localhost, and the
 * agent dials nowhere). Folding the panel URL into the token makes the paste a
 * single value with nothing left to look up.
 *
 * `t` is the real secret stored on the node; `panel` is advisory.
 */
const encodeToken = (panelBase: string, secret: string) =>
  Buffer.from(JSON.stringify({ panel: panelBase.replace(/\/+$/, ""), t: secret }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The panel URL a remote machine should use, honouring X-Forwarded-* headers. */
const panelBaseUrl = (req: any) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const hostHeader = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const host = hostHeader || `127.0.0.1:${process.env.PORT || 31120}`;
  // A panel reached over localhost can still be told its real address later;
  // the operator can override it in the sheet.
  return `${proto}://${host}`;
};

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
  if (!partial || body?.port !== undefined) add("port", num(body?.port, 1, 65535) ?? 6768);
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
  // The address is optional on purpose: the agent reports its own public
  // address when it checks in, so requiring it here made the operator guess
  // the one value they are least likely to know (NAT, Codespaces, tunnels).
  if (input.ip && !validHost(input.ip)) {
    return res.status(400).json({ error: `"${input.ip}" is not a valid IP address or hostname` });
  }
  input.ip = input.ip || "0.0.0.0";
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
    // Hand back the encoded token exactly once — it is what the operator
    // pastes into the installer, and it already knows this panel's address.
    res.status(201).json({
      ...node,
      token: "••••••••",
      installToken: encodeToken(panelBaseUrl(req), node.token),
      panelUrl: panelBaseUrl(req),
    });
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
  const panelUrl = String(req.query.panel || "").trim() || panelBaseUrl(req);
  res.json({
    token: node.token,
    installToken: encodeToken(panelUrl, node.token),
    panelUrl,
    ip: node.ip,
    port: node.port,
    name: node.name,
    command: `curl -fsSL ${panelUrl.replace(/\/+$/, "")}/install-agent.sh | sudo bash -s -- ${encodeToken(panelUrl, node.token)}`,
  });
});

/** Rotates the token; the operator must restart the agent with the new value. */
router.post("/:id/token/rotate", async (req: any, res) => {
  const node = await findNode(req.params.id);
  if (!node || node.id === "local") return res.status(400).json({ error: "Only remote nodes have tokens" });
  const token = `zkt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await updateNode(node.id, { token });
  const panelUrl = String(req.body?.panel || "").trim() || panelBaseUrl(req);
  await logActivity({
    type: "node",
    action: "token.rotate",
    message: `${req.user.username} rotated the agent token for "${node.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: node.id,
    ip: clientIp(req),
  });
  res.json({ token, installToken: encodeToken(panelUrl, token), panelUrl });
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

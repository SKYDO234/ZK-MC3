import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import { listNodes, createNode, updateNode, deleteNode, nodeWithUsage, findNode } from "../services/nodes";
import { isNodeConnected, requestNode, forgetNodeServer } from "../services/daemon";
import { listServers } from "../services/runtime";
import { logActivity } from "../services/activity";
import { clientIp } from "../middleware/auth";

const router = Router();
router.use(requireAdmin);

/**
 * Nodes
 * -----
 * Adding a node asks for a name. The panel issues a token, and the operator
 * pastes one command into the machine. The daemon dials out, so there is
 * nothing to probe, no address to validate and no install script to download.
 */

router.get("/", async (_req, res) => {
  const servers = await listServers();
  const nodes = await listNodes();
  res.json(
    await Promise.all(
      // `connected` comes from the live socket map, not from the stored record:
      // a daemon that dropped must read as offline even if its last write said
      // otherwise.
      nodes.map((n) => nodeWithUsage({ ...n, connected: n.id === "local" || isNodeConnected(n.id) }, servers))
    )
  );
});

router.post("/", async (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Give the node a name." });
  if (name.length > 60) return res.status(400).json({ error: "That name is too long (60 characters max)." });

  try {
    const node = await createNode({
      name,
      location: String(req.body?.location || "").trim(),
      description: String(req.body?.description || "").trim(),
    });

    await logActivity({
      type: "node",
      action: "create",
      message: `${req.user.username} added the node "${node.name}"`,
      actorId: req.user.id,
      actorName: req.user.username || "",
      target: node.id,
      ip: clientIp(req),
    });

    // The only time the token is ever returned. It is what the install command
    // carries, and it is why this response is not the same shape as GET /.
    res.status(201).json({
      ...node,
      token: node.token,
      panelUrl: panelBaseUrl(req),
      installCommand: `node . --token ${node.token} --panel ${panelBaseUrl(req)}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Re-issues the token for a node and returns the new install command. */
router.post("/:id/token/rotate", async (req: any, res) => {
  const node = await findNode(req.params.id);
  if (!node) return res.status(404).json({ error: "Node not found" });
  if (node.id === "local") return res.status(400).json({ error: "The local node has no token" });

  // A rotating node must reconnect with the new value; the old socket is stale.
  const token = require("../services/db").id("zkn_");
  await updateNode(node.id, { token, connected: false, status: "offline" });

  await logActivity({
    type: "node",
    action: "token.rotate",
    message: `${req.user.username} rotated the token for "${node.name}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: node.id,
    ip: clientIp(req),
  });

  res.json({
    token,
    installCommand: `node . --token ${token} --panel ${panelBaseUrl(req)}`,
    note: "The daemon on that machine must be restarted with the new token.",
  });
});

/** Live node detail, including whether the daemon is holding a socket. */
router.get("/:id", async (req: any, res) => {
  const node = await findNode(req.params.id);
  if (!node) return res.status(404).json({ error: "Node not found" });
  const servers = await listServers();
  const shaped = await nodeWithUsage({ ...node, connected: isNodeConnected(node.id) }, servers);
  res.json({
    ...shaped,
    daemonConnected: isNodeConnected(node.id),
    java: node.java || null,
    addressSource: node.addressSource || "",
    daemonVersion: node.daemonVersion || "",
  });
});

/** Pings the daemon and reports round-trip latency. */
router.post("/:id/ping", async (req: any, res) => {
  if (req.params.id === "local") return res.json({ ok: true, latencyMs: 0, message: "Local node." });
  if (!isNodeConnected(req.params.id)) {
    return res.status(409).json({
      ok: false,
      error: "That node's daemon is not connected. Start it on the machine and it will dial in by itself.",
    });
  }
  const started = Date.now();
  try {
    await requestNode(req.params.id, "node:ping", {}, 6000);
    res.json({ ok: true, latencyMs: Date.now() - started, message: "Daemon answered." });
  } catch (err: any) {
    res.status(504).json({ ok: false, error: err.message });
  }
});

router.patch("/:id", async (req: any, res) => {
  if (req.params.id === "local") return res.status(400).json({ error: "The local node cannot be edited" });
  const patch: Record<string, any> = {};
  for (const key of ["name", "location", "description"]) {
    if (req.body?.[key] !== undefined) patch[key] = String(req.body[key]).trim();
  }
  if (patch.name !== undefined && !patch.name) return res.status(400).json({ error: "The name cannot be empty" });
  const node = await updateNode(req.params.id, patch);
  if (!node) return res.status(404).json({ error: "Node not found" });
  res.json({ ...node, token: "" });
});

router.delete("/:id", async (req: any, res) => {
  if (req.params.id === "local") return res.status(400).json({ error: "The local node cannot be removed" });
  const servers = await listServers();
  const assigned = servers.filter((s) => s.nodeId === req.params.id);
  if (assigned.length) {
    return res.status(400).json({
      error: `${assigned.length} server${assigned.length === 1 ? " is" : "s are"} assigned to this node. Move or delete them first.`,
    });
  }
  await deleteNode(req.params.id);
  await logActivity({
    type: "node",
    action: "delete",
    message: `${req.user.username} removed a node`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: req.params.id,
    ip: clientIp(req),
  });
  res.json({ success: true });
});

/** Removes servers' files from a node that is being decommissioned. */
router.post("/:id/purge/:serverId", async (req: any, res) => {
  await forgetNodeServer(req.params.id, req.params.serverId);
  res.json({ success: true });
});

/**
 * The panel URL a daemon should dial.
 *
 * Built from the request so a panel behind a proxy hands out its public
 * address; overridable in the response when it is wrong (localhost, container
 * network) — the operator sees the command before running it.
 */
const panelBaseUrl = (req: any) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  return `${proto}://${host || `127.0.0.1:${process.env.PORT || 31120}`}`;
};

export default router;

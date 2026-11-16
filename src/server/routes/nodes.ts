import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import { listNodes, createNode, updateNode, deleteNode, nodeWithUsage } from "../services/nodes";
import { listServers } from "../services/runtime";
import { logActivity } from "../services/activity";
import { clientIp } from "../middleware/auth";

const router = Router();
router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const nodes = await listNodes();
  const servers = await listServers();
  res.json(await Promise.all(nodes.map((n) => nodeWithUsage(n, servers))));
});

router.post("/", async (req: any, res) => {
  const { name, hostname, ip, port, cpuCores, memoryMb, diskMb, location, description } = req.body || {};
  if (!name || !ip) return res.status(400).json({ error: "Node name and IP address are required" });
  const node = await createNode({ name, hostname, ip, port, cpuCores, memoryMb, diskMb, location, description });
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
});

router.patch("/:id", async (req: any, res) => {
  if (req.params.id === "local") return res.status(400).json({ error: "The local node cannot be edited" });
  const node = await updateNode(req.params.id, req.body || {});
  if (!node) return res.status(404).json({ error: "Node not found" });
  res.json(node);
});

router.delete("/:id", async (req: any, res) => {
  if (req.params.id === "local") return res.status(400).json({ error: "The local node cannot be removed" });
  const servers = await listServers();
  if (servers.some((s) => s.nodeId === req.params.id))
    return res.status(400).json({ error: "Move or delete the servers on this node first" });
  await deleteNode(req.params.id);
  res.json({ success: true });
});

export default router;

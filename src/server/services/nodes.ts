import { readJSON, writeJSON, id, nowISO } from "./db";
import { systemSnapshot } from "./proc";
import { listServers } from "./runtime";
import os from "os";

/**
 * Nodes
 * -----
 * A node is a separate machine running the ZK daemon (`daemon/`, shipped as
 * `zkdaemon.zip`). The daemon dials *out* to this panel over Socket.IO — the
 * panel never connects in — so no address, port or firewall rule is involved
 * in registering one.
 *
 * The only thing a node needs is a token. Everything else (hostname, CPU,
 * memory, disk, the address players connect to) is reported by the daemon the
 * first time it says hello, which is why the UI asks for a name and nothing
 * else.
 */
export interface NodeRecord {
  id: string;
  name: string;
  /** Filled in from the daemon's hello — "unknown" until then. */
  hostname: string;
  /** Public address reported by the daemon; used for server connection URLs. */
  ip: string;
  port: number;
  type: "local" | "daemon";
  token: string;
  cpuCores: number;
  memoryMb: number;
  diskMb: number;
  location: string;
  status: "online" | "offline" | "maintenance";
  lastSeen: string | null;
  createdAt: string;
  description?: string;
  allocPortRange?: string;
  /** Set while the daemon holds a live socket; not persisted. */
  connected?: boolean;
  daemonVersion?: string;
  java?: { installed: boolean; version: string | null };
  addressSource?: string;
  /** Last telemetry the daemon sent, written through so cards survive a reload. */
  usage?: { cpu: number; ram: number; disk: number; memoryPercent: number; diskPercent: number };
  hostInfo?: { cpuModel?: string; platform?: string; arch?: string; uptime?: number };
}

const FILE = "nodes.json";

/** Live daemon sockets, keyed by node id. Owned by the realtime layer. */
export const localNode = async (): Promise<NodeRecord> => {
  const snap = await systemSnapshot();
  return {
    id: "local",
    name: "Local Node",
    hostname: snap.hostname,
    ip: "127.0.0.1",
    port: Number(process.env.PORT) || 31120,
    type: "local",
    token: "",
    cpuCores: snap.cpuCores,
    memoryMb: snap.memoryTotalMb,
    diskMb: snap.diskTotalMb,
    location: "Primary",
    status: "online",
    lastSeen: nowISO(),
    createdAt: new Date(0).toISOString(),
    description: "Built-in node running the panel process and local game servers.",
    allocPortRange: "25565-25665",
    connected: true,
  };
};

export const listNodes = async (): Promise<NodeRecord[]> => {
  const stored = await readJSON<NodeRecord[]>(FILE, []);
  // Old records may predate the daemon model; normalise them on read.
  const normalised = stored.map((n) => ({
    ...n,
    type: "daemon" as const,
    ip: n.ip && n.ip !== "0.0.0.0" ? n.ip : "",
  }));
  return [await localNode(), ...normalised];
};

export const saveNodes = (nodes: NodeRecord[]) => writeJSON(FILE, nodes);

export const createNode = async (input: Partial<NodeRecord>) => {
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  const record: NodeRecord = {
    id: id("node_"),
    name: String(input.name || "").trim() || "New Node",
    hostname: "",
    ip: "",
    port: 25565,
    type: "daemon",
    token: id("zkn_"),
    cpuCores: 0,
    memoryMb: 0,
    diskMb: 0,
    location: String(input.location || "").trim(),
    status: "offline",
    lastSeen: null,
    createdAt: nowISO(),
    description: String(input.description || ""),
    allocPortRange: "25565-25665",
  };
  nodes.push(record);
  await saveNodes(nodes);
  return record;
};

export const updateNode = async (nodeId: string, patch: Partial<NodeRecord>) => {
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return null;
  nodes[idx] = { ...nodes[idx], ...patch, id: nodes[idx].id };
  await saveNodes(nodes);
  return nodes[idx];
};

export const findNode = async (nodeId: string): Promise<NodeRecord | null> => {
  if (nodeId === "local") return localNode();
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  return nodes.find((n) => n.id === nodeId) || null;
};

export const deleteNode = async (nodeId: string) => {
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  await saveNodes(nodes.filter((n) => n.id !== nodeId));
};

/**
 * Shapes a node for the API.
 *
 * The token is never included: it is handed out exactly once, when the node is
 * created, because that is the only moment the operator needs it. Everything
 * afterwards is derived from the live connection.
 */
export const nodeWithUsage = async (node: NodeRecord, servers: any[]) => {
  // A stored "online" is only an opinion from the last time the daemon wrote;
  // the socket map is the truth.
  if (node.id !== "local") {
    node = { ...node, status: node.connected ? "online" : node.status === "maintenance" ? "maintenance" : "offline" };
  }
  const mine = servers.filter((s) =>
    node.id === "local" ? !s.nodeId || s.nodeId === "local" : s.nodeId === node.id
  );

  if (node.id === "local") {
    const snap = await systemSnapshot();
    return {
      ...node,
      token: "",
      capacity: { cpuCores: snap.cpuCores, memoryMb: snap.memoryTotalMb, diskMb: snap.diskTotalMb },
      usage: {
        cpu: snap.loadPercent,
        ram: snap.memoryUsedMb,
        disk: snap.diskUsedMb,
        memoryPercent: snap.memoryPercent,
        diskPercent: snap.diskPercent,
      },
      hostInfo: { cpuModel: snap.cpuModel, platform: snap.platform, arch: snap.arch, uptime: snap.uptime },
      connectivity: "Local process — always reachable.",
      serverCount: mine.length,
      allocated: {
        ram: mine.reduce((a, s) => a + (s.ram || 0), 0),
        cpu: mine.reduce((a, s) => a + (s.cpu || 0), 0),
        disk: mine.reduce((a, s) => a + (s.disk || 0), 0),
      },
      uptime: os.uptime(),
    };
  }

  const connected = Boolean(node.connected);
  return {
    ...node,
    token: "",
    capacity: { cpuCores: node.cpuCores, memoryMb: node.memoryMb, diskMb: node.diskMb },
    usage: node.usage || { cpu: 0, ram: 0, disk: 0, memoryPercent: 0, diskPercent: 0 },
    hostInfo: node.hostInfo || {},
    connectivity: connected
      ? "Daemon connected over WebSocket."
      : node.lastSeen
      ? "Daemon offline — it reconnects on its own when the machine is back."
      : "Waiting for the daemon to connect. Run the install command on the node.",
    serverCount: mine.length,
    allocated: {
      ram: mine.reduce((a, s) => a + (s.ram || 0), 0),
      cpu: mine.reduce((a, s) => a + (s.cpu || 0), 0),
      disk: mine.reduce((a, s) => a + (s.disk || 0), 0),
    },
    uptime: 0,
  };
};

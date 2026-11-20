import { readJSON, writeJSON, id, nowISO } from "./db";
import { systemSnapshot } from "./proc";
import { listServers } from "./runtime";
import os from "os";
import axios from "axios";

export interface NodeRecord {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  port: number;
  type: "local" | "agent";
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
}

const FILE = "nodes.json";

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
  };
};

export const listNodes = async (): Promise<NodeRecord[]> => {
  const stored = await readJSON<NodeRecord[]>(FILE, []);
  return [await localNode(), ...stored];
};

export const saveNodes = (nodes: NodeRecord[]) => writeJSON(FILE, nodes);

export interface ProbeResult {
  reachable: boolean;
  authenticated: boolean;
  message: string;
  latencyMs: number | null;
  system?: any;
  java?: any;
  processes?: any[];
}

/**
 * Talks to a node's agent exactly the way `nodeWithUsage` does, but returns the
 * reason it failed instead of swallowing it. Node setup used to fail silently —
 * a mistyped IP, a closed port and a wrong token all looked identical ("offline
 * forever"), which made adding a node a guessing game.
 */
export const probeNode = async (node: NodeRecord, timeoutMs = 4000): Promise<ProbeResult> => {
  const started = Date.now();
  // Step 1 — is anything listening? `/ping` needs no token, so a 401 here is a
  // definitive "wrong token" instead of an ambiguous failure.
  try {
    const ping = await axios.get(`http://${node.ip}:${node.port}/ping`, {
      timeout: Math.min(timeoutMs, 2500),
      validateStatus: () => true,
    });
    if (ping.status === 200 && ping.data?.pong) {
      const latencyMs = Date.now() - started;
      const health = await axios.get(`http://${node.ip}:${node.port}/health`, {
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: node.token ? { Authorization: `Bearer ${node.token}` } : {},
      });
      if (health.status === 200 && health.data?.system) {
        return {
          reachable: true,
          authenticated: true,
          message: "Agent is healthy and reporting telemetry.",
          latencyMs,
          system: health.data.system,
          java: health.data.java,
          processes: health.data.processes,
        };
      }
      return {
        reachable: true,
        authenticated: false,
        message:
          health.status === 401 || health.status === 403
            ? "Agent is running, but it rejected this node's token. Re-copy the install command and restart the agent."
            : `Agent answered /ping but /health returned HTTP ${health.status}.`,
        latencyMs,
      };
    }
  } catch {
    /* fall through to the direct /health attempt below */
  }

  const url = `http://${node.ip}:${node.port}/health`;
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: node.token ? { Authorization: `Bearer ${node.token}` } : {},
    });
    const latencyMs = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      return {
        reachable: true,
        authenticated: false,
        message: "Agent reached, but it rejected the node token. Copy the install command again and restart the agent.",
        latencyMs,
      };
    }
    if (res.status !== 200 || !res.data?.system) {
      return {
        reachable: true,
        authenticated: false,
        message: `Agent responded with HTTP ${res.status} and no health payload. Is this the ZK-MC3 agent port?`,
        latencyMs,
      };
    }
    return {
      reachable: true,
      authenticated: true,
      message: "Agent is healthy and reporting telemetry.",
      latencyMs,
      system: res.data.system,
      java: res.data.java,
      processes: res.data.processes,
    };
  } catch (err: any) {
    const code = err?.code || "";
    const reason =
      code === "ECONNREFUSED"
        ? "Nothing is listening on that host and port. Is the agent running?"
        : code === "ENOTFOUND" || code === "EAI_AGAIN"
        ? "That hostname does not resolve. Use the node's public IP address."
        : code === "ETIMEDOUT" || code === "ECONNABORTED"
        ? "The connection timed out. Check the firewall allows the agent port."
        : err?.message || "Unreachable";
    return { reachable: false, authenticated: false, message: reason, latencyMs: null };
  }
};

export const createNode = async (input: Partial<NodeRecord>) => {
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  const host = String(input.ip || "").trim();
  const port = Number(input.port) || 31120;
  if (nodes.some((n) => n.ip === host && Number(n.port) === port)) {
    throw new Error(`A node already exists at ${host}:${port}`);
  }
  const record: NodeRecord = {
    id: id("node_"),
    name: input.name || "New Node",
    hostname: input.hostname || host,
    ip: host || "0.0.0.0",
    port,
    type: "agent",
    token: id("zkt_"),
    cpuCores: Number(input.cpuCores) || 4,
    memoryMb: Number(input.memoryMb) || 8192,
    diskMb: Number(input.diskMb) || 102400,
    location: input.location || "Default",
    status: "offline",
    lastSeen: null,
    createdAt: nowISO(),
    description: input.description || "",
    allocPortRange: input.allocPortRange || "25565-25665",
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

export const nodeWithUsage = async (node: NodeRecord, servers: any[]) => {
  const mine = servers.filter((s) => node.id === "local" ? !s.nodeId || s.nodeId === "local" : s.nodeId === node.id);
  let live = { cpu: 0, ram: 0, disk: 0 };
  let capacity = { cpuCores: node.cpuCores, memoryMb: node.memoryMb, diskMb: node.diskMb };
  let hostInfo: Record<string, any> = {};
  let connectivity = "Local process — always reachable.";
  if (node.id === "local") {
    const snap = await systemSnapshot();
    live = {
      cpu: snap.loadPercent,
      ram: snap.memoryUsedMb,
      disk: snap.diskUsedMb,
    };
  } else {
    // Real capacity comes from the agent once it answers, so an operator does
    // not have to guess how much RAM the box has when registering it.
    const probe = await probeNode(node, 2500);
    connectivity = probe.message;
    if (probe.authenticated && probe.system) {
      live = {
        cpu: probe.system.loadPercent ?? probe.system.cpuPercent ?? 0,
        ram: probe.system.memoryUsedMb ?? 0,
        disk: probe.system.diskUsedMb ?? 0,
      };
      capacity = {
        cpuCores: probe.system.cpuCores || node.cpuCores,
        memoryMb: probe.system.memoryTotalMb || node.memoryMb,
        diskMb: probe.system.diskTotalMb || node.diskMb,
      };
      hostInfo = {
        cpuModel: probe.system.cpuModel,
        platform: probe.system.platform,
        arch: probe.system.arch,
        uptime: probe.system.uptime,
        java: probe.java,
        processes: (probe.processes || []).length,
      };
      node.status = "online";
      node.lastSeen = nowISO();
      node.hostname = probe.system.hostname || node.hostname;
    } else {
      node.status = node.status === "maintenance" ? "maintenance" : "offline";
    }
  }
  return {
    ...node,
    // The full token is served by GET /nodes/:id/token so the setup command can
    // be copied; the list view only ever sees the mask.
    token: node.token ? "••••••••" : "",
    tokenHint: node.token ? `${node.token.slice(0, 8)}…` : "",
    connectivity,
    capacity,
    hostInfo,
    serverCount: mine.length,
    allocated: {
      ram: mine.reduce((a, s) => a + (s.ram || 0), 0),
      cpu: mine.reduce((a, s) => a + (s.cpu || 0), 0),
      disk: mine.reduce((a, s) => a + (s.disk || 0), 0),
    },
    usage: {
      cpu: Math.round(live.cpu),
      ram: Math.round(live.ram),
      disk: Math.round(live.disk),
      memoryPercent: capacity.memoryMb ? Math.round((live.ram / capacity.memoryMb) * 100) : 0,
      diskPercent: capacity.diskMb ? Math.round((live.disk / capacity.diskMb) * 100) : 0,
    },
    uptime: node.id === "local" ? os.uptime() : 0,
  };
};

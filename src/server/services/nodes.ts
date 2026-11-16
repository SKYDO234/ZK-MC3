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

export const createNode = async (input: Partial<NodeRecord>) => {
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  const record: NodeRecord = {
    id: id("node_"),
    name: input.name || "New Node",
    hostname: input.hostname || "node.local",
    ip: input.ip || "0.0.0.0",
    port: Number(input.port) || 31120,
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

export const deleteNode = async (nodeId: string) => {
  const nodes = await readJSON<NodeRecord[]>(FILE, []);
  await saveNodes(nodes.filter((n) => n.id !== nodeId));
};

export const nodeWithUsage = async (node: NodeRecord, servers: any[]) => {
  const mine = servers.filter((s) => node.id === "local" ? !s.nodeId || s.nodeId === "local" : s.nodeId === node.id);
  let live = { cpu: 0, ram: 0, disk: 0 };
  if (node.id === "local") {
    const snap = await systemSnapshot();
    live = {
      cpu: snap.loadPercent,
      ram: snap.memoryUsedMb,
      disk: snap.diskUsedMb,
    };
  } else {
    // Poll agent health if reachable (short timeout, non-blocking)
    try {
      const res = await axios.get(`http://${node.ip}:${node.port}/health`, {
        timeout: 1200,
        headers: node.token ? { Authorization: `Bearer ${node.token}` } : {},
      });
      if (res.data?.system) {
        live = {
          cpu: res.data.system.loadPercent ?? res.data.system.cpuPercent ?? 0,
          ram: res.data.system.memoryUsedMb ?? 0,
          disk: res.data.system.diskUsedMb ?? 0,
        };
        node.status = "online";
        node.lastSeen = nowISO();
      }
    } catch {
      node.status = node.status === "maintenance" ? "maintenance" : "offline";
    }
  }
  return {
    ...node,
    token: node.token ? "••••••••" : "",
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
      memoryPercent: node.memoryMb ? Math.round((live.ram / node.memoryMb) * 100) : 0,
      diskPercent: node.diskMb ? Math.round((live.disk / node.diskMb) * 100) : 0,
    },
    uptime: node.id === "local" ? os.uptime() : 0,
  };
};

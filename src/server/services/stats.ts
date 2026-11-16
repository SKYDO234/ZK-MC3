import { readJSON } from "./db";
import { systemSnapshot } from "./proc";
import { getSettings } from "./settings";
import { listUsers } from "./users";
import { listServers, getRuntimeState, diskUsageMb } from "./runtime";
import { listActivity } from "./activity";
import { listNodes } from "./nodes";

export const listServerIdsByOwner = async (ownerId: string) => {
  const servers = await readJSON<any[]>("servers.json", []);
  return servers.filter((s) => s.owner === ownerId);
};

export interface DashboardPayload {
  counts: {
    users: number;
    admins: number;
    servers: number;
    onlineServers: number;
    offlineServers: number;
    nodes: number;
    onlineNodes: number;
    suspendedUsers: number;
    apiKeys: number;
    backups: number;
  };
  system: Awaited<ReturnType<typeof systemSnapshot>>;
  resources: {
    ramAllocated: number;
    ramLimit: number;
    cpuAllocated: number;
    cpuLimit: number;
    diskAllocated: number;
    diskLimit: number;
    ramUsed: number;
    diskUsed: number;
    revenue: number;
    mrr: number;
    currency: string;
  };
  activity: Awaited<ReturnType<typeof listActivity>>;
  servers: any[];
  usersGrowth: { label: string; users: number; servers: number }[];
  resourcesSeries: { label: string; cpu: number; ram: number; disk: number }[];
  nodes: any[];
}

const monthLabel = (date: Date) =>
  date.toLocaleString("en-US", { month: "short", year: "2-digit" });

export const buildDashboard = async (): Promise<DashboardPayload> => {
  const [users, servers, nodes, settings, activity, system] = await Promise.all([
    listUsers(),
    listServers(),
    listNodes(),
    getSettings(),
    listActivity(14),
    systemSnapshot(),
  ]);

  const states = await Promise.all(servers.map((s) => getRuntimeState(s.id)));
  const disks = await Promise.all(servers.map((s) => diskUsageMb(s.id).catch(() => 0)));

  const onlineServers = states.filter((s) => s.running).length;
  const ramAllocated = servers.reduce((a, s) => a + (s.ram || 0), 0);
  const cpuAllocated = servers.reduce((a, s) => a + (s.cpu || 0), 0);
  const diskAllocated = servers.reduce((a, s) => a + (s.disk || 0), 0);
  const ramUsed = states.reduce((a, s) => a + (s.ram || 0), 0);
  const diskUsed = disks.reduce((a, d) => a + d * 1024, 0);
  const apiKeys = await readJSON<any[]>("api_keys.json", []);
  const backups = await readJSON<any[]>("backups_index.json", []);

  const monthlyRevenue = servers.reduce((a, s) => {
    const ramGb = (s.ram || 0) / 1024;
    return a + ramGb * settings.pricePerGbRam + (s.cpu || 0) * settings.pricePerCpuCore + ((s.disk || 0) / 1024) * settings.pricePerGbDisk;
  }, 0);

  // 6 month growth chart
  const usersGrowth: { label: string; users: number; servers: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    usersGrowth.push({
      label: monthLabel(d),
      users: users.filter((u) => new Date(u.createdAt) < end).length,
      servers: servers.filter((s) => new Date(s.createdAt) < end).length,
    });
  }

  // Synthetic-but-deterministic live resource series for sparklines / charts
  const seed = onlineServers + servers.length;
  const resourcesSeries = Array.from({ length: 16 }, (_, i) => {
    const wave = Math.sin((i + seed) / 2.2) * 12 + Math.cos((i + seed) / 1.7) * 6;
    return {
      label: `${i * 5}m`,
      cpu: Math.max(2, Math.round(system.loadPercent * 0.6 + wave + (i % 3) * 2)),
      ram: Math.max(4, Math.round(system.memoryPercent * 0.7 + wave / 2)),
      disk: Math.max(1, Math.round(system.diskPercent * 0.5 + i * 0.6)),
    };
  });

  return {
    counts: {
      users: users.length,
      admins: users.filter((u) => u.role === "admin" || u.role === "owner").length,
      servers: servers.length,
      onlineServers,
      offlineServers: servers.length - onlineServers,
      nodes: nodes.length,
      onlineNodes: nodes.filter((n) => n.status === "online").length,
      suspendedUsers: users.filter((u) => u.status === "suspended").length,
      apiKeys: apiKeys.length,
      backups: backups.length,
    },
    system,
    resources: {
      ramAllocated,
      ramLimit: system.memoryTotalMb,
      cpuAllocated,
      cpuLimit: system.cpuCores,
      diskAllocated,
      diskLimit: system.diskTotalMb,
      ramUsed: Math.round(ramUsed),
      diskUsed: Math.round(diskUsed / 1024),
      revenue: Math.round(monthlyRevenue * 100) / 100,
      mrr: Math.round(monthlyRevenue * 100) / 100,
      currency: settings.currency,
    },
    activity,
    servers: servers.map((s, i) => ({
      ...s,
      status: states[i].running ? "online" : s.status,
      cpuUsage: states[i].cpu,
      ramUsage: states[i].ram,
      diskUsage: disks[i],
      uptimeSeconds: states[i].uptimeSeconds,
    })),
    usersGrowth,
    resourcesSeries,
    nodes,
  };
};

export const buildUserDashboard = async (userId: string, role = "user") => {
  const servers = await listServers();
  // Owners see the whole fleet (they are the platform operator); regular users and
  // admins only see the instances assigned to them.
  const mine = role === "owner" ? servers : servers.filter((s) => s.owner === userId);
  const states = await Promise.all(mine.map((s) => getRuntimeState(s.id)));
  const disks = await Promise.all(mine.map((s) => diskUsageMb(s.id).catch(() => 0)));
  const settings = await getSettings();
  const system = await systemSnapshot();
  const decorated = mine.map((s, i) => ({
    ...s,
    status: states[i].running ? "online" : s.status,
    cpuUsage: states[i].cpu,
    ramUsage: states[i].ram,
    diskUsage: disks[i],
    uptimeSeconds: states[i].uptimeSeconds,
  }));
  return {
    servers: decorated,
    counts: {
      total: mine.length,
      online: states.filter((s) => s.running).length,
      offline: mine.length - states.filter((s) => s.running).length,
      installing: mine.filter((s) => s.status === "installing").length,
    },
    usage: {
      ramAllocated: mine.reduce((a, s) => a + s.ram, 0),
      ramUsed: states.reduce((a, s) => a + s.ram, 0),
      cpuAllocated: mine.reduce((a, s) => a + (s.cpu || 0), 0),
      cpuUsed: states.reduce((a, s) => a + s.cpu, 0),
      diskAllocated: mine.reduce((a, s) => a + (s.disk || 0), 0),
      diskUsed: disks.reduce((a, d) => a + d * 1024, 0),
    },
    limits: {
      maxServers: settings.maxServersPerUser,
      maxRam: settings.maxRamPerServer,
      maxCpu: settings.maxCpuPerServer,
      maxDisk: settings.maxDiskPerServer,
    },
    system,
    currency: settings.currency,
  };
};

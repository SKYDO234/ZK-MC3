import fs from "fs";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
export const CLK_TCK = 100;

const lastSample = new Map<number, { ticks: number; at: number }>();

export const isProcessAlive = (pid: number) => {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === "EPERM";
  }
};

/** PIDs of a process and all of its descendants (walks the proc filesystem). */
export const processTree = (rootPid: number): number[] => {
  if (!rootPid || rootPid <= 0) return [];
  const parents = new Map<number, number>();
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === rootPid) continue;
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const ppid = Number(tail[1] || 0);
        if (ppid) parents.set(pid, ppid);
      } catch {
        /* process vanished */
      }
    }
  } catch {
    return [rootPid];
  }
  const children = new Map<number, number[]>();
  parents.forEach((ppid, pid) => {
    const list = children.get(ppid) || [];
    list.push(pid);
    children.set(ppid, list);
  });
  const result: number[] = [rootPid];
  const queue = [rootPid];
  while (queue.length) {
    const current = queue.shift() as number;
    for (const child of children.get(current) || []) {
      if (!result.includes(child)) {
        result.push(child);
        queue.push(child);
      }
    }
  }
  return result;
};

/** Total CPU percent + RSS in MB for a whole process tree. */
export const processTreeUsage = (rootPid: number) => {
  const pids = processTree(rootPid);
  let cpu = 0;
  let ram = 0;
  for (const pid of pids) {
    cpu += processCpuPercent(pid);
    ram += readProcRssMb(pid);
  }
  return { cpu: Math.round(cpu * 10) / 10, ram: Math.round(ram * 10) / 10, pids };
};

/**
 * Ports a process tree currently listens on, resolved through socket inodes so
 * it works for child processes (forks, `java -jar`, reloaded workers).
 */
export const listeningPorts = (rootPid: number): number[] => {
  const pids = processTree(rootPid);
  const inodes = new Set<string>();
  for (const pid of pids) {
    try {
      const fdDir = `/proc/${pid}/fd`;
      for (const fd of fs.readdirSync(fdDir)) {
        try {
          const link = fs.readlinkSync(`${fdDir}/${fd}`);
          const match = /^socket:\[(\d+)\]$/.exec(link);
          if (match) inodes.add(match[1]);
        } catch {
          /* fd closed while walking */
        }
      }
    } catch {
      /* not permitted / vanished */
    }
  }
  if (!inodes.size) return [];

  const ports = new Set<number>();
  const tables = ["/proc/net/tcp", "/proc/net/tcp6"];
  for (const table of tables) {
    try {
      const raw = fs.readFileSync(table, "utf8");
      for (const line of raw.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10) continue;
        if (cols[3] !== "0A") continue; // 0A = LISTEN
        if (!inodes.has(cols[9])) continue;
        const port = parseInt((cols[1] || "").split(":")[1] || "0", 16);
        if (port) ports.add(port);
      }
    } catch {
      /* table unavailable */
    }
  }
  return Array.from(ports).sort((a, b) => a - b);
};

export interface PortOwner {
  pid: number;
  command: string;
}

/** Finds which processes are listening on a TCP port (used to clean stale sockets). */
export const findPortOwners = async (port: number): Promise<PortOwner[]> => {
  if (!port) return [];
  try {
    const { stdout } = await execAsync(`ss -ltnpH "sport = :${port}" 2>/dev/null`);
    const owners: PortOwner[] = [];
    for (const line of stdout.split("\n")) {
      const pidMatch = /pid=(\d+)/.exec(line);
      const nameMatch = /\(\("([^"]+)"/.exec(line);
      if (!pidMatch) continue;
      const pid = Number(pidMatch[1]);
      if (owners.some((o) => o.pid === pid)) continue;
      owners.push({ pid, command: nameMatch ? nameMatch[1] : "unknown" });
    }
    return owners;
  } catch {
    return [];
  }
};

/** True once nothing is listening on the port (or after `timeoutMs`). */
export const waitForPortFree = async (port: number, timeoutMs = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const owners = await findPortOwners(port);
    if (!owners.length) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

export const readProcTicks = (pid: number): number | null => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm can contain spaces/parentheses -> split after last ')'
    const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const utime = Number(tail[11] || 0);
    const stime = Number(tail[12] || 0);
    return utime + stime;
  } catch {
    return null;
  }
};

export const readProcRssMb = (pid: number): number => {
  try {
    const statm = fs.readFileSync(`/proc/${pid}/statm`, "utf8").trim().split(/\s+/);
    const rssPages = Number(statm[1] || 0);
    return Math.round(((rssPages * 4096) / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
};

/** CPU percent for a process since the previous sample (0..100*cores). */
export const processCpuPercent = (pid: number): number => {
  const ticks = readProcTicks(pid);
  if (ticks === null) return 0;
  const now = Date.now();
  const prev = lastSample.get(pid);
  lastSample.set(pid, { ticks, at: now });
  if (!prev) return 0;
  const elapsed = (now - prev.at) / 1000;
  if (elapsed <= 0) return 0;
  const deltaTicks = Math.max(0, ticks - prev.ticks);
  const cpu = (deltaTicks / CLK_TCK / elapsed) * 100;
  return Math.round(Math.min(cpu, 100 * os.cpus().length) * 10) / 10;
};

export const processUptimeSeconds = (pid: number): number => {
  try {
    const stat = fs.statSync(`/proc/${pid}`);
    return Math.max(0, Math.floor((Date.now() - stat.ctimeMs) / 1000));
  } catch {
    return 0;
  }
};

export const dirSizeMb = async (dir: string): Promise<number> => {
  try {
    const { stdout } = await execAsync(`du -sm "${dir}" 2>/dev/null | cut -f1`);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
};

export const systemSnapshot = async () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  let diskTotal = 0;
  let diskFree = 0;
  try {
    const { stdout } = await execAsync("df -k / | tail -1");
    const parts = stdout.trim().split(/\s+/);
    diskTotal = (Number(parts[1]) || 0) * 1024;
    diskFree = (Number(parts[3]) || 0) * 1024;
  } catch {
    /* ignore */
  }
  const load = os.loadavg();
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || "Unknown CPU";
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptime: os.uptime(),
    cpuModel,
    cpuCores: cpus.length,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    loadPercent: Math.min(100, Math.round((load[0] / Math.max(1, cpus.length)) * 100)),
    memoryTotalMb: Math.round(totalMem / 1024 / 1024),
    memoryUsedMb: Math.round((totalMem - freeMem) / 1024 / 1024),
    memoryFreeMb: Math.round(freeMem / 1024 / 1024),
    memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    diskTotalMb: Math.round(diskTotal / 1024 / 1024),
    diskUsedMb: Math.round((diskTotal - diskFree) / 1024 / 1024),
    diskFreeMb: Math.round(diskFree / 1024 / 1024),
    diskPercent: diskTotal ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0,
    nodeVersion: process.version,
    javaRuntime: process.env.JAVA_BIN || "auto",
    totalmem: totalMem,
    freemem: freeMem,
  };
};

export const killTree = async (pid: number, signal: NodeJS.Signals = "SIGTERM") => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
};

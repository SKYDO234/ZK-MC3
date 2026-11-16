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

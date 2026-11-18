import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface NetSample {
  rx: number;
  tx: number;
}

/**
 * Per-socket network accounting.
 *
 * `/proc/<pid>/net/dev` cannot be used: it reports the counters of the whole
 * network namespace, not of a single process. `ss -tinp` however exposes the
 * kernel counters (`bytes_received` / `bytes_sent`) that are really attached to
 * the sockets a PID owns, which is what a hosting panel needs.
 *
 * Every TCP connection appears twice (one row per side), so callers must filter
 * by the server's listening port to avoid double counting.
 */
let cache: { at: number; text: string } | null = null;
let ssAvailable: boolean | null = null;

const readSs = async (): Promise<string> => {
  const now = Date.now();
  if (cache && now - cache.at < 900) return cache.text;
  try {
    const { stdout } = await execFileAsync("ss", ["-tinp"], {
      timeout: 4000,
      maxBuffer: 8 * 1024 * 1024,
    });
    ssAvailable = true;
    cache = { at: now, text: stdout };
    return stdout;
  } catch {
    ssAvailable = false;
    cache = { at: now, text: "" };
    return "";
  }
};

export const networkAccountingAvailable = () => ssAvailable !== false;

const parsePort = (address: string) => {
  const idx = address.lastIndexOf(":");
  if (idx === -1) return 0;
  return Number(address.slice(idx + 1)) || 0;
};

/** Cumulative bytes received/sent on sockets owned by `pid` (optionally only `port`). */
export const socketBytes = async (pid: number, port?: number): Promise<NetSample | null> => {
  if (!pid || pid <= 0) return null;
  const text = await readSs();
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  let rx = 0;
  let tx = 0;
  let matchedPid = false;

  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i];
    if (!head || /^\s/.test(head)) continue; // indented rows are the detail lines
    const pidMatch = /pid=(\d+)/.exec(head);
    if (!pidMatch || Number(pidMatch[1]) !== pid) continue;

    const cols = head.trim().split(/\s+/);
    const local = cols[3] || "";
    if (port && parsePort(local) !== port) continue;
    if (!port && cols[0] === "LISTEN") continue;

    const detail = lines[i + 1] || "";
    const sent = /bytes_sent:(\d+)/.exec(detail);
    const recv = /bytes_received:(\d+)/.exec(detail);
    if (!sent && !recv) continue;

    tx += sent ? Number(sent[1]) : 0;
    rx += recv ? Number(recv[1]) : 0;
    matchedPid = true;
  }

  if (!matchedPid) return { rx: 0, tx: 0 };
  return { rx, tx };
};

const lastSample = new Map<string, { rx: number; tx: number; at: number }>();

/**
 * Instantaneous throughput in bytes/second for one server.
 * Returns cumulative counters plus the computed rate.
 */
export const networkRate = async (serverId: string, pid: number, port?: number) => {
  const sample = await socketBytes(pid, port);
  if (!sample) {
    lastSample.delete(serverId);
    return { netIn: 0, netOut: 0, netInRate: 0, netOutRate: 0 };
  }
  const now = Date.now();
  const prev = lastSample.get(serverId);
  lastSample.set(serverId, { rx: sample.rx, tx: sample.tx, at: now });

  let netInRate = 0;
  let netOutRate = 0;
  if (prev && now > prev.at) {
    const seconds = (now - prev.at) / 1000;
    // A counter that goes backwards means the sockets were recreated (restart).
    const dIn = sample.rx >= prev.rx ? sample.rx - prev.rx : 0;
    const dOut = sample.tx >= prev.tx ? sample.tx - prev.tx : 0;
    netInRate = Math.max(0, Math.round(dIn / seconds));
    netOutRate = Math.max(0, Math.round(dOut / seconds));
  }

  return { netIn: sample.rx, netOut: sample.tx, netInRate, netOutRate };
};

export const forgetNetworkSample = (serverId: string) => {
  lastSample.delete(serverId);
};

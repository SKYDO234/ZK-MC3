import fs from "fs-extra";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import axios from "axios";

/**
 * Playit.gg tunnel agent
 * ---------------------------------------------------------------------------
 * Playit.gg exposes a local port to the public internet without port-forwarding.
 * Its agent is a single static binary that reads a per-server secret file and
 * prints a claim URL the first time it runs; the operator opens that URL once to
 * bind the agent to their playit.gg account, after which the tunnel is permanent.
 *
 * This supervisor owns the agent lifecycle the same way `runtime.ts` owns the
 * Minecraft process: one child process per server, logs streamed live, status
 * derived from the real process — never guessed.
 *
 * Notes on the agent CLI:
 *   playit -s --secret_path <file> --stdout  ... `-s` keeps it as a background
 *   service; `--stdout` makes it log to stdout so we can capture the claim URL.
 */

const AGENT_VERSION = "0.15.26";
const AGENT_BASE = `https://github.com/playit-cloud/playit-agent/releases/download/v${AGENT_VERSION}`;

export interface PlayitState {
  /** running | stopped | starting | downloading | error */
  status: string;
  claimUrl: string | null;
  logs: string[];
  pid: number | null;
  startedAt: string | null;
  error: string | null;
  /** Seconds until we stop waiting for a claim URL. */
  claimExpiresIn?: number;
  totalTunnels?: number;
  address?: string | null;
}

interface Agent {
  child: ChildProcess | null;
  status: string;
  claimUrl: string | null;
  logs: string[];
  startedAt: string | null;
  error: string | null;
  claimDeadline: number | null;
  address: string | null;
}

const agents = new Map<string, Agent>();
const LOG_CAP = 400;

const blank = (): Agent => ({
  child: null,
  status: "stopped",
  claimUrl: null,
  logs: [],
  startedAt: null,
  error: null,
  claimDeadline: null,
  address: null,
});

const stateFor = (serverId: string) => {
  if (!agents.has(serverId)) agents.set(serverId, blank());
  return agents.get(serverId)!;
};

/* ------------------------------------------------------------------ paths */

const agentDir = (serverId: string) => path.join(process.cwd(), ".data", "playit", serverId);
const binaryPath = (serverId: string) => path.join(agentDir(serverId), "playit");
const secretPath = (serverId: string) => path.join(agentDir(serverId), "playit.toml");
const logPath = (serverId: string) => path.join(agentDir(serverId), "agent.log");

/** The released asset name for this machine's architecture. */
const binaryName = () => {
  const arch = process.arch;
  if (process.platform === "win32") return arch === "arm64" ? "playit-windows-arm64.exe" : "playit-windows-x86_64.exe";
  if (process.platform === "darwin") return arch === "arm64" ? "playit-darwin-arm64" : "playit-darwin-amd64";
  if (arch === "arm64") return "playit-linux-aarch64";
  if (arch === "arm") return "playit-linux-armv7";
  return "playit-linux-amd64";
};

/* ------------------------------------------------------------------- logs */

const pushLog = (serverId: string, chunk: string) => {
  const state = stateFor(serverId);
  const clean = chunk
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (!lines.length) return;
  state.logs = [...state.logs, ...lines].slice(-LOG_CAP);

  // The agent prints the claim URL exactly once, on first run. Any URL it emits
  // is authoritative for this run, so a stale link never survives a restart.
  for (const line of lines) {
    const claim = line.match(/https:\/\/playit\.gg\/claim\/[A-Za-z0-9_-]+/);
    if (claim && claim[0] !== state.claimUrl) {
      state.claimUrl = claim[0];
      state.claimDeadline = null;
    }
    const tunnel = line.match(/([a-z0-9-]+\.(?:playit\.gg|at\.playit\.gg)(?::\d+)?)/i);
    if (tunnel && !state.address) state.address = tunnel[1];
  }
};

/* ---------------------------------------------------------------- download */

const ensureBinary = async (serverId: string, log: (msg: string) => void) => {
  const dest = binaryPath(serverId);
  if (await fs.pathExists(dest)) {
    const stat = await fs.stat(dest);
    if (stat.size > 1024 * 1024) return dest; // ~5 MB real agent; anything tiny is junk
  }

  await fs.ensureDir(agentDir(serverId));
  const url = `${AGENT_BASE}/${binaryName()}`;
  log(`[Playit] Fetching the agent (v${AGENT_VERSION}, ${process.platform}/${process.arch}) ...`);

  const temp = `${dest}.download`;
  try {
    const res = await axios.get(url, {
      responseType: "stream",
      timeout: 30000,
      maxRedirects: 5,
      headers: { "User-Agent": "ZK-MC3-PANEL" },
    });
    await pipeline(Readable.from(res.data as any), fs.createWriteStream(temp));
    const stat = await fs.stat(temp);
    // GitHub serves an HTML error page as 200 in some proxy setups.
    if (stat.size < 1024 * 1024) {
      throw new Error(`The downloaded agent was only ${stat.size} bytes — that is not the real binary.`);
    }
    await fs.chmod(temp, 0o755);
    await fs.move(temp, dest, { overwrite: true });
    log(`[Playit] Agent ready (${(stat.size / 1024 / 1024).toFixed(1)} MB).`);
    return dest;
  } catch (err: any) {
    await fs.remove(temp).catch(() => {});
    const code = String(err?.code || "");
    if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(code)) {
      throw new Error(
        "This node cannot reach github.com to download the Playit agent. Check outbound internet access and retry."
      );
    }
    throw new Error(`Could not download the Playit agent: ${err.message}`);
  }
};

/* ----------------------------------------------------------------- process */

const attachedLog = (serverId: string) => {
  const state = stateFor(serverId);
  const child = state.child;
  if (!child || child.killed) return;
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.error = null;
  pushLog(serverId, `[Playit] Agent online (PID ${child.pid}).`);
};

export const startTunnel = async (serverId: string): Promise<PlayitState> => {
  const state = stateFor(serverId);
  if (state.child && !state.child.killed) return snapshot(serverId);

  state.status = "downloading";
  state.error = null;
  state.claimUrl = null;
  state.address = null;
  state.logs = [];
  state.claimDeadline = Date.now() + 120_000;

  const log = (msg: string) => pushLog(serverId, `${msg}\n`);

  let binary: string;
  try {
    binary = await ensureBinary(serverId, log);
  } catch (err: any) {
    state.status = "error";
    state.error = err.message;
    log(`[Playit] ${err.message}`);
    return snapshot(serverId);
  }

  await fs.ensureDir(agentDir(serverId));
  const args = ["-s", "--secret_path", secretPath(serverId), "--stdout"];
  log(`[Playit] Starting agent: playit ${args.join(" ")}`);

  const child = spawn(binary, args, {
    cwd: agentDir(serverId),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  state.child = child;
  state.status = "starting";

  const capture = (buf: Buffer) => {
    const text = buf.toString("utf8");
    pushLog(serverId, text);
    try {
      fs.appendFileSync(logPath(serverId), text);
    } catch {
      /* log file is best-effort */
    }
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  child.on("error", (err: any) => {
    state.status = "error";
    state.error = err.message;
    state.child = null;
    pushLog(serverId, `[Playit] Agent failed to start: ${err.message}\n`);
  });

  child.on("exit", (code, signal) => {
    state.child = null;
    state.startedAt = null;
    // A clean stop request already set the status; only flag real crashes.
    if (state.status !== "stopped") {
      state.status = code === 0 ? "stopped" : "error";
      if (code !== 0 && code !== null) {
        state.error = `The Playit agent exited with code ${code}${signal ? ` (${signal})` : ""}.`;
      }
      pushLog(serverId, `[Playit] Agent exited${code !== null ? ` with code ${code}` : ""}.\n`);
    }
  });

  // Give the agent a moment; if it survives, it is genuinely running.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  if (state.child && !state.child.killed) {
    attachedLog(serverId);
  } else if (state.status !== "error") {
    state.status = "error";
    state.error = state.error || "The Playit agent stopped immediately after starting.";
  }

  return snapshot(serverId);
};

export const stopTunnel = async (serverId: string): Promise<PlayitState> => {
  const state = stateFor(serverId);
  const child = state.child;
  state.status = "stopped";
  state.startedAt = null;
  state.claimDeadline = null;
  if (child && !child.killed) {
    pushLog(serverId, "[Playit] Stopping the agent ...\n");
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (!child.killed && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  state.child = null;
  return snapshot(serverId);
};

/** Stops then starts the agent, so a stale connection is genuinely recycled. */
export const restartTunnel = async (serverId: string): Promise<PlayitState> => {
  await stopTunnel(serverId);
  return startTunnel(serverId);
};

/**
 * Wipes the agent identity so the next start issues a fresh claim URL.
 * Useful when the tunnel was claimed by the wrong playit.gg account.
 */
export const resetTunnel = async (serverId: string): Promise<PlayitState> => {
  await stopTunnel(serverId);
  const state = stateFor(serverId);
  await fs.remove(secretPath(serverId)).catch(() => {});
  state.claimUrl = null;
  state.address = null;
  state.logs = [];
  state.error = null;
  pushLog(serverId, "[Playit] Secret removed — the next start will issue a new claim link.\n");
  return snapshot(serverId);
};

/** Re-attaches to agents that outlived a panel restart. */
export const recoverTunnels = async () => {
  for (const [serverId, state] of agents.entries()) {
    if (state.child && state.child.exitCode === null) continue;
    state.child = null;
    if (state.status === "running" || state.status === "starting") {
      state.status = "stopped";
      state.startedAt = null;
    }
    void serverId;
  }
};

export const snapshot = (serverId: string): PlayitState => {
  const state = stateFor(serverId);
  const alive = Boolean(state.child && state.child.exitCode === null && !state.child.killed);
  if (!alive && (state.status === "running" || state.status === "starting")) {
    state.status = "stopped";
  }
  return {
    status: state.status,
    claimUrl: state.claimUrl,
    logs: state.logs.slice(-120),
    pid: alive ? state.child!.pid ?? null : null,
    startedAt: state.startedAt,
    error: state.error,
    claimExpiresIn: state.claimDeadline
      ? Math.max(0, Math.ceil((state.claimDeadline - Date.now()) / 1000))
      : undefined,
    address: state.address,
  };
};

/** Removes the agent binary, secret and logs for a server that no longer exists. */
export const purgeTunnel = async (serverId: string) => {
  await stopTunnel(serverId).catch(() => {});
  agents.delete(serverId);
  await fs.remove(agentDir(serverId)).catch(() => {});
};

/** True when the agent binary is already on disk (no download needed). */
export const agentInstalled = async (serverId: string) => fs.pathExists(binaryPath(serverId));

export const isTunnelRunning = (serverId: string) => {
  const state = agents.get(serverId);
  return Boolean(state?.child && state.child.exitCode === null && !state.child.killed);
};

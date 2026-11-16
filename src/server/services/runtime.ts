import fs from "fs-extra";
import path from "path";
import { ChildProcess, spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import {
  DATA_DIR,
  SERVERS_DIR,
  readJSON,
  writeJSON,
  serverDir,
  nowISO,
} from "./db";

export { serverDir };
import { emitLog, emitStatus } from "../events";
import { downloadServerJar, javaVersionFor } from "./software";
import { isProcessAlive, processCpuPercent, processUptimeSeconds, readProcRssMb, readProcTicks, dirSizeMb } from "./proc";

export interface ServerRecord {
  id: string;
  name: string;
  owner: string;
  ownerName?: string;
  description?: string;
  software: string;
  version: string;
  runtime: "local" | "agent";
  nodeId: string;
  ip: string;
  port: number;
  cpu: number; // cores (0 = unlimited)
  ram: number; // MB
  disk: number; // MB
  status: "installing" | "online" | "offline" | "starting" | "stopping" | "suspended" | "error";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  lastBackupAt?: string | null;
  pid?: number | null;
  javaVersion?: string;
  startupCommand?: string | null;
  autoRestart?: boolean;
  notes?: string;
  planLabel?: string;
  reattached?: boolean;
}

interface ManagedProcess {
  child: ChildProcess;
  startedAt: number;
  stopping: boolean;
  exitCode: number | null;
  detachedFromPanel?: boolean;
}

const procs = new Map<string, ManagedProcess>();
const LOG_LIMIT_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const listServers = () => readJSON<ServerRecord[]>("servers.json", []);
export const saveServers = (list: ServerRecord[]) => writeJSON("servers.json", list);

export const findServer = async (id: string) => {
  const servers = await listServers();
  return servers.find((s) => s.id === id) || null;
};

export const updateServer = async (id: string, patch: Partial<ServerRecord>) => {
  const servers = await listServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  servers[idx] = { ...servers[idx], ...patch, updatedAt: nowISO() };
  await saveServers(servers);
  return servers[idx];
};

export const safeJoin = (root: string, relative: string) => {
  const clean = String(relative || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(root, clean);
  const normalizedRoot = path.resolve(root);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Invalid path: outside of server directory");
  }
  return target;
};

const LOGS_DIR = path.join(DATA_DIR, "logs");

const consoleLogPath = (id: string) => path.join(LOGS_DIR, `${id}.log`);

const appendConsoleLog = async (id: string, text: string) => {
  try {
    const file = consoleLogPath(id);
    await fs.ensureDir(path.dirname(file));
    await fs.appendFile(file, text);
    const stat = await fs.stat(file);
    if (stat.size > LOG_LIMIT_BYTES) {
      const content = await fs.readFile(file, "utf8");
      await fs.writeFile(file, content.slice(-Math.floor(LOG_LIMIT_BYTES / 2)));
    }
  } catch {
    /* ignore log write errors */
  }
};

const writeLog = async (id: string, message: string) => {
  const line = message.startsWith("[Panel]") ? `${message}\n` : message;
  await appendConsoleLog(id, line);
  emitLog(id, line);
};

const serverEnv = (server: ServerRecord) => ({
  ...process.env,
  SERVER_ID: server.id,
  SERVER_NAME: server.name,
  SERVER_PORT: String(server.port),
  PORT: String(server.port),
  MEMORY_MB: String(server.ram),
  ZK_PANEL: "1",
});

// ---------------------------------------------------------------------------
// Java resolution
// ---------------------------------------------------------------------------

const javaCandidates = (major: string) => {
  const list = [
    process.env.JAVA_BIN || "",
    "/usr/lib/jvm/java-21-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-17-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-11-openjdk-amd64/bin/java",
    "/usr/lib/jvm/java-8-openjdk-amd64/bin/java",
    "/usr/lib/jvm/default-java/bin/java",
    "/usr/bin/java",
    "/usr/local/bin/java",
  ];
  if (major) {
    list.unshift(
      `/usr/lib/jvm/java-${major}-openjdk-amd64/bin/java`,
      `/usr/lib/jvm/java-${major}-openjdk-arm64/bin/java`,
      `/usr/lib/jvm/temurin-${major}-jdk-amd64/bin/java`,
      `/usr/lib/jvm/temurin-${major}-jdk/bin/java`,
      `/opt/java/openjdk-${major}/bin/java`,
      `/opt/java/java-${major}/bin/java`
    );
  }
  return list.filter(Boolean);
};

export const resolveJava = async (major: string): Promise<string | null> => {
  for (const candidate of javaCandidates(major)) {
    if (candidate === "java") continue;
    if (await fs.pathExists(candidate)) return candidate;
  }
  return null;
};

export const javaAvailable = async () => {
  const resolved = await resolveJava("21");
  return Boolean(resolved);
};

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

const DEFAULT_PROPERTIES = (server: ServerRecord) => ({
  "server-port": server.port,
  "query.port": server.port,
  "motd": `\\u00A76${server.name}\\u00A7r \\u00A78| ZK-MC3-PANEL`,
  "max-players": 20,
  "online-mode": true,
  "difficulty": "normal",
  "gamemode": "survival",
  "pvp": true,
  "level-name": "world",
  "view-distance": 10,
  "spawn-protection": 16,
  "enable-command-block": true,
  "enable-rcon": false,
  "white-list": false,
});

export const writeServerProperties = async (server: ServerRecord, overrides: Record<string, any> = {}) => {
  const dir = serverDir(server.id);
  await fs.ensureDir(dir);
  const propsPath = path.join(dir, "server.properties");
  const existing: Record<string, string> = {};
  if (await fs.pathExists(propsPath)) {
    const raw = await fs.readFile(propsPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      existing[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
    }
  }
  const merged: Record<string, any> = { ...DEFAULT_PROPERTIES(server), ...existing, ...overrides };
  const body = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  await fs.writeFile(propsPath, `# Written by ZK-MC3-PANEL\n${body}\n`);
  return merged;
};

export const provisionServerFiles = async (server: ServerRecord, onLog?: (m: string) => void) => {
  const dir = serverDir(server.id);
  await fs.ensureDir(dir);
  const log = onLog || (() => {});
  const software = (server.software || "PAPER").toUpperCase();

  if (software === "NODEJS") {
    if (!(await fs.pathExists(path.join(dir, "package.json")))) {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify(
          {
            name: server.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "app",
            version: "1.0.0",
            main: "index.js",
            scripts: { start: "node index.js" },
          },
          null,
          2
        )
      );
    }
    if (!(await fs.pathExists(path.join(dir, "index.js")))) {
      await fs.writeFile(
        path.join(dir, "index.js"),
        `// Node.js application hosted on ZK-MC3-PANEL
const http = require("http");
const port = process.env.PORT || ${server.port};
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "online", panel: "ZK-MC3-PANEL", time: new Date().toISOString() }));
});
server.listen(port, "0.0.0.0", () => console.log("Listening on port " + port));
`
      );
    }
    return;
  }

  if (software === "PYTHON") {
    if (!(await fs.pathExists(path.join(dir, "main.py")))) {
      await fs.writeFile(
        path.join(dir, "main.py"),
        `# Python application hosted on ZK-MC3-PANEL
import os, sys
from http.server import HTTPServer, BaseHTTPRequestHandler

port = int(os.environ.get("PORT", ${server.port}))

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"online","panel":"ZK-MC3-PANEL"}')

print(f"Listening on port {port}", flush=True)
HTTPServer(("0.0.0.0", port), Handler).serve_forever()
`
      );
    }
    if (!(await fs.pathExists(path.join(dir, "requirements.txt")))) {
      await fs.writeFile(path.join(dir, "requirements.txt"), "# Add dependencies here\n");
    }
    return;
  }

  await fs.writeFile(path.join(dir, "eula.txt"), "eula=true\n");
  await writeServerProperties(server);

  if (software === "VELOCITY") {
    const velocityPath = path.join(dir, "velocity.toml");
    if (!(await fs.pathExists(velocityPath))) {
      await fs.writeFile(
        velocityPath,
        `bind = "0.0.0.0:${server.port}"\nmotd = "<#ff7a18>${server.name}"\nshow-max-players = 500\nonline-mode = true\n`
      );
    }
  }

  if (software === "BUNGEECORD" || software === "WATERFALL") {
    const configPath = path.join(dir, "config.yml");
    if (!(await fs.pathExists(configPath))) {
      await fs.writeFile(
        configPath,
        `listeners:\n- query_port: ${server.port}\n  motd: '${server.name}'\n  max_players: 500\n  host: 0.0.0.0:${server.port}\n`
      );
    }
  }

  const jarPath = path.join(dir, "server.jar");
  let needsJar = !(await fs.pathExists(jarPath));
  if (!needsJar) {
    const stat = await fs.stat(jarPath);
    needsJar = stat.size < 100 * 1024;
  }
  if (needsJar) {
    log(`[Panel] Installing ${software} ${server.version} ...`);
    await downloadServerJar(software, server.version, jarPath, log);
  }
};

/** Provisions a server and mirrors progress/errors into the live console log. */
export const provisionServerWithLogs = async (server: ServerRecord) => {
  try {
    await provisionServerFiles(server, (msg) => void writeLog(server.id, msg));
    await updateServer(server.id, { status: "offline" });
    await writeLog(server.id, "[Panel] Installation finished. The server is ready to start.");
    emitStatus(server.id, "offline");
    return true;
  } catch (err: any) {
    await writeLog(server.id, `[Panel] Installation failed: ${err.message}`);
    await updateServer(server.id, { status: "error" });
    emitStatus(server.id, "error");
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const buildStartArgs = async (server: ServerRecord) => {
  const software = (server.software || "PAPER").toUpperCase();
  if (software === "NODEJS") return { cmd: "node", args: ["index.js"] };
  if (software === "PYTHON") return { cmd: "python3", args: ["-u", "main.py"] };

  const javaMajor = server.javaVersion || javaVersionFor(software, server.version);
  const java = await resolveJava(javaMajor);
  if (!java) {
    throw new Error(
      `Java ${javaMajor || "21"} was not found on this node. Run "bash install.sh" to install a JDK, or set JAVA_BIN to a valid java binary.`
    );
  }
  const ram = Math.max(512, Number(server.ram) || 1024);
  const flags = [
    `-Xms${ram}M`,
    `-Xmx${ram}M`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
    "-Dusing.aikars.flags=https://mcflags.emc.gs",
    "-Daikars.new.flags=true",
    "-Dfile.encoding=UTF-8",
    "-Dterminal.jline=false",
    "-Dterminal.ansi=true",
  ];
  return { cmd: java, args: [...flags, "-jar", "server.jar", "nogui"] };
};

export const startServer = async (serverId: string, triggeredBy = "panel") => {
  const server = await findServer(serverId);
  if (!server) throw new Error("Server not found");
  if (server.status === "suspended") throw new Error("This server is suspended");
  if (procs.has(serverId)) throw new Error("Server is already running");

  // External (recovered) process check
  if (server.pid && isProcessAlive(server.pid)) {
    throw new Error("A process for this server is already running");
  }

  await updateServer(serverId, { status: "starting" });
  emitStatus(serverId, "starting");

  const dir = serverDir(serverId);
  await fs.ensureDir(dir);

  try {
    if (!(await fs.pathExists(path.join(dir, "server.jar"))) && !["NODEJS", "PYTHON"].includes(server.software.toUpperCase())) {
      await writeLog(serverId, `[Panel] Server jar missing — starting installation...`);
      await provisionServerFiles(server, (msg) => void writeLog(serverId, msg));
    }
    if (server.software.toUpperCase() !== "NODEJS" && server.software.toUpperCase() !== "PYTHON") {
      await fs.writeFile(path.join(dir, "eula.txt"), "eula=true\n");
    }

    const { cmd, args } = await buildStartArgs(server);
    await writeLog(serverId, `[Panel] Launching ${server.software} ${server.version} with ${server.ram}MB RAM (triggered by ${triggeredBy})`);

    const child = spawn(cmd, args, {
      cwd: dir,
      env: serverEnv(server),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const decoder = new StringDecoder("utf8");
    const handleChunk = (buf: Buffer) => {
      const text = decoder.write(buf);
      if (!text) return;
      void appendConsoleLog(serverId, text);
      emitLog(serverId, text);
    };
    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);

    const managed: ManagedProcess = { child, startedAt: Date.now(), stopping: false, exitCode: null };
    procs.set(serverId, managed);

    child.on("error", async (err) => {
      await writeLog(serverId, `[Panel] Failed to start process: ${err.message}`);
      procs.delete(serverId);
      await updateServer(serverId, { status: "error", pid: null, startedAt: null });
      emitStatus(serverId, "error");
    });

    child.on("exit", async (code, signal) => {
      managed.exitCode = code;
      const wasStopping = managed.stopping;
      procs.delete(serverId);
      const current = await findServer(serverId);
      if (!current) return;
      const autoRestart = current.autoRestart && !wasStopping;
      await writeLog(
        serverId,
        `[Panel] Process exited with code ${code}${signal ? ` (signal ${signal})` : ""}.${autoRestart ? " Auto-restarting..." : ""}`
      );
      await updateServer(serverId, {
        status: wasStopping ? "offline" : autoRestart ? "starting" : "offline",
        pid: null,
        startedAt: null,
      });
      emitStatus(serverId, wasStopping ? "offline" : "offline");
      if (autoRestart) {
        setTimeout(() => {
          startServer(serverId, "auto-restart").catch((err) => {
            void writeLog(serverId, `[Panel] Auto-restart failed: ${err.message}`);
          });
        }, 4000);
      }
    });

    // Give the JVM a moment to fail fast (bad jar, missing java, port in use)
    await new Promise((resolve) => setTimeout(resolve, 900));
    const alive = procs.has(serverId) && isProcessAlive(child.pid || 0);
    if (!alive) {
      const exitInfo = managed.exitCode;
      procs.delete(serverId);
      await updateServer(serverId, { status: "error", pid: null, startedAt: null });
      emitStatus(serverId, "error");
      throw new Error(
        `Server process exited immediately${exitInfo !== null ? ` (code ${exitInfo})` : ""}. Check the console log for details.`
      );
    }

    await updateServer(serverId, {
      status: "online",
      pid: child.pid || null,
      startedAt: new Date(managed.startedAt).toISOString(),
      reattached: false,
    });
    emitStatus(serverId, "online");
    await writeLog(serverId, `[Panel] Server is online (PID ${child.pid}).`);
    return true;
  } catch (err: any) {
    await writeLog(serverId, `[Panel] Startup failed: ${err.message}`);
    await updateServer(serverId, { status: "error", pid: null, startedAt: null });
    emitStatus(serverId, "error");
    throw err;
  }
};

export const sendCommandToServer = async (serverId: string, command: string) => {
  const managed = procs.get(serverId);
  if (!managed || !managed.child.stdin || !managed.child.stdin.writable) {
    throw new Error("Server is not accepting console input. Start the server first.");
  }
  await writeLog(serverId, `> ${command}`);
  managed.child.stdin.write(`${command}\n`);
  return true;
};

const stopManaged = async (serverId: string, signal: NodeJS.Signals, gracefulMs: number) => {
  const server = await findServer(serverId);
  // Only Minecraft-family jars understand "stop" on stdin. Anything else (custom
  // runtimes such as Node/Python apps) gets a short grace period so the panel UI
  // does not appear to hang for the full timeout.
  const MINECRAFT_SOFTWARE = ["PAPER", "PURPUR", "SPIGOT", "BUKKIT", "VANILLA", "FABRIC", "FORGE", "NEOFORGE", "QUILT", "VELOCITY", "BUNGEECORD", "WATERFALL"];
  const isMinecraftJar = MINECRAFT_SOFTWARE.includes((server?.software || "").toUpperCase());
  const effectiveGrace = isMinecraftJar ? gracefulMs : Math.min(gracefulMs, 6000);
  const managed = procs.get(serverId);
  if (!managed) {
    // Recovered / external process
    if (server?.pid && isProcessAlive(server.pid)) {
      try {
        process.kill(server.pid, signal);
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
      if (!isProcessAlive(server.pid)) {
        await updateServer(serverId, { status: "offline", pid: null, startedAt: null });
        emitStatus(serverId, "offline");
        return true;
      }
    }
    throw new Error("Server is not running");
  }

  managed.stopping = true;
  await updateServer(serverId, { status: "stopping" });
  emitStatus(serverId, "stopping");

  if (signal === "SIGTERM") {
    const software = (server?.software || "").toUpperCase();
    const command = ["VELOCITY", "BUNGEECORD", "WATERFALL"].includes(software) ? "end" : "stop";
    try {
      managed.child.stdin?.write(`${command}\n`);
      await writeLog(serverId, `[Panel] Sending "${command}" to server console...`);
    } catch {
      /* ignore */
    }
  }

  const started = Date.now();
  while (procs.has(serverId) && Date.now() - started < effectiveGrace) {
    await new Promise((r) => setTimeout(r, 200));
  }

  if (procs.has(serverId)) {
    try {
      if (managed.child.pid) process.kill(-managed.child.pid, "SIGKILL");
    } catch {
      try {
        managed.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    await writeLog(serverId, `[Panel] Process forcefully terminated.`);
    await new Promise((r) => setTimeout(r, 400));
  }

  procs.delete(serverId);
  await updateServer(serverId, { status: "offline", pid: null, startedAt: null });
  emitStatus(serverId, "offline");
  return true;
};

export const stopServer = (serverId: string) => stopManaged(serverId, "SIGTERM", 25000);
export const killServer = (serverId: string) => stopManaged(serverId, "SIGKILL", 3000);

export const restartServer = async (serverId: string, triggeredBy = "panel") => {
  const managed = procs.get(serverId);
  if (managed) {
    await stopManaged(serverId, "SIGTERM", 20000);
  }
  await new Promise((r) => setTimeout(r, 600));
  return startServer(serverId, triggeredBy);
};

export const isServerRunning = (serverId: string) => procs.has(serverId);

export const getRuntimeState = async (serverId: string) => {
  const server = await findServer(serverId);
  const managed = procs.get(serverId);
  const pid = managed?.child.pid || server?.pid || 0;
  const alive = Boolean(pid && isProcessAlive(pid));
  return {
    running: managed ? true : alive,
    managed: Boolean(managed),
    pid: alive ? pid : null,
    startedAt: managed ? new Date(managed.startedAt).toISOString() : server?.startedAt || null,
    uptimeSeconds: alive ? (managed ? Math.floor((Date.now() - managed.startedAt) / 1000) : processUptimeSeconds(pid)) : 0,
    cpu: alive ? processCpuPercent(pid) : 0,
    ram: alive ? readProcRssMb(pid) : 0,
  };
};

export const readConsole = async (serverId: string, lines = 250) => {
  try {
    const raw = await fs.readFile(consoleLogPath(serverId), "utf8");
    return raw.split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
};

export const clearConsoleLog = async (serverId: string) => {
  await fs.ensureDir(LOGS_DIR);
  await fs.writeFile(consoleLogPath(serverId), "");
  emitStatus(serverId, "console-cleared");
};

export const diskUsageMb = async (serverId: string) => dirSizeMb(serverDir(serverId));

export const deleteServerCompletely = async (serverId: string) => {
  const managed = procs.get(serverId);
  if (managed) {
    await stopManaged(serverId, "SIGKILL", 3000);
  } else {
    const server = await findServer(serverId);
    if (server?.pid && isProcessAlive(server.pid)) {
      try {
        process.kill(server.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  procs.delete(serverId);
  await fs.remove(serverDir(serverId)).catch(() => {});
  await fs.remove(path.join(DATA_DIR, "backups", serverId)).catch(() => {});
};

/** Command used by the CLI installer / agent to discover live processes. */
export const recoverRunningProcesses = async () => {
  const servers = await listServers();
  let recovered = 0;
  for (const server of servers) {
    if (server.pid && !procs.has(server.id) && isProcessAlive(server.pid)) {
      await updateServer(server.id, { status: "online", reattached: true });
      recovered += 1;
    } else if (server.status === "online" || server.status === "starting" || server.status === "stopping") {
      await updateServer(server.id, { status: "offline", pid: null, startedAt: null });
    }
  }
  return recovered;
};

export { SERVERS_DIR };

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
import { emitLog, emitStatus, emitStats } from "../events";
import { downloadServerJar, javaVersionFor } from "./software";
import {
  isProcessAlive,
  processCpuPercent,
  processUptimeSeconds,
  readProcRssMb,
  readProcTicks,
  dirSizeMb,
  processTreeUsage,
  listeningPorts,
  findPortOwners,
  waitForPortFree,
} from "./proc";
import { networkRate, forgetNetworkSample } from "./netio";

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
  status: "installing" | "ready" | "online" | "offline" | "starting" | "stopping" | "suspended" | "error";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  lastBackupAt?: string | null;
  pid?: number | null;
  javaVersion?: string;
  startupCommand?: string | null;
  autoRestart?: boolean;
  /** No JDK on the node: the console runs a simulated Paper server. */
  simulated?: boolean;
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
  /** Emulated Paper console used when the host has no Java runtime. */
  simulated?: boolean;
  simulatedTimers?: NodeJS.Timeout[];
}


const procs = new Map<string, ManagedProcess>();

/**
 * Byte counters reported by emulated children over their IPC channel.
 * `ss` can only read counters from sockets that are still open, so the child
 * measures its own traffic — accurate even for short-lived HTTP requests.
 */
const simulatedNet = new Map<string, { rx: number; tx: number }>();
const previousNet = new Map<string, { rx: number; tx: number; at: number }>();
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

/** Mirrors important lifecycle events into the admin platform console. */
const panelEvent = (message: string) => {
  try {
    console.log(`[server] ${message}`);
  } catch {
    /* ignore */
  }
};

const writeLog = async (id: string, message: string) => {
  const line = message.startsWith("[Panel]") ? `${message}\n` : message;
  await appendConsoleLog(id, line);
  emitLog(id, line);
  if (line.startsWith("[Panel]") && /online|exit|exited|failed|Port/i.test(line)) {
    panelEvent(`${id}: ${line.trim().replace(/^\[Panel\]\s*/, "")}`);
  }
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

export const writeServerProperties = async (server: ServerRecord, overrides: Record<string, any> = {}) => {  const dir = serverDir(server.id);
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
    const java = await resolveJava(server.javaVersion || javaVersionFor(software, server.version));
    if (!java) {
      log(`[Panel] No JDK on this node — skipping the ${software} jar download.`);
      log("[Panel] The server will start with the emulated console until Java is installed.");
      return;
    }
    log(`[Panel] Installing ${software} ${server.version} ...`);
    await downloadServerJar(software, server.version, jarPath, log);
  }
};

/** Provisions a server and mirrors progress/errors into the live console log. */
export const provisionServerWithLogs = async (server: ServerRecord) => {
  try {
    await provisionServerFiles(server, (msg) => void writeLog(server.id, msg));
    await updateServer(server.id, { status: "ready" });
    await writeLog(server.id, "[Panel] Installation finished. The server is ready to start.");
    emitStatus(server.id, "ready");
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

const buildStartArgs = async (server: ServerRecord, allowSimulation = true) => {
  const software = (server.software || "PAPER").toUpperCase();
  if (software === "NODEJS") return { cmd: "node", args: ["index.js"] };
  if (software === "PYTHON") return { cmd: "python3", args: ["-u", "main.py"] };

  const javaMajor = server.javaVersion || javaVersionFor(software, server.version);
  const java = await resolveJava(javaMajor);
  if (!java) {
    if (allowSimulation) return null;
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

// ---------------------------------------------------------------------------
// Emulated Paper console (no JDK on the node)
// ---------------------------------------------------------------------------

const SIMULATED_SOFTWARE = ["PAPER", "PURPUR", "SPIGOT", "BUKKIT", "VANILLA", "FABRIC", "FORGE", "NEOFORGE", "QUILT", "VELOCITY", "BUNGEECORD", "WATERFALL"];
const SIMULATED_SUPPORTED = new Set(SIMULATED_SOFTWARE);

export const isSimulatable = (software: string) => SIMULATED_SUPPORTED.has((software || "").toUpperCase());

const timestamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const paperLine = (thread: string, level: string, message: string) =>
  `[${thread}/${level}]: ${message}`;

/** Emits an emulated server line with a fresh timestamp. */
const saySimulated = async (serverId: string, thread: string, level: string, message: string) => {
  await writeLog(serverId, `[${timestamp()}] ${paperLine(thread, level, message)}\n`);
};

const saySimulatedLines = async (serverId: string, lines: { thread: string; level: string; message: string }[]) => {
  for (const line of lines) await saySimulated(serverId, line.thread, line.level, line.message);
};

/**
 * Full Paper-style boot sequence used when the host has no Java runtime.
 * The console, lifecycle and command handling behave exactly like a real
 * server so the panel stays demonstrable on machines without a JDK.
 */
const simulatedBootLines = (server: ServerRecord) => {
  const ram = Math.max(512, Number(server.ram) || 1024);
  const cores = Math.max(1, Number(server.cpu) || 4);
  const lines: { thread: string; level: string; message: string }[] = [
    { thread: "main", level: "INFO", message: `Starting org.papermc.paperclip.Main, version ${server.version || "1.21.4"}` },
    { thread: "main", level: "INFO", message: "System Java Version: 21.0.4 (emulated runtime — no JDK detected on this node)" },
    { thread: "main", level: "WARN", message: `Running in emulated mode. Install a JDK on the node to execute ${server.software} for real.` },
    { thread: "main", level: "INFO", message: "Loading libraries, please wait..." },
    { thread: "Server thread", level: "INFO", message: `Starting minecraft server version ${server.version || "1.21.4"}` },
    { thread: "Server thread", level: "INFO", message: "Loading properties" },
    { thread: "Server thread", level: "INFO", message: "Default game type: SURVIVAL" },
    { thread: "Server thread", level: "INFO", message: "Generating keypair" },
    { thread: "Server thread", level: "INFO", message: `Starting Minecraft server on ${server.ip === "0.0.0.0" ? "*" : server.ip}:${server.port}` },
    { thread: "Server thread", level: "INFO", message: "Using epoll channel type" },
    { thread: "Server thread", level: "INFO", message: "Loading server plugin ExamplePlugin1 v1.0.1" },
    { thread: "Server thread", level: "INFO", message: "Loading server plugin ExamplePlugin2 v1.0.2" },
    { thread: "Server thread", level: "INFO", message: "Loading server plugin ExamplePlugin3 v1.0.3" },
    { thread: "Server thread", level: "INFO", message: 'Preparing level "world"' },
    { thread: "Server thread", level: "INFO", message: "Preparing start region for dimension minecraft:overworld" },
    { thread: "Server thread", level: "INFO", message: "Time elapsed: 812 ms" },
    { thread: "Server thread", level: "INFO", message: "Preparing start region for dimension minecraft:the_nether" },
    { thread: "Server thread", level: "INFO", message: "Time elapsed: 96 ms" },
    { thread: "Server thread", level: "INFO", message: "Preparing start region for dimension minecraft:the_end" },
    { thread: "Server thread", level: "INFO", message: "Time elapsed: 141 ms" },
    { thread: "Server thread", level: "INFO", message: "Running delayed init tasks" },
    { thread: "Server thread", level: "INFO", message: 'Done (8.421s)! For help, type "help"' },
    { thread: "Server thread", level: "INFO", message: `Allocated heap ${ram} MB · ${cores} core(s) · difficulty normal · view distance 10` },
  ];
  return lines;
};

type SimLine = { thread: string; level: string; message: string };
const info = (message: string): SimLine => ({ thread: "Server thread", level: "INFO", message });
const warn = (message: string): SimLine => ({ thread: "Server thread", level: "WARN", message });

const simulatedCommandOutput = (server: ServerRecord, raw: string): SimLine[] => {
  const input = raw.trim();
  const [name, ...rest] = input.split(/\s+/);
  const command = (name || "").toLowerCase();
  const arg = rest.join(" ");
  switch (command) {
    case "help":
      return [
        info("Simulated command set: help, say, list, tps, mspt, seed, time, weather, gamemode, difficulty, whitelist, op, deop, kick, ban, pardon, plugins, save-all, stop"),
      ];
    case "say":
      return [info(`[Server] ${arg || "Hello!"}`)];
    case "list":
      return [info("There are 0 of a max of 20 players online:")];
    case "tps":
      return [info("TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0")];
    case "mspt":
      return [info("Server tick times (avg/min/max): 3.42/1.08/11.90 ms")];
    case "seed":
      return [info(`Seed: [${-Math.abs(hashSeed(server.name))}, ${hashSeed(server.name)}]`)];
    case "time":
      return [info(`The time is ${arg || "1000"}`)];
    case "weather":
      return [info(`Set the weather to ${arg || "clear"}`)];
    case "gamemode":
      return [info(`Game mode updated: ${arg || "survival"}`)];
    case "difficulty":
      return [info(`The difficulty is now ${arg || "normal"}`)];
    case "op":
    case "deop":
    case "whitelist":
    case "ban":
    case "pardon":
    case "kick":
      return [info(`${command} ${arg}`.trim() + " — noted (emulated)")];
    case "plugins":
    case "pl":
      return [info("Plugins (3): ExamplePlugin1, ExamplePlugin2, ExamplePlugin3")];
    case "save-all":
      return [info("Saving the game (this may take a moment!)"), info("Saved the game")];
    case "stop":
    case "end":
      return [];
    default:
      return [warn(`Unknown or incomplete command "${input}". Try "help".`)];
  }
};

const hashSeed = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
};

const simulatedCommands = {
  stop: (server: ServerRecord) => ["stop", "end"],
};

const simulatedRuntimeScript = `
const http = require("http");
const port = Number(process.env.SERVER_PORT || 25565);
const name = process.env.SERVER_NAME || "server";
const start = Date.now();
let rx = 0;
let tx = 0;
const report = () => { try { process.send && process.send({ type: "net", rx, tx }); } catch (e) {} };
setInterval(report, 2000).unref();
const sockState = new WeakMap();
const server = http.createServer((req, res) => {
  const sock = req.socket;
  let state = sockState.get(sock);
  if (!state) { state = { read: 0, written: 0 }; sockState.set(sock, state); }
  // socket.bytesRead/bytesWritten include headers, so the dashboards show the
  // same numbers a real Minecraft socket would move.
  res.on("finish", () => {
    const readDelta = sock.bytesRead - state.read;
    const writeDelta = sock.bytesWritten - state.written;
    state.read = sock.bytesRead;
    state.written = sock.bytesWritten;
    if (readDelta > 0) rx += readDelta;
    if (writeDelta > 0) tx += writeDelta;
    report();
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ panel: "ZK-MC3-PANEL", server: name, emulated: true, uptime: Math.floor((Date.now() - start) / 1000) }));
});
server.listen(port, "0.0.0.0", () => {
  console.log("[emulated] listening on " + port);
  setInterval(() => console.log("[emulated] heartbeat " + Math.floor((Date.now() - start) / 1000) + "s"), 30000);
});
process.on("SIGTERM", () => { console.log("[emulated] shutting down"); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 400); });
process.on("message", (m) => { if (m === "stop") process.emit("SIGTERM"); });
`;

const startSimulatedServer = async (server: ServerRecord) => {
  const serverId = server.id;
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=" + Math.max(128, Math.min(Number(server.ram) || 512, 1024)), "-e", simulatedRuntimeScript],
    {
      cwd: serverDir(serverId),
      detached: true,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...serverEnv(server), SERVER_PORT: String(server.port) },
    }
  );

  const managed: ManagedProcess = {
    child,
    startedAt: Date.now(),
    stopping: false,
    exitCode: null,
    simulated: true,
    simulatedTimers: [],
  };
  procs.set(serverId, managed);
  forgetNetworkSample(serverId);
  simulatedNet.set(serverId, { rx: 0, tx: 0 });
  previousNet.delete(serverId);

  const decoder = new StringDecoder("utf8");
  const relay = (buf: Buffer) => {
    const text = decoder.write(buf);
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) void writeLog(serverId, `[${timestamp()}] [Server thread/INFO]: ${line.replace(/^\[emulated\]\s*/, "")}\n`);
    }
  };
  child.stdout?.on("data", relay);
  child.stderr?.on("data", relay);
  child.on("message", (message: any) => {
    if (message && message.type === "net") {
      simulatedNet.set(serverId, { rx: Number(message.rx) || 0, tx: Number(message.tx) || 0 });
    }
  });

  child.on("exit", async (code) => {
    if (!procs.has(serverId)) return;
    procs.delete(serverId);
    await writeLog(serverId, `[Panel] Emulated process exited with code ${code}.`);
    await updateServer(serverId, { status: "offline", pid: null, startedAt: null });
    emitStatus(serverId, "offline");
  });

  // Boot sequence, staggered so the console streams like a real startup.
  const boot = simulatedBootLines(server);
  boot.forEach((line, index) => {
    const timer = setTimeout(() => void saySimulated(serverId, line.thread, line.level, line.message), 110 + index * 130);
    managed.simulatedTimers?.push(timer);
  });

  // Ambient chatter, like a live server ticking along.
  const chatter = setInterval(() => {
    if (managed.stopping) return;
    const roll = Math.random();
    if (roll > 0.78) {
      void saySimulated(serverId, "Server thread", "INFO", "Player keepalive broadcast · TPS 20.0");
    } else if (roll > 0.7) {
      void saySimulated(serverId, "Craft Scheduler Thread", "INFO", 'Autosave: world written to disk (0.4s)');
    }
  }, 15000);
  managed.simulatedTimers?.push(chatter);

  const finishBoot = setTimeout(() => emitStatus(serverId, "online"), 1200);
  managed.simulatedTimers?.push(finishBoot);

  return managed;
};

const stopSimulatedServer = async (managed_: ManagedProcess) => {
  for (const timer of managed_.simulatedTimers || []) clearTimeout(timer as any);
  try {
    managed_.child.stdin?.end();
    managed_.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
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

  // Clean up sockets left behind by a crashed/previous run so the new process
  // does not die with "Address already in use".
  const stale = await findPortOwners(server.port);
  const ownPid = server.pid || 0;
  if (stale.length) {
    const orphans = stale.filter((o) => o.pid !== ownPid && o.pid !== process.pid);
    if (orphans.length) {
      await writeLog(
        serverId,
        `[Panel] Port ${server.port} is held by PID ${orphans.map((o) => o.pid).join(", ")} (${orphans
          .map((o) => o.command)
          .join(", ")}). Releasing it before start...`
      );
      for (const owner of orphans) {
        try {
          process.kill(owner.pid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
      const freed = await waitForPortFree(server.port, 4000);
      if (!freed) {
        throw new Error(
          `Port ${server.port} is still in use by another process. Stop it or change this server's port.`
        );
      }
    }
  }

  await updateServer(serverId, { status: "starting" });
  emitStatus(serverId, "starting");
  forgetNetworkSample(serverId);

  const dir = serverDir(serverId);
  await fs.ensureDir(dir);

  try {
    const software = (server.software || "PAPER").toUpperCase();
    const isApp = ["NODEJS", "PYTHON"].includes(software);
    if (!isApp) {
      const jarPath = path.join(dir, "server.jar");
      const hasJar = await fs.pathExists(jarPath);
      const hasJava = Boolean(await resolveJava(server.javaVersion || javaVersionFor(software, server.version)));
      // With no JDK the jar is useless, so skip the (network-bound) download and
      // fall through to the emulated console instead of failing the start.
      if (!hasJar && hasJava) {
        await writeLog(serverId, `[Panel] Server jar missing — starting installation...`);
        await provisionServerFiles(server, (msg) => void writeLog(serverId, msg));
      }
      await fs.writeFile(path.join(dir, "eula.txt"), "eula=true\n");
    }

    const startCommand = await buildStartArgs(server);
    if (!startCommand) {
      await writeLog(
        serverId,
        `[Panel] No Java runtime detected — starting the emulated ${server.software} console so the panel stays usable.`
      );
      await writeLog(
        serverId,
        `[Panel] Install a JDK on this node (sudo bash install.sh) and restart to run the real jar.`
      );
      const simulated = await startSimulatedServer(server);
      await updateServer(serverId, {
        status: "online",
        pid: simulated.child.pid || null,
        startedAt: new Date(simulated.startedAt).toISOString(),
        reattached: false,
        simulated: true,
      });
      await writeLog(serverId, `[Panel] Emulated server is online (PID ${simulated.child.pid}) — ${server.ram}MB RAM, ${server.cpu} core(s).`);
      emitStatus(serverId, "online");
      return true;
    }

    const { cmd, args } = startCommand;
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
      simulated: false,
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
  if (!managed) {
    throw new Error("Server is not accepting console input. Start the server first.");
  }
  const clean = String(command || "").replace(/[\r\n]/g, " ").slice(0, 2000);
  if (!clean.trim()) throw new Error("Command cannot be empty");
  await writeLog(serverId, `> ${clean}\n`);

  if (managed.simulated) {
    const server = await findServer(serverId);
    if (!server) throw new Error("Server not found");
    const lower = clean.trim().toLowerCase();
    if (simulatedCommands.stop(server).includes(lower)) {
      setTimeout(() => {
        void stopManaged(serverId, "SIGTERM", 5000);
      }, 250);
      return true;
    }
    for (const line of simulatedCommandOutput(server, clean)) {
      await saySimulated(serverId, line.thread, line.level, line.message);
    }
    return true;
  }

  if (!managed.child.stdin || !managed.child.stdin.writable) {
    throw new Error("Server is not accepting console input. Start the server first.");
  }
  managed.child.stdin.write(`${clean}\n`);
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

  if (managed.simulated) {
    const software = (server?.software || "PAPER").toUpperCase();
    const isProxy = ["VELOCITY", "BUNGEECORD", "WATERFALL"].includes(software);
    await writeLog(serverId, `[Panel] Sending "${isProxy ? "end" : "stop"}" to server console...`);
    await saySimulated(serverId, "Server thread", "INFO", "Stopping the server");
    await new Promise((r) => setTimeout(r, 450));
    await saySimulated(serverId, "Server thread", "INFO", "Saving worlds");
    await new Promise((r) => setTimeout(r, 400));
    await saySimulated(serverId, "Server thread", "INFO", "Saving chunks for level 'ServerLevel[world]'/minecraft:overworld");
    await stopSimulatedServer(managed);
    procs.delete(serverId);
    simulatedNet.delete(serverId);
    previousNet.delete(serverId);
    await saySimulated(serverId, "Server thread", "INFO", "ThreadedAnvilChunkStorage (world): All dimensions are saved");
    await updateServer(serverId, { status: "offline", pid: null, startedAt: null });
    emitStatus(serverId, "offline");
    return true;
  }

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
  const running = Boolean(managed) || alive;

  let cpu = 0;
  let ram = 0;
  let net = { netIn: 0, netOut: 0, netInRate: 0, netOutRate: 0 };
  if (alive && pid) {
    // Measure the whole tree: a Paper server forks, and `java -jar` children
    // hold both the heap and the sockets.
    const usage = managed && !managed.simulated ? processTreeUsage(pid) : { cpu: processCpuPercent(pid), ram: readProcRssMb(pid) };
    cpu = Math.round(usage.cpu * 10) / 10;
    ram = Math.round(usage.ram * 10) / 10;
    const reported = simulatedNet.get(serverId);
    if (managed?.simulated && reported) {
      const prev = previousNet.get(serverId);
      const now = Date.now();
      let netInRate = 0;
      let netOutRate = 0;
      if (prev && now > prev.at) {
        const seconds = (now - prev.at) / 1000;
        netInRate = Math.max(0, Math.round((reported.rx - prev.rx) / seconds));
        netOutRate = Math.max(0, Math.round((reported.tx - prev.tx) / seconds));
      }
      previousNet.set(serverId, { ...reported, at: now });
      net = { netIn: reported.rx, netOut: reported.tx, netInRate, netOutRate };
    } else {
      net = await networkRate(serverId, pid, server?.port);
    }
  } else {
    forgetNetworkSample(serverId);
  }

  return {
    running,
    managed: Boolean(managed),
    simulated: Boolean(managed?.simulated || server?.simulated),
    pid: alive ? pid : null,
    startedAt: managed ? new Date(managed.startedAt).toISOString() : server?.startedAt || null,
    uptimeSeconds: alive ? (managed ? Math.floor((Date.now() - managed.startedAt) / 1000) : processUptimeSeconds(pid)) : 0,
    cpu,
    ram,
    netIn: net.netIn,
    netOut: net.netOut,
    netInRate: net.netInRate,
    netOutRate: net.netOutRate,
    listeningPorts: alive && pid ? listeningPorts(pid) : [],
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
    const alive = Boolean(server.pid && isProcessAlive(server.pid));
    if (alive && server.simulated) {
      // Emulated consoles are helpers owned by the panel: an orphan would hold
      // the game port with no way to stream its console, so retire it.
      try {
        if (server.pid) process.kill(-server.pid, "SIGKILL");
      } catch {
        try {
          if (server.pid) process.kill(server.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      await updateServer(server.id, { status: "offline", pid: null, startedAt: null, simulated: false });
    } else if (alive && !procs.has(server.id)) {
      // A real jar survived a panel restart: it keeps running, but its stdio is
      // gone, so it is reported online and can still be stopped or killed.
      await updateServer(server.id, { status: "online", reattached: true });
      recovered += 1;
    } else if (server.status === "online" || server.status === "starting" || server.status === "stopping") {
      await updateServer(server.id, { status: "offline", pid: null, startedAt: null });
    }
  }
  return recovered;
};

export { SERVERS_DIR };

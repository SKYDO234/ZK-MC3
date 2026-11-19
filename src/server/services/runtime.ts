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
import {
  downloadServerJar,
  javaMajorFor,
  javaVersionFor,
  minecraftJavaArgs,
  jarMirrors,
  forgeInstallerUrl,
  isRuntime,
  isProxy,
  SOFTWARE_LABEL,
} from "./software";
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
  // Last resort: consult PATH, so a JDK installed outside /usr/lib/jvm works.
  try {
    const { execFileSync } = await import("child_process");
    const found = execFileSync("sh", ["-c", "command -v java"], { encoding: "utf8" }).trim();
    if (found) return found;
  } catch {
    /* no java on PATH */
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

  // A jar without a JVM is useless, so check the runtime *before* spending
  // network time on a download. This is the message an operator needs.
  const javaMajor = server.javaVersion || javaVersionFor(software, server.version);
  const java = await resolveJava(javaMajor);
  if (!java) {
    throw new Error(
      `Java ${javaMajor || "21"} is required for ${SOFTWARE_LABEL(software)} ${server.version} but was not found on this node. ` +
        `Install it with "sudo bash install.sh" (or apt install openjdk-${javaMajor || 21}-jre-headless), or set JAVA_BIN.`
    );
  }

  if (software === "FORGE" || software === "NEOFORGE") {
    log(`[Panel] Installing ${SOFTWARE_LABEL(software)} ${server.version} ...`);
    await installForgeServer(server, java, log);
    return;
  }

  const jarPath = path.join(dir, "server.jar");
  let needsJar = !(await fs.pathExists(jarPath));
  if (!needsJar) {
    const stat = await fs.stat(jarPath);
    // Paperclip and the Vanilla jar are several MB; anything tiny is a broken
    // download (an HTML error page saved under a .jar name, for example).
    needsJar = stat.size < 100 * 1024;
  }
  if (needsJar) {
    log(`[Panel] Installing ${SOFTWARE_LABEL(software)} ${server.version} ...`);
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

const buildStartArgs = async (server: ServerRecord) => {
  const software = (server.software || "PAPER").toUpperCase();
  if (software === "NODEJS") {
    const entry = await firstExistingEntry(serverDir(server.id), ["index.js", "app.js", "server.js", "main.js", "bot.js"]);
    return { cmd: "node", args: [entry || "index.js"] };
  }
  if (software === "PYTHON") {
    const entry = await firstExistingEntry(serverDir(server.id), ["main.py", "app.py", "bot.py", "index.py", "server.py"]);
    return { cmd: "python3", args: ["-u", entry || "main.py"] };
  }

  const dir = serverDir(server.id);
  const javaMajor = server.javaVersion || javaVersionFor(software, server.version);
  const java = await resolveJava(javaMajor);
  if (!java) {
    throw new Error(
      `Java ${javaMajor || "21"} was not found on this node. Run "bash install.sh" to install a JDK, or set JAVA_BIN to a valid java binary.`
    );
  }

  // Forge/NeoForge installers leave a launch script (run.sh) or an args file.
  if (software === "FORGE" || software === "NEOFORGE") {
    const script = await firstExistingEntry(dir, ["run.sh"]);
    if (script) {
      return { cmd: "sh", args: ["run.sh", "nogui"] };
    }
    const argsFile = (await fs.readdir(dir).catch(() => [] as string[])).find((e) => e.endsWith("_args.txt"));
    if (argsFile) {
      const raw = await fs.readFile(path.join(dir, argsFile), "utf8");
      const extra = raw.split(/\s+/).filter(Boolean);
      return { cmd: java, args: [...minecraftJavaArgs(server.ram), ...extra, "nogui"] };
    }
    throw new Error(`The ${SOFTWARE_LABEL(software)} launch files are missing — reinstall the server.`);
  }

  const custom = String(server.startupCommand || "").trim();
  if (custom) {
    const [bin, ...args] = custom.split(/\s+/);
    return { cmd: bin, args };
  }

  if (isProxy(software)) {
    return {
      cmd: java,
      args: [
        `-Xms${Math.max(512, Number(server.ram) || 1024)}M`,
        `-Xmx${Math.max(512, Number(server.ram) || 1024)}M`,
        "-Dterminal.jline=false",
        "-Dterminal.ansi=true",
        "-jar",
        "server.jar",
      ],
    };
  }

  return {
    cmd: java,
    args: [...minecraftJavaArgs(server.ram), "-jar", "server.jar", "nogui", "--nojline"],
  };
};

const firstExistingEntry = async (dir: string, candidates: string[]) => {
  for (const name of candidates) {
    if (await fs.pathExists(path.join(dir, name))) return name;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Forge / NeoForge installer support
// ---------------------------------------------------------------------------

/**
 * Forge and NeoForge publish an *installer* jar. Running it with
 * `--installServer` produces the libraries plus the launch script, exactly like
 * the JTG panel's local runtime does. We keep the installed launcher path on the
 * server record so start/restart can reuse it.
 */
const installForgeServer = async (server: ServerRecord, java: string, onLog: (m: string) => void) => {
  const dir = serverDir(server.id);
  const software = server.software.toUpperCase();
  const installerUrl = await forgeInstallerUrl(software, server.version);
  if (!installerUrl) {
    throw new Error(`No ${SOFTWARE_LABEL(software)} installer is published for Minecraft ${server.version}.`);
  }

  // Some Forge builds need the vanilla jar alongside the installer.
  const vanilla = path.join(dir, "server.jar");
  if (!(await fs.pathExists(vanilla))) {
    onLog("[Panel] Downloading the vanilla Minecraft jar required by the installer...");
    await downloadServerJar("VANILLA", server.version, vanilla, onLog);
  }

  const installer = path.join(dir, "installer.jar");
  onLog(`[Panel] Downloading ${SOFTWARE_LABEL(software)} ${server.version} installer...`);
  await downloadServerJar(software, server.version, installer, onLog);

  onLog("[Panel] Running the installer (this can take a few minutes)...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(java, ["-jar", "installer.jar", "--installServer"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error("The Forge installer timed out after 10 minutes."));
    }, 10 * 60 * 1000);
    const relay = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) onLog(`[installer] ${line.trim()}`);
      }
    };
    child.stdout?.on("data", relay);
    child.stderr?.on("data", relay);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`The installer exited with code ${code}.`));
    });
  });

  // Find the generated launch script / jar.
  const entries = await fs.readdir(dir);
  const script = entries.find((e) => e === "run.sh" || e === "unix_args.txt" || e.endsWith("_args.txt"));
  const builtJar = entries.find((e) => /^(forge|neoforge|server).*\.jar$/i.test(e) && !e.includes("installer"));
  await fs.remove(installer).catch(() => {});
  if (!script && !builtJar) {
    throw new Error("The installer finished but produced no launch script or server jar.");
  }
  return { script: script || null, jar: builtJar || null };
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
    const runtimeServer = isRuntime(software);
    if (!runtimeServer) {
      // The jar (and, for Forge/NeoForge, the libraries + launch script) is
      // required before we can start anything. Provision on demand.
      const jarPath = path.join(dir, "server.jar");
      const hasJar = await fs.pathExists(jarPath);
      const forgeReady = await fs.pathExists(path.join(dir, "run.sh"));
      const needsInstall = software === "FORGE" || software === "NEOFORGE" ? !forgeReady && !hasJar : !hasJar;
      if (needsInstall) {
        await writeLog(serverId, `[Panel] ${SOFTWARE_LABEL(software)} ${server.version} is not installed yet — starting installation...`);
        await provisionServerFiles(server, (msg) => void writeLog(serverId, msg));
      }
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
  if (!managed) {
    throw new Error("Server is not accepting console input. Start the server first.");
  }
  const clean = String(command || "").replace(/[\r\n]/g, " ").slice(0, 2000);
  if (!clean.trim()) throw new Error("Command cannot be empty");
  await writeLog(serverId, `> ${clean}\n`);

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
    const usage = processTreeUsage(pid);
    cpu = Math.round(usage.cpu * 10) / 10;
    ram = Math.round(usage.ram * 10) / 10;
    net = await networkRate(serverId, pid, server?.port);
  } else {
    forgetNetworkSample(serverId);
  }

  return {
    running,
    managed: Boolean(managed),
    attached: Boolean(managed),
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
    if (alive && !procs.has(server.id)) {
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

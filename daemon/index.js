#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ZK-MC3-PANEL · Node Daemon (zkdaemon)
 *  A product of ZK-STUDIO · CEO MD Ziyan Hossain
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A standalone daemon that turns a bare VPS, home machine or Codespace into a
 * game-server node. Like Wings (Pterodactyl) and skyportd (Skyport), it is a
 * separate program that talks to the panel over an authenticated channel.
 *
 * Unlike those, the connection is **outbound**: the daemon dials the panel over
 * Socket.IO and holds the socket open. That means:
 *
 *   · no inbound port, no firewall rule, no public IP required
 *   · works behind NAT, Docker, CGNAT and Codespaces unchanged
 *   · one command to install, and the node appears in the panel by itself
 *
 * The panel sends everything down that socket — start, stop, command, stats
 * requests — and the daemon answers. Nothing else is exposed.
 *
 * Run it:
 *   node .                    (reads config.json)
 *   node . --token zkn_xxx    (panel URL is then asked for once)
 *
 * Copyright (c) ZK-STUDIO. MIT licensed.
 */
"use strict";

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");

const VERSION = require("./package.json").version;
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, "config.json");

/* ─────────────────────────────────────────────────────────────── console */

const paint = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
const green = paint("38;5;48");
const cyan = paint("38;5;51");
const amber = paint("38;5;214");
const orange = paint("38;5;208");
const red = paint("38;5;196");
const white = paint("1;37");
const gray = paint("38;5;242");
const dim = paint("2");

const say = (...parts) => console.log(parts.join(" "));
const ok = (m) => say("  " + green("✔") + " " + m);
const info = (m) => say("  " + cyan("›") + " " + m);
const warn = (m) => say("  " + amber("!") + " " + m);
const fail = (m) => say("  " + red("✖") + " " + m);
const section = (m) => say("\n" + orange("▸") + " " + white(m));

/* ─────────────────────────────────────────────────────── connectivity probe */

/**
 * Explains *why* the panel cannot be reached.
 *
 * socket.io collapses every transport failure into `connect_error("websocket
 * error")`: DNS, refused ports, a private Codespace port, a TLS failure and a
 * wrong path all look identical. An operator staring at that line cannot act on
 * it, so before connecting we ask the panel for /api/health over plain HTTP and
 * report exactly what came back.
 *
 * Returns null when the panel looks fine, or a human-readable diagnosis.
 */
const probePanel = (url) =>
  new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve(`"${url}" is not a valid URL. Use the full address, e.g. https://panel.example.com`);
    }
    if (!/^https?:$/.test(target.protocol)) {
      return resolve(`The panel URL must start with http:// or https:// (got "${target.protocol}")`);
    }

    const client = target.protocol === "https:" ? https : http;
    const path = `${target.pathname.replace(/\/+$/, "")}/api/health`;
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = client.get(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path,
        timeout: 10000,
        headers: { "User-Agent": `zkdaemon/${VERSION}` },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
          if (body.length > 8192) res.destroy();
        });
        const finish = () => {
          if (res.statusCode === 200 && /"panel"/.test(body)) return done(null);

          // GitHub Codespaces answers a private port with its sign-in page, or
          // refuses the connection outright — both mean "make the port public".
          const codespace = /\.app\.github\.dev$/i.test(target.hostname);
          if (codespace && (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 302)) {
            return done(
              "The panel's Codespace port is not public (HTTP " +
                res.statusCode +
                ").\n" +
                "   Fix: in the Codespace open the Ports tab → find port " +
                (target.port || "31120") +
                " → right-click → Port Visibility → Public.\n" +
                "   Then restart this daemon."
            );
          }
          if (codespace && /sign in|github|login/i.test(body) && res.statusCode !== 200) {
            return done(
              "The panel's Codespace port is private — GitHub served its sign-in page instead of the panel.\n" +
                "   Fix: Ports tab → port " +
                (target.port || "31120") +
                " → right-click → Port Visibility → Public."
            );
          }
          if (res.statusCode === 404) {
            return done(
              `The panel answered 404 for ${path}.\n` +
                "   That address is reachable but is not a ZK-MC3 panel — check the URL and the port."
            );
          }
          return done(`The panel answered HTTP ${res.statusCode} for ${path}.`);
        };
        res.on("end", finish);
        res.on("close", finish);
      }
    );

    req.on("timeout", () =>
      done(
        `The connection to ${target.hostname}:${target.port || (target.protocol === "https:" ? 443 : 80)} timed out.\n` +
          "   The host is not reachable from this machine — check the address, and that the panel is running."
      )
    );

    req.on("error", (err) => {
      const code = err.code || "";
      if (code === "ECONNREFUSED") {
        return done(
          `Nothing is listening on ${target.hostname}:${target.port || 443}.\n` +
            "   The panel is not running on that port, or the port is not forwarded."
        );
      }
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return done(`"${target.hostname}" does not resolve. Check the URL for a typo.`);
      }
      if (code === "ECONNRESET") {
        const codespace = /\.app\.github\.dev$/i.test(target.hostname);
        return done(
          "The connection was reset before the panel answered (ECONNRESET).\n" +
            (codespace
              ? "   On a Codespace this almost always means the port is PRIVATE.\n" +
                "   Fix: Ports tab → port " +
                (target.port || "31120") +
                " → right-click → Port Visibility → Public."
              : "   The host is reachable but dropped the connection — check it is the panel's port, and that no proxy blocks it.")
        );
      }
      if (/CERT|SSL|TLS/.test(code) || /certificate/i.test(err.message)) {
        return done(`TLS failed for ${target.hostname} (${code}). The panel's certificate is not trusted.`);
      }
      return done(`Could not reach ${target.hostname}: ${code || err.message}`);
    });
  });

/* ──────────────────────────────────────────────────────────────── config */

/**
 * config.json is plain JSON. Comments and trailing commas are stripped before
 * parsing so an operator editing it by hand cannot break the daemon with a note.
 */
const stripComments = (text) =>
  text
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");

const readConfig = () => {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(stripComments(raw));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    fail(`config.json could not be read: ${err.message}`);
    return {};
  }
};

const saveConfig = (patch) => {
  const current = readConfig();
  const next = { ...current, ...patch };
  // 0600: the token is this node's credential.
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
};

/* ────────────────────────────────────────────────────────── host telemetry */

const run = (command, timeout = 4000) =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], { timeout });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", () => {});
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out));
  });

const diskStats = async () => {
  const out = await run("df -kP / | tail -1");
  const parts = out.trim().split(/\s+/);
  const totalMb = (Number(parts[1]) || 0) / 1024;
  const freeMb = (Number(parts[3]) || 0) / 1024;
  const usedMb = Math.max(0, totalMb - freeMb);
  return {
    totalMb: Math.round(totalMb),
    usedMb: Math.round(usedMb),
    percent: totalMb ? Math.round((usedMb / totalMb) * 100) : 0,
  };
};

const javaInfo = async () => {
  const bin = (await run("command -v java")).trim();
  if (!bin) return { installed: false, version: null, path: null };
  const version = (await run("java -version 2>&1 | head -1")).trim();
  return { installed: true, path: bin, version };
};

/** Live host snapshot, sent on every stats beat. */
const snapshot = async () => {
  const [disk, java] = await Promise.all([diskStats(), javaInfo()]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const load = os.loadavg();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptime: os.uptime(),
    cpuModel: (os.cpus()[0] || {}).model || "Unknown CPU",
    cpuCores: os.cpus().length,
    load1: load[0],
    loadPercent: Math.min(100, Math.round((load[0] / Math.max(1, os.cpus().length)) * 100)),
    memoryTotalMb: Math.round(totalMem / 1024 / 1024),
    memoryUsedMb: Math.round((totalMem - freeMem) / 1024 / 1024),
    memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    diskTotalMb: disk.totalMb,
    diskUsedMb: disk.usedMb,
    diskPercent: disk.percent,
    java,
  };
};

/* ──────────────────────────────────────────────────── server supervision */

/**
 * Every server the panel starts lives here. The daemon owns the process: it
 * spawns it, streams its console back over the socket, and reports the exit
 * code. This mirrors the panel's own local runtime, so a server behaves the
 * same whether it runs on the panel host or on a node.
 */
const processes = new Map(); // serverId -> { child, startedAt, stopping, exitCode }

const serverRoot = path.join(ROOT, "data", "servers");
const serverDir = (id) => path.join(serverRoot, id);

const ensureDir = async (dir) => {
  await fs.ensureDir(dir);
  return dir;
};

const safeJoin = (root, relative) => {
  const target = path.resolve(root, relative || ".");
  if (!target.startsWith(path.resolve(root))) throw new Error("Path escapes the server directory");
  return target;
};

const emit = (socket, event, payload) => {
  try {
    if (socket.connected) socket.emit(event, payload);
  } catch {
    /* a dropped socket must never crash a server */
  }
};

/**
 * Answers a panel request.
 *
 * Callbacks from Socket.IO are fragile across reconnects and cannot carry an
 * error without inventing a second channel, so every request is a one-way
 * event with an `id` and the daemon answers on `reply` with `{id, ok, data}`.
 * The panel correlates by id and applies a timeout, which means a daemon that
 * hangs mid-command surfaces as an error instead of a spinner forever.
 */
const replyTo = (socket) => (id, ok, data) => {
  if (!id) return;
  emit(socket, "reply", ok ? { id, ok: true, data } : { id, ok: false, error: String(data) });
};

/**
 * Start a server.
 *
 * `job` describes what to run. Two shapes are accepted:
 *   { command, args, env, cwd }   — ready to spawn (the panel builds this)
 *   { software, version, port, ram } — the daemon resolves the command itself
 *
 * Keeping the panel authoritative is deliberate: it already knows how to build
 * JVM flags, Forge launch scripts and runtime entry points, and duplicating
 * that logic here would drift.
 */
const startServer = async (socket, job) => {
  const { serverId } = job;
  if (processes.has(serverId)) throw new Error("Server is already running on this node");

  const dir = await ensureDir(serverDir(serverId));
  const cwd = job.cwd ? safeJoin(dir, job.cwd) : dir;
  await ensureDir(cwd);

  if (!job.command) throw new Error("The panel did not send a launch command");

  emit(socket, "server:log", {
    serverId,
    text: `\x1b[38;5;242m[Daemon] Launching on ${os.hostname()} · ${job.command} ${(job.args || []).join(" ")}\x1b[0m\n`,
  });

  const child = spawn(job.command, job.args || [], {
    cwd,
    env: { ...process.env, ...(job.env || {}), PORT: String(job.port || process.env.PORT || 25565) },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const decoder = new StringDecoder("utf8");
  const pump = (buf) => {
    const text = decoder.write(buf);
    if (!text) return;
    emit(socket, "server:log", { serverId, text });
    void appendLog(serverId, text);
  };
  child.stdout.on("data", pump);
  child.stderr.on("data", pump);

  const managed = { child, startedAt: Date.now(), stopping: false, exitCode: null };
  processes.set(serverId, managed);

  child.on("error", (err) => {
    processes.delete(serverId);
    emit(socket, "server:log", { serverId, text: `\x1b[38;5;196m[Daemon] ${err.message}\x1b[0m\n` });
    emit(socket, "server:status", { serverId, status: "error", pid: null });
    emit(socket, "server:exit", { serverId, code: null, error: err.message });
  });

  child.on("exit", (code, signal) => {
    managed.exitCode = code;
    processes.delete(serverId);
    emit(socket, "server:log", {
      serverId,
      text: `\x1b[38;5;242m[Daemon] Process exited with code ${code}${signal ? ` (${signal})` : ""}\x1b[0m\n`,
    });
    emit(socket, "server:status", { serverId, status: "offline", pid: null });
    emit(socket, "server:exit", { serverId, code, signal, stopping: managed.stopping });
  });

  // Fail fast: a JVM that dies on a bad jar does so within a second.
  await new Promise((r) => setTimeout(r, 900));
  if (!processes.has(serverId)) {
    throw new Error(`Server process exited immediately${managed.exitCode !== null ? ` (code ${managed.exitCode})` : ""}`);
  }

  emit(socket, "server:status", { serverId, status: "online", pid: child.pid });
  return { pid: child.pid };
};

const stopServer = async (socket, { serverId, signal = "SIGTERM", graceMs = 25000 }) => {
  const managed = processes.get(serverId);
  if (!managed) return { stopped: false, reason: "not running" };
  managed.stopping = true;
  const { child } = managed;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
  if (signal === "SIGKILL") return { stopped: true };
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { stopped: true };
};

const sendCommand = (serverId, command) => {
  const managed = processes.get(serverId);
  if (!managed || !managed.child.stdin.writable) throw new Error("Server is not accepting console input");
  const clean = String(command || "").replace(/[\r\n]/g, " ").trim().slice(0, 2000);
  if (!clean) throw new Error("Command cannot be empty");
  managed.child.stdin.write(clean + "\n");
  return { sent: true };
};

/** Appends to a per-server log file, same layout the panel uses locally. */
const appendLog = async (serverId, text) => {
  try {
    const dir = serverDir(serverId);
    await fs.ensureDir(dir);
    await fs.appendFile(path.join(dir, "console.log"), text);
  } catch {
    /* logging must never break a running server */
  }
};

/** Files the panel may read/write on this node. */
const fsOps = {
  list: async ({ serverId, dir = "" }) => {
    const base = safeJoin(serverDir(serverId), dir);
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
      size: e.isFile() ? fs.statSync(path.join(base, e.name)).size : 0,
    }));
  },
  read: async ({ serverId, file }) => {
    const target = safeJoin(serverDir(serverId), file);
    const stat = await fs.stat(target);
    if (stat.size > 1024 * 1024) throw new Error("File is larger than 1 MB — use the panel's file manager");
    return { content: await fs.readFile(target, "utf8") };
  },
  write: async ({ serverId, file, content }) => {
    const target = safeJoin(serverDir(serverId), file);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content ?? "", "utf8");
    return { written: true };
  },
  delete: async ({ serverId, file }) => {
    const target = safeJoin(serverDir(serverId), file);
    await fs.remove(target);
    return { deleted: true };
  },
  mkdir: async ({ serverId, path: rel }) => {
    await fs.ensureDir(safeJoin(serverDir(serverId), rel));
    return { created: true };
  },

  /**
   * Chunked upload: the panel streams a jar in 512 KB frames and the daemon
   * appends them in order. Socket.IO frames are capped near 1 MB, and a 60 MB
   * Paper jar is normal, so a single frame would fail silently mid-transfer.
   */
  writeChunk: async ({ serverId, file, chunk, index, total }) => {
    const target = safeJoin(serverDir(serverId), file);
    await fs.ensureDir(path.dirname(target));
    const buffer = Buffer.from(chunk, "base64");
    if (index === 0) {
      await fs.writeFile(target, buffer);
    } else {
      await fs.appendFile(target, buffer);
    }
    const done = index + 1 >= total;
    if (done) {
      const size = (await fs.stat(target)).size;
      emit(socketRef, "server:log", {
        serverId,
        text: `\x1b[38;5;242m[Daemon] Received ${file} (${(size / 1024 / 1024).toFixed(1)} MB)\x1b[0m\n`,
      });
    }
    return { written: true, done, index };
  },

  /**
   * Installs software that has to be configured on the node itself.
   *
   * Forge and NeoForge ship a Java installer that downloads libraries relative
   * to the machine doing the installing, so it cannot be prepared on the panel
   * and copied over. This runs it here.
   */
  provision: async ({ serverId, software, version, javaMajor }) => {
    const dir = serverDir(serverId);
    await fs.ensureDir(dir);
    const java = javaMajor ? `java${javaMajor}` : "java";
    const bin = (await run(`command -v ${java} || command -v java`)).trim();
    if (!bin) throw new Error(`Java ${javaMajor || ""} is not installed on this node`);

    const installerName = `${software.toLowerCase()}-installer.jar`;
    const label = software === "NEOFORGE" ? "neoforge" : "forge";
    // The official maven layout is stable; the panel already knows the version.
    const url =
      software === "NEOFORGE"
        ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
        : `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;

    emit(socketRef, "server:log", {
      serverId,
      text: `\x1b[38;5;242m[Daemon] Downloading the ${label} installer for ${version}\x1b[0m\n`,
    });
    const downloaded = await run(`curl -fsSL -o "${installerName}" "${url}"`, 180000);
    if (!(await fs.pathExists(path.join(dir, installerName)))) {
      throw new Error(`Could not download the ${label} installer${downloaded ? `: ${downloaded}` : ""}`);
    }

    emit(socketRef, "server:log", {
      serverId,
      text: `\x1b[38;5;242m[Daemon] Running the ${label} installer — this takes a few minutes\x1b[0m\n`,
    });
    const output = await new Promise((resolve) => {
      const child = spawn(bin, ["-jar", installerName, "--installServer"], { cwd: dir });
      let log = "";
      child.stdout.on("data", (b) => {
        log += b;
        emit(socketRef, "server:log", { serverId, text: String(b) });
      });
      child.stderr.on("data", (b) => {
        log += b;
        emit(socketRef, "server:log", { serverId, text: String(b) });
      });
      child.on("close", (code) => resolve({ code, log }));
      child.on("error", (err) => resolve({ code: -1, log: err.message }));
    });

    if (output.code !== 0) throw new Error(`The ${label} installer failed (exit ${output.code})`);
    await fs.remove(path.join(dir, installerName)).catch(() => {});
    emit(socketRef, "server:log", {
      serverId,
      text: `\x1b[38;5;242m[Daemon] ${label} installed.\x1b[0m\n`,
    });
    return { installed: true };
  },
};

/* ────────────────────────────────────────────────────── identity + address */

const fetchText = (url, timeout = 2500) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const req = http.get(url, { timeout }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
          if (body.length > 4096) {
            res.destroy();
            done(body);
          }
        });
        res.on("end", () => done(body.trim()));
      });
      req.on("timeout", () => {
        req.destroy();
        done("");
      });
      req.on("error", () => done(""));
    } catch {
      done("");
    }
  });

const localAddress = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return { address: net.address, iface: name };
    }
  }
  return { address: "", iface: "" };
};

/**
 * The address a player would connect to. The panel needs this for the server
 * card, and it is the one value that is always wrong when guessed by hand.
 */
const detectAddress = async () => {
  const local = localAddress();
  const codespace = process.env.CODESPACE_NAME || "";
  const forwarded = codespace
    ? `${codespace}-25565.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev"}`
    : "";
  let publicIp = process.env.ZK_PUBLIC_HOST || "";
  if (!publicIp) {
    for (const svc of ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]) {
      const candidate = (await fetchText(svc)).split(/\s/)[0];
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
        publicIp = candidate;
        break;
      }
    }
  }
  return {
    host: publicIp || forwarded || local.address || "127.0.0.1",
    localIp: local.address,
    iface: local.iface,
    codespace: Boolean(codespace),
    forwardUrl: forwarded ? `https://${forwarded}` : null,
    source: process.env.ZK_PUBLIC_HOST
      ? "ZK_PUBLIC_HOST"
      : publicIp
      ? "public-ip"
      : forwarded
      ? "codespace"
      : "lan",
  };
};

/* ──────────────────────────────────────────────────────────── socket loop */

let socketRef = null;
let reconnectDelay = 2000;
let shuttingDown = false;
/** Timers to clear on shutdown (stats beat, reachability poller). */
const intervals = new Set();

const connect = async (config) => {
  const { io } = require("socket.io-client");
  const url = String(config.panelUrl || "").replace(/\/+$/, "");

  say("");
  say("  " + orange("⚡ ZK-MC3-PANEL") + " " + gray("·") + " " + white("node daemon"));
  say("  " + gray(`v${VERSION} · ${os.hostname()} · node ${process.version}`));
  section("Connecting");
  info(`Panel ${white(url)}`);

  // Fail with a diagnosis instead of socket.io's "websocket error".
  const problem = await probePanel(url);
  if (problem) {
    fail("Cannot reach the panel.");
    for (const line of problem.split("\n")) say("    " + line);
    say("");
    warn("The daemon stays up and retries every 15 s — fix the above and it will connect.");
    say("");
  }

  let lastError = "";
  const socket = io(`${url}/daemon`, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: reconnectDelay,
    reconnectionDelayMax: 15000,
    timeout: 12000,
    auth: { token: config.token, nodeName: config.nodeName || os.hostname(), daemonVersion: VERSION },
  });
  socketRef = socket;
  for (const timer of intervals) clearInterval(timer);
  intervals.clear();

  socket.on("connect", async () => {
    reconnectDelay = 2000;
    ok(`Connected over WebSocket — ${green("node is online")}`);
    const address = await detectAddress();
    const [system] = await Promise.all([snapshot()]);
    socket.emit("node:hello", { address, system, daemonVersion: VERSION, nodeName: config.nodeName || os.hostname() });
    say("  " + gray(`Address ${address.host} (${address.source}) · ${system.cpuCores} cores · ${system.memoryTotalMb} MB`));
    // Re-announce anything still running, so a panel restart re-attaches.
    for (const [serverId, managed] of processes) {
      socket.emit("server:status", { serverId, status: "online", pid: managed.child.pid });
    }
  });

  socket.on("connect_error", (err) => {
    // "websocket error" is all socket.io offers, so only the first occurrence
    // is printed; the preflight above explained the cause. Repeating it every
    // 15 seconds buried the one useful line.
    const reason = /unauthor|invalid|token/i.test(err.message)
      ? "the panel rejected this token — copy the install command again"
      : err.message || "connection failed";
    if (reason !== lastError) {
      fail(`Connection failed: ${reason}`);
      if (!/token/i.test(reason)) {
        info("Run the check again with:  node . --panel " + url + " --token <token>");
      }
      lastError = reason;
    } else {
      warn(`Retrying in ${Math.round(reconnectDelay / 1000)}s`);
    }
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  });

  socket.on("connect", () => {
    lastError = "";
  });

  socket.on("disconnect", (reason) => {
    if (shuttingDown) return;
    warn(`Disconnected (${reason}) — servers keep running, reconnecting…`);
  });

  /* ── commands from the panel ─────────────────────────────────────────── */

  const reply = replyTo(socket);
  /** Wraps a handler so any thrown error becomes a `reply` instead of a crash. */
  const handle = (event, fn) =>
    socket.on(event, async (payload = {}) => {
      const { id } = payload;
      try {
        const result = await fn(payload);
        reply(id, true, result);
      } catch (err) {
        reply(id, false, err.message || String(err));
      }
    });

  handle("node:ping", async () => ({ pong: true, at: Date.now(), host: os.hostname() }));
  handle("node:stats", async () => ({ system: await snapshot(), uptime: process.uptime() }));

  handle("server:start", async (job) => startServer(socket, job));
  handle("server:stop", async (payload) => stopServer(socket, payload));
  handle("server:command", async (payload) => sendCommand(payload.serverId, payload.command));

  handle("fs:op", async (payload) => {
    const handler = fsOps[payload.op];
    if (!handler) throw new Error(`Unknown file operation "${payload.op}"`);
    return handler(payload);
  });

  /* ── periodic stats beat ─────────────────────────────────────────────── */

  // While offline, re-run the diagnosis occasionally: the port may have been
  // made public, or the panel restarted, and the operator deserves to know
  // without restarting the daemon.
  let probeTick = 0;
  const healthCheck = setInterval(async () => {
    if (socket.connected) return;
    probeTick += 1;
    if (probeTick % 4 !== 0) return;
    const why = await probePanel(url);
    if (why) {
      say("");
      info("Still cannot reach the panel:");
      for (const line of why.split("\n")) say("    " + line);
      say("");
    } else {
      ok("The panel is reachable again — reconnecting…");
    }
  }, 15000);
  intervals.add(healthCheck);

  const beat = setInterval(async () => {
    if (!socket.connected) return;
    socket.emit("node:stats", {
      system: await snapshot(),
      uptime: process.uptime(),
      servers: [...processes.keys()].map((serverId) => ({
        serverId,
        pid: processes.get(serverId).child.pid,
      })),
    });
  }, 5000);
  intervals.add(beat);
};

/* ──────────────────────────────────────────────────────────────── startup */

const main = async () => {
  // `node . --token zkn_xxx [--panel https://…]` — the installer uses this.
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  let config = readConfig();
  const tokenArg = flag("--token") || process.env.ZK_TOKEN;
  const panelArg = flag("--panel") || process.env.ZK_PANEL_URL;

  if (tokenArg) {
    if (!panelArg) {
      fail("A token was given but no panel URL.");
      say("  " + gray("Usage: node . --token <token> --panel https://your-panel"));
      process.exit(1);
    }
    config = saveConfig({ panelUrl: panelArg, token: tokenArg, nodeName: flag("--name") || config.nodeName || "" });
    ok("Configuration written to config.json");
  }

  if (!config.panelUrl || !config.token) {
    say("");
    say("  " + orange("⚡ ZK-MC3-PANEL") + " " + gray("·") + " " + white("node daemon"));
    say("");
    fail("This daemon is not configured yet.");
    say("");
    say("  " + gray("Copy the install command from the panel:"));
    say("    " + white("Admin → Nodes → Add node → Generate install command"));
    say("");
    say("  " + gray("It runs:"));
    say("    " + dim("node . --token <token> --panel <panel-url>"));
    say("");
    process.exit(1);
  }

  await connect(config);
};

/* ────────────────────────────────────────────────────────────── lifecycle */

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  say("");
  warn(`${signal} — shutting down`);
  // Servers are left running: the panel decides what happens to them, and a
  // daemon restart must not take a live world down with it.
  if (processes.size) {
    info(`${processes.size} server(s) left running — the panel can re-attach`);
  }
  socketRef?.disconnect();
  setTimeout(() => process.exit(0), 300);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  fail(`Uncaught: ${err.message}`);
  say("  " + dim(err.stack?.split("\n")[1] || ""));
});
process.on("unhandledRejection", (err) => {
  fail(`Unhandled rejection: ${err?.message || err}`);
});

void main();

#!/usr/bin/env node
/**
 * ZK-MC3-PANEL Node Agent
 * -----------------------
 * A tiny zero-dependency HTTP agent that runs on a remote node and exposes
 * host health, allocation information and process status to the panel.
 *
 *   ZK_PANEL_TOKEN=secret PORT=31120 node agent/agent.js
 *
 * Endpoints
 *   GET  /health   -> { status, system, processes, panel }
 *   GET  /ping     -> { pong: true }
 *   GET  /config   -> sanitised agent configuration
 *
 * The agent never spawns servers itself — the panel keeps authoritative
 * control of the runtime. It only reports telemetry, which keeps the attack
 * surface minimal if a node is compromised.
 */
const http = require("http");
const os = require("os");
const fs = require("fs");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT || process.env.ZK_AGENT_PORT || 31120);
const TOKEN = process.env.ZK_PANEL_TOKEN || process.env.ZK_AGENT_TOKEN || "";
const HOST = process.env.ZK_AGENT_HOST || "0.0.0.0";
const PUBLIC_IP = process.env.ZK_AGENT_PUBLIC_IP || "";
/** An explicit hostname beats detection — use it for tunnels and custom domains. */
const PUBLIC_HOST = process.env.ZK_AGENT_PUBLIC_HOST || "";
/** The panel this agent belongs to; the installer always sets it. */
const PANEL_URL = (process.env.ZK_PANEL_URL || "").replace(/\/+$/, "");
const NODE_NAME = process.env.ZK_AGENT_NAME || os.hostname();
const STARTED_AT = Date.now();

const run = (command) =>
  new Promise((resolve) => {
    exec(command, { timeout: 4000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });

/**
 * The address the operator must type into the panel.
 *
 * This is the single most error-prone field in node setup: behind NAT or a
 * Codespaces/Cloudflare tunnel the machine's own interfaces advertise
 * 10.x / 127.0.0.1 / 172.17.x, all of which the panel cannot reach. So the
 * agent asks an external echo service what the world sees, and reports both
 * values plus which one is worth using.
 */
const https = require("https");

const fetchText = (url, timeoutMs = 2500) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const client = url.startsWith("https:") ? https : http;
      const req = client.get(url, { timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done("");
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
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

/** Local, non-loopback IPv4 — what a panel on the same LAN should use. */
const localAddress = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return { address: net.address, iface: name };
    }
  }
  return { address: "", iface: "" };
};

/** Public IPv4 as seen from the internet. Empty when the host is offline. */
const publicIp = async () => {
  if (PUBLIC_IP) return PUBLIC_IP;
  const sources = ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"];
  for (const source of sources) {
    const value = (await fetchText(source)).split(/\s/)[0];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;
  }
  return "";
};

/** Minimal JSON POST, used for the one-time check-in with the panel. */
const postJson = (url, payload, timeoutMs = 6000) =>
  new Promise((resolve) => {
    try {
      const target = new URL(url);
      const client = target.protocol === "https:" ? https : http;
      const body = JSON.stringify(payload);
      const req = client.request(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: target.pathname + target.search,
          method: "POST",
          timeout: timeoutMs,
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(data || "{}") });
            } catch {
              resolve({ status: res.statusCode, body: {} });
            }
          });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: 0, body: { error: "timeout" } });
      });
      req.on("error", (err) => resolve({ status: 0, body: { error: err.message } }));
      req.write(body);
      req.end();
    } catch (err) {
      resolve({ status: 0, body: { error: String(err) } });
    }
  });

/** Set when the host is a devcontainer/Codespace — the URL is the way in. */
const codespaceName = () => process.env.CODESPACE_NAME || "";
const forwardingDomain = () =>
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";

/**
 * Everything the panel needs to fill in its own form, so an operator never has
 * to guess an IP, and never has to explain why 127.0.0.1 did not work.
 */
const detectAddress = async () => {
  const local = localAddress();
  const forwardedHost = codespaceName() ? `${codespaceName()}-${PORT}.${forwardingDomain()}` : "";
  const external = publicIp ? await publicIp() : "";

  // Priority: explicit env override > tunnel/Codespace hostname > public IPv4 > LAN.
  const host = PUBLIC_HOST || forwardedHost || external || local.address || "127.0.0.1";
  const source = PUBLIC_HOST
    ? "ZK_AGENT_PUBLIC_HOST"
    : forwardedHost
    ? "codespace"
    : external
    ? "public-ip"
    : local.address
    ? `lan:${local.iface}`
    : "loopback";

  return {
    host,
    port: PORT,
    // Codespaces and 443-terminated tunnels are always TLS; a bare node is not.
    protocol:
      forwardedHost || PUBLIC_HOST.startsWith("https://") || String(PORT) === "443" ? "https" : "http",
    localIp: local.address,
    publicIp: external || null,
    codespace: Boolean(codespaceName()),
    portForwardUrl: forwardedHost ? `https://${forwardedHost}` : null,
    source,
    // Ready to paste into the panel's "IP / hostname" field.
    panelAddress: host,
  };
};

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
  const path = await run("command -v java");
  if (!path.trim()) return { installed: false, version: null };
  const version = await run("java -version 2>&1 | head -1");
  return { installed: true, path: path.trim(), version: version.replace(/"/g, "").trim() };
};

const minecraftProcesses = async () => {
  const out = await run("ps -eo pid,%cpu,rss,cmd --sort=-rss | grep -E 'java|server.jar|node index.js|python3 -u' | grep -v grep | head -20");
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        cpu: Number(match[2]),
        ramMb: Math.round(Number(match[3]) / 1024),
        command: match[4].slice(0, 160),
      };
    })
    .filter(Boolean);
};

const authorized = (req) => {
  if (!TOKEN) return true; // open agent (not recommended for public hosts)
  const header = req.headers.authorization || "";
  if (header === `Bearer ${TOKEN}`) return true;
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("token") === TOKEN;
};

// A `/ping` that never requires auth: the panel uses it to tell "agent is up,
// token is wrong" apart from "nothing is listening here".
const isPing = (req) => new URL(req.url || "/", "http://localhost").pathname === "/ping";

let addressCacheValue = null;
let addressCachedAt = 0;
const ADDRESS_TTL_MS = 60_000;
const addressCache = async () => {
  if (addressCacheValue && Date.now() - addressCachedAt < ADDRESS_TTL_MS) return addressCacheValue;
  addressCacheValue = await detectAddress();
  addressCachedAt = Date.now();
  return addressCacheValue;
};

const totalMem = os.totalmem();
const snapshot = async () => {
  const disk = await diskStats();
  const load = os.loadavg();
  const freeMem = os.freemem();
  return {
    hostname: os.hostname(),
    nodeName: NODE_NAME,
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptime: os.uptime(),
    cpuModel: os.cpus()[0]?.model || "Unknown",
    cpuCores: os.cpus().length,
    load1: load[0],
    loadPercent: Math.min(100, Math.round((load[0] / Math.max(1, os.cpus().length)) * 100)),
    memoryTotalMb: Math.round(totalMem / 1024 / 1024),
    memoryUsedMb: Math.round((totalMem - freeMem) / 1024 / 1024),
    memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    diskTotalMb: disk.totalMb,
    diskUsedMb: disk.usedMb,
    diskPercent: disk.percent,
    publicIp: PUBLIC_IP || null,
    agentUptime: Math.floor((Date.now() - STARTED_AT) / 1000),
  };
};

const server = http.createServer(async (req, res) => {
  const send = (status, payload) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
  };

  if (req.method === "OPTIONS") return send(204, {});
  const url = new URL(req.url || "/", "http://localhost");

  // Open endpoint so the panel can separate connectivity from authentication.
  // It also reports the host's real address, so the panel can correct a node
  // registered with the wrong IP without the operator running `ip addr`.
  if (isPing(req)) {
    return send(200, {
      pong: true,
      at: Date.now(),
      node: NODE_NAME,
      agentVersion: "1.0.0",
      tokenRequired: Boolean(TOKEN),
      publicAddress: await addressCache(),
    });
  }

  if (!authorized(req)) return send(401, { error: "Invalid agent token", hint: "Copy the install command from the panel again." });

  if (url.pathname === "/health") {
    const [system, java, processes] = await Promise.all([snapshot(), javaInfo(), minecraftProcesses()]);
    return send(200, {
      status: "healthy",
      panel: "ZK-MC3-PANEL",
      agentVersion: "1.0.0",
      system,
      java,
      processes,
      publicAddress: await addressCache(),
      at: new Date().toISOString(),
    });
  }

  if (url.pathname === "/config") {
    return send(200, {
      nodeName: NODE_NAME,
      host: HOST,
      port: PORT,
      publicIp: PUBLIC_IP || null,
      publicAddress: await addressCache(),
      tokenConfigured: Boolean(TOKEN),
      agentVersion: "1.0.0",
    });
  }

  if (url.pathname === "/" || url.pathname === "/status") {
    return send(200, {
      name: "ZK-MC3-PANEL Agent",
      studio: "ZK-STUDIO",
      version: "1.0.0",
      endpoints: ["/ping", "/health", "/config"],
      node: NODE_NAME,
    });
  }

  return send(404, { error: "Not found" });
});

/**
 * Announce this machine to the panel.
 *
 * The panel registered this node from a token alone, so it does not yet know
 * where the node lives. This call is what turns a reserved node into a live
 * one — it is retried, because a freshly booted box may come up before its
 * network does.
 */
const registerWithPanel = async (attempt = 1) => {
  if (!PANEL_URL || !TOKEN) return;
  const address = await addressCache();
  const result = await postJson(`${PANEL_URL}/api/nodes/self-register`, {
    token: TOKEN,
    address,
  });
  if (result.status === 200 && result.body?.ok) {
    console.log(`[ZK-MC3 Agent] Registered with the panel as "${result.body.nodeName}" (${result.body.address})`);
    return;
  }
  const reason = result.body?.error || `HTTP ${result.status}`;
  console.log(`[ZK-MC3 Agent] Check-in failed (${reason})${attempt < 8 ? " — retrying" : ""}`);
  // Back off, but keep trying: a panel that is briefly down should not cost
  // the operator a manual restart.
  if (attempt < 8) setTimeout(() => registerWithPanel(attempt + 1), Math.min(30_000, attempt * 3000));
};

server.listen(PORT, HOST, async () => {
  console.log(`[ZK-MC3 Agent] ${NODE_NAME} listening on ${HOST}:${PORT}`);
  console.log(`[ZK-MC3 Agent] Token auth: ${TOKEN ? "enabled" : "DISABLED — set ZK_PANEL_TOKEN"}`);
  const address = await addressCache();
  console.log(`[ZK-MC3 Agent] Reachable at: ${address.protocol}://${address.host}:${address.port}`);
  if (address.codespace) console.log(`[ZK-MC3 Agent] Codespace detected — port must be public (Ports tab).`);
  if (PANEL_URL) {
    console.log(`[ZK-MC3 Agent] Reporting to ${PANEL_URL}`);
    registerWithPanel();
  } else {
    console.log("[ZK-MC3 Agent] No ZK_PANEL_URL set — the panel will need this node's address manually.");
  }
});

// Re-announce after a network blip; cheap and keeps the panel's view honest.
setInterval(() => registerWithPanel().catch(() => {}), 10 * 60_000).unref?.();

const shutdown = () => {
  console.log("[ZK-MC3 Agent] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Touch fs so linters do not complain about the unused import on some setups
void fs;

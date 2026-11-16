#!/usr/bin/env node
/**
 * ZK-MC3-PANEL Node Agent
 * -----------------------
 * A tiny zero-dependency HTTP agent that runs on a remote node and exposes
 * host health, allocation information and process status to the panel.
 *
 *   ZK_PANEL_TOKEN=secret PORT=6767 node agent/agent.js
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

const PORT = Number(process.env.PORT || process.env.ZK_AGENT_PORT || 6767);
const TOKEN = process.env.ZK_PANEL_TOKEN || process.env.ZK_AGENT_TOKEN || "";
const HOST = process.env.ZK_AGENT_HOST || "0.0.0.0";
const PUBLIC_IP = process.env.ZK_AGENT_PUBLIC_IP || "";
const NODE_NAME = process.env.ZK_AGENT_NAME || os.hostname();
const STARTED_AT = Date.now();

const run = (command) =>
  new Promise((resolve) => {
    exec(command, { timeout: 4000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
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
  if (!authorized(req)) return send(401, { error: "Invalid agent token" });

  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/ping") return send(200, { pong: true, at: Date.now() });

  if (url.pathname === "/health") {
    const [system, java, processes] = await Promise.all([snapshot(), javaInfo(), minecraftProcesses()]);
    return send(200, {
      status: "healthy",
      panel: "ZK-MC3-PANEL",
      agentVersion: "1.0.0",
      system,
      java,
      processes,
      at: new Date().toISOString(),
    });
  }

  if (url.pathname === "/config") {
    return send(200, {
      nodeName: NODE_NAME,
      host: HOST,
      port: PORT,
      publicIp: PUBLIC_IP || null,
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

server.listen(PORT, HOST, () => {
  console.log(`[ZK-MC3 Agent] ${NODE_NAME} listening on ${HOST}:${PORT}`);
  console.log(`[ZK-MC3 Agent] Token auth: ${TOKEN ? "enabled" : "DISABLED — set ZK_PANEL_TOKEN"}`);
});

const shutdown = () => {
  console.log("[ZK-MC3 Agent] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Touch fs so linters do not complain about the unused import on some setups
void fs;

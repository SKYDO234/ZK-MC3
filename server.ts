import "dotenv/config";
import "./src/server/services/panellog-install";
import { Server as SocketServer } from "socket.io";
import { attachDaemonGateway } from "./src/server/services/daemon";
import express from "express";
import path from "path";
import cors from "cors";
import http from "http";
import fs from "fs-extra";
import jwt from "jsonwebtoken";

import { ensureDataDirs } from "./src/server/services/db";
import { JWT_SECRET } from "./src/server/middleware/auth";
import { publicSettings, getSettings } from "./src/server/services/settings";
import { panelEvents } from "./src/server/events";
import { recoverRunningProcesses, findServer } from "./src/server/services/runtime";
import { isAdminRole, listUsers, createUserRecord } from "./src/server/services/users";
import { listServers, saveServers } from "./src/server/services/runtime";
const app = express();
const httpServer = http.createServer(app);

const io: import("socket.io").Server = new SocketServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/socket.io",
});
app.set("io", io);

// ETags on API responses buy nothing and cost correctness: Express answers a
// matching If-None-Match with 304 and an empty body, which the browser's fetch()
// cannot turn back into data. The settings endpoints are the worst case — a
// saved theme or panel name silently reverts to the built-in defaults because
// the refresh parse fails. Static assets under /assets keep Last-Modified, so
// they still revalidate cheaply.
app.set("etag", false);

const PORT = Number(process.env.PORT) || 31120;
const isDev = process.env.NODE_ENV === "development";

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ---------------------------------------------------------------------------
// Socket.IO — authenticated console streaming + live stats
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    const decoded = jwt.verify(String(token), JWT_SECRET) as any;
    (socket as any).user = decoded;
    next();
  } catch {
    next(new Error("Invalid session"));
  }
});

const canAccess = async (user: any, serverId: string) => {
  const server = await findServer(serverId);
  if (!server) return false;
  return isAdminRole(user.role) || server.owner === user.id;
};

io.on("connection", (socket) => {
  const user = (socket as any).user;

  socket.on("server:join", async (serverId: string) => {
    if (!(await canAccess(user, serverId))) {
      socket.emit("server:error", { message: "You do not have access to this server" });
      return;
    }
    socket.join(`server:${serverId}`);
    socket.emit("server:joined", { serverId });
  });

  socket.on("server:leave", (serverId: string) => socket.leave(`server:${serverId}`));

  socket.on("server:command", async ({ serverId, command }: any) => {
    if (!(await canAccess(user, serverId))) return;
    try {
      const { sendCommandToServer } = await import("./src/server/services/runtime");
      await sendCommandToServer(serverId, String(command || "").slice(0, 2000));
    } catch (err: any) {
      socket.emit("server:error", { message: err.message });
    }
  });

  socket.on("stats:subscribe", () => socket.join("stats"));
});

// ---------------------------------------------------------------------------
// Node daemon gateway — the daemon dials in over /daemon and stays connected.
// ---------------------------------------------------------------------------
attachDaemonGateway(io);

// Fan out runtime events to subscribers
panelEvents.on("log", ({ serverId, chunk }) => {
  io.to(`server:${serverId}`).emit("server:log", { serverId, chunk });
});
panelEvents.on("status", ({ serverId, status }) => {
  io.to(`server:${serverId}`).emit("server:status", { serverId, status });
  io.emit("dashboard:invalidate", { serverId });
});
panelEvents.on("notification", (payload) => {
  io.emit("notification", payload);
});

// Periodic live stats broadcast (dashboard cards + node gauges)
setInterval(async () => {
  try {
    const { systemSnapshot } = await import("./src/server/services/proc");
    const snap = await systemSnapshot();
    io.emit("system:stats", snap);
  } catch {
    /* ignore */
  }
}, 5000);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
import authRoutes from "./src/server/routes/auth";
import userRoutes from "./src/server/routes/users";
import serverRoutes from "./src/server/routes/servers";
import nodeRoutes from "./src/server/routes/nodes";
import apiKeyRoutes from "./src/server/routes/apikeys";
import adminRoutes from "./src/server/routes/admin";
import systemRoutes from "./src/server/routes/system";

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/nodes", nodeRoutes);
app.use("/api/api-keys", apiKeyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/system", systemRoutes);

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
// Without this, any thrown error — including a multer field mismatch — escaped
// as Express's default HTML "Internal Server Error" page, so the UI could only
// report "Request failed (500)". A JSON body with a real message is what makes a
// failure diagnosable from the toast.
app.use((err: any, req: any, res: any, _next: any) => {
  if (res.headersSent) return;
  const isMulter = err?.name === "MulterError";
  const status = isMulter ? 400 : Number(err?.status || err?.statusCode) || 500;

  let message = err?.message || "Something went wrong";
  if (isMulter) {
    message =
      err.code === "LIMIT_FILE_SIZE"
        ? "That image is too large. The limit is 200 MB."
        : err.field
          ? `Unexpected upload field "${err.field}".`
          : `Upload rejected (${err.code}).`;
  }

  if (req?.path?.startsWith("/api") || req?.originalUrl?.startsWith("/api")) {
    res.status(status).json({ error: message });
    return;
  }
  res.status(status).type("text/plain").send(message);
});

// Settings drive the entire visual identity of the panel, so a stale copy is not
// a performance win — it is the bug where a saved theme or panel name appears to
// be ignored. Express would otherwise emit an ETag and answer a browser's
// revalidation with 304 + no body, which the client cannot parse back into
// settings. no-store keeps every read authoritative.
app.get("/api/settings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.json(await publicSettings());
});

// ---------------------------------------------------------------------------
// Daemon distribution — the zip is served by the panel so a node always runs a
// daemon built for this exact panel version.
// ---------------------------------------------------------------------------
app.get("/downloads/zkdaemon.zip", (req, res) => {
  const file = path.join(process.cwd(), "dist", "downloads", "zkdaemon.zip");
  if (!fs.existsSync(file)) {
    return res
      .status(404)
      .type("text/plain")
      .send("The daemon package has not been built. Run `npm run build:daemon`.");
  }
  res.download(file, "zkdaemon.zip");
});

app.get("/api/daemon/version", (_req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "daemon", "package.json"), "utf8"));
    res.json({ version: pkg.version });
  } catch {
    res.json({ version: "unknown" });
  }
});

app.get("/api/health", async (_req, res) => {
  res.json({
    status: "ok",
    panel: "ZK-MC3-PANEL",
    studio: "ZK-STUDIO",
    version: "1.0.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Ensure a first-run owner account exists
// ---------------------------------------------------------------------------
const bootstrapOwner = async () => {
  const users = await listUsers();
  if (users.length > 0) return;
  const settings = await getSettings();
  const username = process.env.OWNER_USERNAME || "admin";
  const password = process.env.OWNER_PASSWORD || "admin";
  await createUserRecord({
    name: "Panel Owner",
    username,
    email: process.env.OWNER_EMAIL || "owner@zk-mc3.local",
    password,
    role: "owner",
    // Seeded credentials are flagged, but rotation is only *forced* when the
    // operator turns on "require initial password change" in Panel Settings.
    mustChangePassword: password === "admin" && username === "admin",
  });
  console.log(`[ZK-MC3] Bootstrapped owner account "${username}" — sign in with ${username} / ${password} and change it in Account → Password.`);
  void settings;
};

/** Adopts servers from a previous install that lost its owner reference. */
const repairServers = async () => {
  const servers = await listServers();
  const users = await listUsers();
  const owner = users.find((u) => u.role === "owner") || users[0];
  if (!owner) return;
  let dirty = false;
  for (const s of servers) {
    if (!users.some((u) => u.id === s.owner)) {
      (s as any).owner = owner.id;
      (s as any).ownerName = owner.username;
      dirty = true;
    }
  }
  if (dirty) await saveServers(servers);
};

// ---------------------------------------------------------------------------
// Static assets + SPA fallback
// ---------------------------------------------------------------------------
async function attachFrontend() {
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), "dist");
    const publicDir = path.join(process.cwd(), "public");
    app.use("/uploads", express.static(path.join(publicDir, "uploads")));
    app.use(express.static(publicDir));
    app.use(express.static(dist));
    // A request for a missing /downloads/ file is a dead download link, not a
    // client-side route. Answering 404 text beats returning the SPA's HTML under
    // a .zip/.tar.gz name, which leaves the operator with a corrupt archive.
    app.get("/downloads/*", (_req, res) => {
      res.status(404).type("text/plain").send("That download does not exist on this panel.");
    });
    // Unknown /api paths must not fall through to the SPA either: a client
    // asking a removed endpoint would get a 200 with an HTML page and try to
    // parse it as JSON.
    app.all("/api/*", (_req, res) => {
      res.status(404).json({ error: "No such API endpoint" });
    });
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
}

const start = async () => {
  await ensureDataDirs();
  await bootstrapOwner();
  await repairServers();
  await recoverRunningProcesses();
  // No demo data is ever written: a fresh install starts with exactly one
  // account (the owner) and an empty server list.
  await attachFrontend();

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  ██╗  ZK-MC3-PANEL  ██╗`);
    console.log(`  Minecraft hosting panel by ZK-STUDIO`);
    console.log(`  Running on http://0.0.0.0:${PORT} (${isDev ? "development" : "production"})\n`);
  });
};

process.on("uncaughtException", (err) => {
  console.error("[ZK-MC3] Uncaught exception:", err);
  try {
    fs.writeFileSync("crash.log", String(err?.stack || err));
  } catch {
    /* ignore */
  }
});
process.on("unhandledRejection", (reason) => {
  console.error("[ZK-MC3] Unhandled rejection:", reason);
});

start();

export default app;

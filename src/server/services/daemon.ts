import type { Server as SocketServer, Socket } from "socket.io";
import { listNodes, updateNode, nodeWithUsage } from "./nodes";
import { panelEvents, emitLog, emitStatus } from "../events";
import { listServers } from "./runtime";

/**
 * Daemon gateway
 * --------------
 * The panel side of the node connection, mounted at the Socket.IO namespace
 * `/daemon`.
 *
 * The daemon dials in and stays connected. Every interaction with a node —
 * stats, starting a server, console input — is a request down this socket, so
 * a node needs no inbound port and works behind NAT, Docker and Codespaces.
 *
 * This is the same architecture as Wings/Pterodactyl, inverted: those open an
 * inbound HTTPS port the panel calls; here the daemon holds the socket. The
 * practical difference is that an operator never has to find their node's IP
 * or touch a firewall.
 */

/** nodeId → live socket */
const sockets = new Map<string, Socket>();

/** In-flight request ids, so a caller can await a specific daemon reply. */
let requestSeq = 0;

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out — the node did not answer`)), ms)
    ),
  ]);

/** Ask a connected daemon to do something and wait for its answer. */
export const requestNode = async (
  nodeId: string,
  event: string,
  payload: any,
  timeoutMs = 15000
): Promise<any> => {
  const socket = sockets.get(nodeId);
  if (!socket || !socket.connected) {
    throw new Error("That node is offline. Start the daemon on it and try again.");
  }
  const id = `req_${++requestSeq}`;
  const answer = new Promise<any>((resolve, reject) => {
    const handler = (msg: any) => {
      if (msg?.id !== id) return;
      socket.off("reply", handler);
      if (msg.ok) resolve(msg.data ?? msg);
      else reject(new Error(msg.error || "The node rejected the request"));
    };
    socket.on("reply", handler);
    socket.emit(event, { ...payload, id });
  });
  return withTimeout(answer, timeoutMs, event);
};

export const isNodeConnected = (nodeId: string) => Boolean(sockets.get(nodeId)?.connected);
export const connectedNodeIds = () => [...sockets.entries()].filter(([, s]) => s.connected).map(([id]) => id);
export const nodeSocketCount = () => sockets.size;

/**
 * Wires the namespace.
 *
 * Authentication is the node token from `nodes.json`. A daemon that presents a
 * token which matches no node is rejected with a message that says what to do,
 * because "invalid token" with no context is the least helpful error in this
 * whole system.
 */
export const attachDaemonGateway = (io: SocketServer) => {
  const daemon = io.of("/daemon");

  daemon.use(async (socket, next) => {
    const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || "").trim();
    if (!token) return next(new Error("Missing node token"));

    const nodes = await listNodes();
    const node = nodes.find((n) => n.id !== "local" && n.token && n.token === token);
    if (!node) {
      return next(
        new Error("This token does not belong to any node. Copy the install command from the panel again.")
      );
    }

    (socket as any).nodeId = node.id;
    (socket as any).nodeName = node.name;
    next();
  });

  daemon.on("connection", async (socket: Socket) => {
    const nodeId = (socket as any).nodeId as string;
    const nodeName = (socket as any).nodeName as string;

    // One live socket per node: a machine that reconnects after a reboot must
    // displace its own ghost, not appear twice.
    const previous = sockets.get(nodeId);
    if (previous && previous.id !== socket.id) previous.disconnect(true);
    sockets.set(nodeId, socket);

    console.log(`[ZK-MC3] daemon connected: ${nodeName} (${nodeId})`);
    await updateNode(nodeId, { status: "online", lastSeen: new Date().toISOString() });

    socket.on("node:hello", async (hello: any) => {
      const system = hello?.system || {};
      const address = hello?.address || {};
      await updateNode(nodeId, {
        status: "online",
        lastSeen: new Date().toISOString(),
        hostname: system.hostname || address.host || "",
        ip: address.host || "",
        port: 25565,
        cpuCores: Number(system.cpuCores) || 0,
        memoryMb: Number(system.memoryTotalMb) || 0,
        diskMb: Number(system.diskTotalMb) || 0,
        daemonVersion: String(hello?.daemonVersion || ""),
        java: system.java,
        addressSource: String(address.source || ""),
        // Everything else on the card is derived from these two.
        ...({
          hostInfo: {
            cpuModel: system.cpuModel,
            platform: system.platform,
            arch: system.arch,
            uptime: system.uptime,
          },
          usage: {
            cpu: system.loadPercent ?? 0,
            ram: system.memoryUsedMb ?? 0,
            disk: system.diskUsedMb ?? 0,
            memoryPercent: system.memoryPercent ?? 0,
            diskPercent: system.diskPercent ?? 0,
          },
          connected: true,
        } as any),
      });
      console.log(
        `[ZK-MC3] ${nodeName}: ${system.hostname} · ${system.cpuCores} cores · ${system.memoryTotalMb} MB · ${address.host}`
      );
      io.emit("node:update", { nodeId });
    });

    // Live telemetry — written through to storage, so the card is honest even
    // when the socket is momentarily quiet.
    socket.on("node:stats", async (payload: any) => {
      const system = payload?.system || {};
      await updateNode(nodeId, {
        status: "online",
        lastSeen: new Date().toISOString(),
        ...({
          usage: {
            cpu: system.loadPercent ?? 0,
            ram: system.memoryUsedMb ?? 0,
            disk: system.diskUsedMb ?? 0,
            memoryPercent: system.memoryPercent ?? 0,
            diskPercent: system.diskPercent ?? 0,
          },
          hostInfo: {
            cpuModel: system.cpuModel,
            platform: system.platform,
            arch: system.arch,
            uptime: system.uptime,
          },
          connected: true,
        } as any),
      });
    });

    /* ── server lifecycle events coming *up* from the node ─────────────── */

    socket.on("server:log", async ({ serverId, text }: any) => {
      if (!serverId || !text) return;
      // Persist as well as broadcast: without this the console is live only
      // while the socket is open, and a page reload shows an empty window.
      const { appendRemoteConsole } = await import("./runtime");
      void appendRemoteConsole(serverId, text);
      emitLog(serverId, text);
    });

    socket.on("server:status", async ({ serverId, status, pid }: any) => {
      if (!serverId) return;
      const { findServer, updateServer } = await import("./runtime");
      const server = await findServer(serverId);
      // A node may only speak about its own servers.
      if (!server || server.nodeId !== nodeId) return;
      await updateServer(serverId, { status, pid: pid || null } as any);
      emitStatus(serverId, status);
    });

    socket.on("server:exit", async ({ serverId, code, stopping }: any) => {
      if (!serverId) return;
      const { findServer, updateServer, listServers: all } = await import("./runtime");
      const server = await findServer(serverId);
      if (!server || server.nodeId !== nodeId) return;
      await updateServer(serverId, { status: "offline", pid: null, startedAt: null } as any);
      emitStatus(serverId, "offline");
      const autoRestart = server.autoRestart && !stopping;
      if (autoRestart) {
        console.log(`[ZK-MC3] ${server.name} exited (${code}) — auto-restarting`);
      }
      void all;
    });

    socket.on("disconnect", async (reason) => {
      // Only clear the map if this socket is still the one we recorded — a
      // replaced ghost disconnecting must not mark the live node offline.
      if (sockets.get(nodeId)?.id === socket.id) {
        sockets.delete(nodeId);
        console.log(`[ZK-MC3] daemon disconnected: ${nodeName} (${reason})`);
        const nodes = await listNodes();
        const node = nodes.find((n) => n.id === nodeId);
        if (node && node.status !== "maintenance") {
          await updateNode(nodeId, { status: "offline" });
        }
        io.emit("node:update", { nodeId });
      }
    });
  });
};

/**
 * Forwards a panel-side server action to the node that owns it.
 *
 * Callers in the server routes use this instead of touching the socket layer,
 * which keeps the "is this node online" decision in one place.
 */
export const runOnNode = async (
  nodeId: string,
  action: "start" | "stop" | "command" | "kill" | "fs:op" | "provision",
  payload: Record<string, any>,
  timeoutMs?: number
) => {
  if (action === "fs:op") return requestNode(nodeId, "fs:op", payload, timeoutMs || 20000);
  if (action === "provision") return requestNode(nodeId, "fs:op", { ...payload, op: "provision" }, timeoutMs || 300000);

  const event = action === "start" ? "server:start" : action === "command" ? "server:command" : "server:stop";
  const body =
    action === "command"
      ? payload
      : { ...payload, signal: action === "kill" ? "SIGKILL" : "SIGTERM", graceMs: action === "kill" ? 2000 : 25000 };
  return requestNode(nodeId, event, body, timeoutMs || (action === "start" ? 45000 : 40000));
};

/** Wipes per-server state on the node when a server is deleted. */
export const forgetNodeServer = async (nodeId: string, serverId: string) => {
  if (!isNodeConnected(nodeId)) return;
  await requestNode(nodeId, "fs:op", { op: "delete", serverId, file: "." }, 10000).catch(() => {});
};

/** Every server a node currently reports as running. */
export const nodeInventory = async (nodeId: string) => {
  const servers = await listServers();
  return servers.filter((s) => s.nodeId === nodeId).map((s) => ({ id: s.id, name: s.name, status: s.status }));
};

/** Re-publishes a node with its live usage, for API responses. */
export const liveNode = async (nodeId: string) => {
  const nodes = await listNodes();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return nodeWithUsage({ ...node, connected: isNodeConnected(nodeId) }, await listServers());
};

export { panelEvents };

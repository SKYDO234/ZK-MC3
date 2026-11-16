import { EventEmitter } from "events";

/**
 * Central event bus for server runtime events.
 * The Socket.IO layer subscribes to this to stream console output live.
 */
export const panelEvents = new EventEmitter();
panelEvents.setMaxListeners(200);

export const emitLog = (serverId: string, chunk: string) => {
  panelEvents.emit("log", { serverId, chunk });
};

export const emitStatus = (serverId: string, status: string, extra: Record<string, any> = {}) => {
  panelEvents.emit("status", { serverId, status, ...extra });
};

export const emitStats = (serverId: string, stats: Record<string, any>) => {
  panelEvents.emit("stats", { serverId, ...stats });
};

export const emitNotification = (userId: string, payload: Record<string, any>) => {
  panelEvents.emit("notification", { userId, ...payload });
};

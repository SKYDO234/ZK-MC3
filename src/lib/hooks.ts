import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { getSocket } from "./realtime";
import { useSettings } from "../context/SettingsContext";

export const useApi = <T,>(path: string | null, deps: any[] = []) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    if (!path) return;
    try {
      setError("");
      const result = await api<T>(path);
      setData(result);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
};

/** Polls an endpoint on an interval (pauses when the tab is hidden). */
export const usePolling = <T,>(path: string | null, intervalMs = 5000, deps: any[] = []) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await api<T>(path);
      setData(result);
    } catch {
      /* keep last known values */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    if (!path) return;
    load();
    timer.current = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load, intervalMs, path]);

  return { data, loading, reload: load };
};

/** Subscribes to one server's live console + status via Socket.IO. */
export const useServerSocket = (
  serverId: string | undefined,
  handlers: {
    onLog?: (chunk: string) => void;
    onStatus?: (status: string) => void;
    onError?: (message: string) => void;
  }
) => {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!serverId) return;
    const socket = getSocket();
    const join = () => {
      setConnected(true);
      socket.emit("server:join", serverId);
    };
    if (socket.connected) join();
    socket.on("connect", join);
    socket.on("disconnect", () => setConnected(false));
    socket.on("server:log", (payload: { serverId: string; chunk: string }) => {
      if (payload.serverId === serverId) handlersRef.current.onLog?.(payload.chunk);
    });
    socket.on("server:status", (payload: { serverId: string; status: string }) => {
      if (payload.serverId === serverId) handlersRef.current.onStatus?.(payload.status);
    });
    socket.on("server:error", (payload: { message: string }) => handlersRef.current.onError?.(payload.message));
    return () => {
      socket.emit("server:leave", serverId);
      socket.off("connect", join);
      socket.off("server:log");
      socket.off("server:status");
      socket.off("server:error");
      socket.off("disconnect");
    };
  }, [serverId]);

  return { connected };
};

/** Global live system stats emitter. */
export const useSystemStats = () => {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    const socket = getSocket();
    socket.emit("stats:subscribe");
    const handler = (payload: any) => setStats(payload);
    socket.on("system:stats", handler);
    return () => {
      socket.off("system:stats", handler);
    };
  }, []);
  return stats;
};

/**
 * Document titles are written as "<Page> · ZK-MC3-PANEL" at each call site, but the
 * panel can be renamed in Panel Settings. Rather than thread the live name through
 * fifteen call sites, the suffix is substituted here: the literal product name is
 * only ever a placeholder for whatever the operator called their panel.
 */
export const useDocumentTitle = (title: string) => {
  const { settings } = useSettings();
  const panelName = settings?.panelName || "ZK-MC3-PANEL";
  useEffect(() => {
    const previous = document.title;
    document.title = title.replace(/ZK-MC3-PANEL/g, panelName);
    return () => {
      document.title = previous;
    };
  }, [title, panelName]);
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TerminalSquare,
  Cpu,
  MemoryStick,
  HardDrive,
  Play,
  Square,
  RotateCw,
  Power,
  Wifi,
  Clock,
  ArrowDown,
  ArrowUp,
  Trash2,
  Download,
  Search,
  X,
  Copy,
  Check,
  Activity,
  Zap,
  ScrollText,
  Radio,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { api, apiDownload } from "../../lib/api";
import { useServerSocket } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { formatUptime } from "../../lib/format";

/**
 * Server console — the "control deck".
 * ---------------------------------------------------------------------------
 * Deliberately *not* a stack of stacked cards. The page is organised as a
 * single instrument panel:
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  STATE RAIL   ·  live machine readout, one horizontal strip    │
 *   ├───────────────────────────────────┬───────────────────────────┤
 *   │  TERMINAL (spans 2 rows)          │  POWER COLUMN             │
 *   │                                   │  ────────────             │
 *   │  command bar docked underneath    │  TELEMETRY SPARKLINES     │
 *   │                                   │  ────────────             │
 *   │                                   │  SESSION NOTES            │
 *   └───────────────────────────────────┴───────────────────────────┘
 *
 * Everything sits on the panel's own ink/brand palette with hairline dividers
 * instead of floating rounded cards. Numbers are the node's real measurements.
 */

const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");

const pad = (n: number) => String(n).padStart(2, "0");
const clockTime = (iso?: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatMb = (mb: number) => {
  if (!mb) return "0 MB";
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatRate = (bytesPerSecond: number) => {
  if (!bytesPerSecond) return "0 B/s";
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
};

type LineKind = "info" | "warn" | "error" | "input" | "system" | "success";

const classify = (raw: string): LineKind => {
  const line = raw.replace(ANSI, "");
  if (line.startsWith(">")) return "input";
  if (line.startsWith("[Panel]")) return "system";
  if (/\b(ERROR|SEVERE|FATAL|Exception|Caused by)\b/i.test(line)) return "error";
  if (/\b(WARN|WARNING|deprecated)\b/i.test(line)) return "warn";
  if (/Done \(|Server is online|Started|listening on/i.test(line)) return "success";
  return "info";
};

const LINE_TONE: Record<LineKind, string> = {
  info: "text-zinc-300",
  warn: "text-amber-300/90",
  error: "text-rose-400",
  input: "text-brand-300",
  system: "text-sky-300/90",
  success: "text-emerald-300",
};

const LINE_MARK: Record<LineKind, string> = {
  info: "",
  warn: "▲",
  error: "✕",
  input: "›",
  system: "◆",
  success: "✓",
};

const LOG_CAP = 2000;
const SPARK_CAP = 40;
/** Fixed terminal body height so the deck lines up with the instrument column. */
const TERMINAL_HEIGHT = "h-[380px] sm:h-[460px] xl:h-[430px]";

interface StatsPayload {
  running: boolean;
  isRunning?: boolean;
  attached?: boolean;
  pid: number | null;
  startedAt: string | null;
  uptimeSeconds: number;
  cpu: number;
  ram: number;
  netIn?: number;
  netOut?: number;
  netInRate?: number;
  netOutRate?: number;
  disk: number;
  limitRam: number;
  limitCpu: number;
  limitDisk: number;
  status: string;
  address: string;
  listeningPorts?: number[];
}

/* ------------------------------------------------------------- primitives */

/** One reading in the top rail. Values stay monospaced so digits don't jump. */
const Readout: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  accent?: boolean;
}> = ({ label, value, hint, icon, accent }) => (
  <div className="group relative min-w-0 flex-1 px-4 py-3 first:pl-0 last:pr-0">
    <div className="flex items-center gap-1.5">
      <span className={accent ? "text-brand-500" : "text-zinc-600"}>{icon}</span>
      <span className="truncate text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </span>
    </div>
    <div className="mt-1 flex items-baseline gap-1.5">
      <span className="truncate font-mono text-[0.95rem] font-semibold leading-none text-zinc-100">
        {value}
      </span>
      {hint && <span className="truncate font-mono text-[0.6rem] text-zinc-600">{hint}</span>}
    </div>
  </div>
);

/** Thin horizontal line pinned under a rail item to show a ratio. */
const MicroBar: React.FC<{ value: number; tone?: string }> = ({ value, tone }) => {
  const clamped = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          tone || (clamped > 88 ? "bg-rose-500" : clamped > 68 ? "bg-amber-400" : "bg-brand-500")
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

/** A power action: square, label-forward, with a coloured left rule. */
const PowerKey: React.FC<{
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone: "start" | "restart" | "stop" | "kill";
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}> = ({ label, hint, icon, tone, disabled, loading, onClick }) => {
  const skins = {
    start: {
      rule: "bg-emerald-400",
      icon: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300 group-hover:bg-emerald-400/20",
      text: "group-hover:text-emerald-200",
    },
    restart: {
      rule: "bg-amber-400",
      icon: "border-amber-400/25 bg-amber-400/10 text-amber-300 group-hover:bg-amber-400/20",
      text: "group-hover:text-amber-200",
    },
    stop: {
      rule: "bg-orange-500",
      icon: "border-orange-500/25 bg-orange-500/10 text-orange-300 group-hover:bg-orange-500/20",
      text: "group-hover:text-orange-200",
    },
    kill: {
      rule: "bg-rose-500",
      icon: "border-rose-500/25 bg-rose-500/10 text-rose-300 group-hover:bg-rose-500/20",
      text: "group-hover:text-rose-200",
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="group relative flex w-full items-center gap-3 overflow-hidden border-b border-white/[0.05] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-white/[0.025] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span className={`absolute inset-y-0 left-0 w-[2px] ${skins.rule} opacity-70 transition-opacity group-hover:opacity-100`} />
      <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg border transition-colors ${skins.icon}`}>
        {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[0.78rem] font-semibold text-zinc-200 transition-colors ${skins.text}`}>
          {label}
        </span>
        <span className="block truncate text-[0.62rem] text-zinc-600">{hint}</span>
      </span>
    </button>
  );
};

/** Compact telemetry strip: label, current value, and the sparkline itself. */
const Spark: React.FC<{
  label: string;
  value: string;
  data: Array<Record<string, number>>;
  keys: string[];
  colors: string[];
  max?: number;
  legend?: Array<{ label: string; color: string }>;
}> = ({ label, value, data, keys, colors, max, legend }) => {
  const padded = useMemo(() => {
    const rows = [...data];
    while (rows.length < SPARK_CAP) {
      const blank: Record<string, number> = {};
      keys.forEach((k) => (blank[k] = 0));
      rows.unshift(blank);
    }
    return rows;
  }, [data, keys]);

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
        <span className="font-mono text-[0.72rem] font-semibold text-zinc-200">{value}</span>
      </div>
      <div className="mt-1.5 h-[46px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={padded} margin={{ top: 2, left: 0, right: 0, bottom: 0 }}>
            <defs>
              {keys.map((key, i) => (
                <linearGradient id={`spark-${label.replace(/\W/g, "")}-${key}`} key={key} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[i]} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={colors[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <YAxis domain={[0, max || "auto"]} hide />
            {keys.map((key, i) => (
              <Area
                key={key}
                type="linear"
                dataKey={key}
                stroke={colors[i]}
                strokeWidth={1.5}
                fill={`url(#spark-${label.replace(/\W/g, "")}-${key})`}
                isAnimationActive={false}
                dot={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {legend && (
        <div className="mt-1 flex items-center gap-3">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1 text-[0.58rem] text-zinc-600">
              <span className="h-[2px] w-3 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- the console */

export const ServerConsole: React.FC<{
  server: any;
  onStatus?: (status: string) => void;
  onRefresh?: () => void;
}> = ({ server, onStatus, onRefresh }) => {
  const { success, error } = useToast();
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compact, setCompact] = useState(false);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [cpuHist, setCpuHist] = useState<Array<Record<string, number>>>([]);
  const [ramHist, setRamHist] = useState<Array<Record<string, number>>>([]);
  const [netHist, setNetHist] = useState<Array<Record<string, number>>>([]);
  const [tick, setTick] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<string | null | undefined>(server?.startedAt);

  const isOnline = stats?.isRunning ?? stats?.running ?? server.status === "online";
  const isTransitioning = stats?.status === "starting" || stats?.status === "stopping" || server.status === "installing";

  /* ---- backlog ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api<{ logs: string }>(`/servers/${server.id}/logs`, { query: { lines: 500 } });
        if (!alive) return;
        setLines((data.logs || "").split(/\r?\n/).filter(Boolean).slice(-LOG_CAP));
      } catch {
        /* console starts empty */
      }
    })();
    return () => {
      alive = false;
    };
  }, [server.id]);

  /* ---- live stream ---- */
  useServerSocket(server.id, {
    onLog: (chunk) => {
      const incoming = chunk.split(/\r?\n/).filter(Boolean);
      if (!incoming.length) return;
      setLines((prev) => {
        const next = [...prev, ...incoming];
        return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
      });
    },
    onStatus: (status) => {
      onStatus?.(status);
      onRefresh?.();
    },
  });

  /* ---- telemetry ---- */
  const pullStats = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const data = await api<StatsPayload>(`/servers/${server.id}/stats`);
      setStats(data);
      setCpuHist((prev) => [...prev, { cpu: Math.round((data.cpu || 0) * 10) / 10 }].slice(-SPARK_CAP));
      setRamHist((prev) => [...prev, { ram: Math.round(data.ram || 0) }].slice(-SPARK_CAP));
      setNetHist((prev) =>
        [
          ...prev,
          {
            netIn: Math.round(((data.netInRate || 0) / 1024) * 10) / 10,
            netOut: Math.round(((data.netOutRate || 0) / 1024) * 10) / 10,
          },
        ].slice(-SPARK_CAP)
      );
      if (data.startedAt && startedAtRef.current && data.startedAt !== startedAtRef.current) {
        setLines([]);
      }
      startedAtRef.current = data.startedAt;
    } catch {
      /* keep the last sample */
    }
  }, [server.id]);

  useEffect(() => {
    pullStats();
    const timer = window.setInterval(pullStats, 3000);
    return () => window.clearInterval(timer);
  }, [pullStats]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const uptimeSeconds = useMemo(() => {
    void tick;
    if (!isOnline || !stats?.startedAt) return 0;
    const started = new Date(stats.startedAt).getTime();
    if (Number.isNaN(started)) return stats.uptimeSeconds || 0;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [isOnline, stats?.startedAt, stats?.uptimeSeconds, tick]);

  /* ---- autoscroll ---- */
  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, autoScroll]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 40;
    setAtBottom(near);
    if (!near && autoScroll) setAutoScroll(false);
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    setAtBottom(true);
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  };

  /* ---- commands ---- */
  const send = async () => {
    const value = command.trim();
    if (!value) return;
    if (!isOnline) {
      error("Server is offline", "Start the server before sending console commands.");
      return;
    }
    setSending(true);
    setCommand("");
    setHistory((prev) => [value, ...prev.filter((h) => h !== value)].slice(0, 50));
    setHistoryIndex(-1);
    try {
      await api(`/servers/${server.id}/command`, { method: "POST", body: { command: value } });
    } catch (err: any) {
      setLines((prev) => [...prev, `[Panel] Command failed: ${err.message}`]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const next = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(next);
      setCommand(history[next]);
    }
    if (e.key === "ArrowDown" && history.length) {
      e.preventDefault();
      const next = Math.max(-1, historyIndex - 1);
      setHistoryIndex(next);
      setCommand(next === -1 ? "" : history[next]);
    }
    if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      clearConsole();
    }
  };

  const act = async (action: "start" | "stop" | "restart" | "kill") => {
    setBusy(action);
    if (action === "start" || action === "restart") setLines([]);
    try {
      await api(`/servers/${server.id}/${action}`, { method: "POST" });
      success(`Server ${action === "kill" ? "force-killed" : `${action}ed`}`, "Power action dispatched.");
      setTimeout(() => {
        pullStats();
        onRefresh?.();
      }, 1200);
    } catch (err: any) {
      error("Power action failed", err.message);
    } finally {
      setBusy("");
    }
  };

  const clearConsole = async () => {
    setLines([]);
    await api(`/servers/${server.id}/console/clear`, { method: "POST" }).catch(() => {});
    success("Console cleared");
  };

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      error("Copy failed", "Your browser blocked clipboard access.");
    }
  };

  /* ---- derived ---- */
  const visible = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => stripAnsi(line).toLowerCase().includes(needle));
  }, [lines, filter]);

  const counts = useMemo(() => {
    let warn = 0;
    let err = 0;
    for (const line of lines) {
      const kind = classify(line);
      if (kind === "warn") warn += 1;
      else if (kind === "error") err += 1;
    }
    return { warn, err };
  }, [lines]);

  const cpuLimit = stats?.limitCpu || server.cpu || 1;
  const ramLimit = stats?.limitRam || server.ram || 1024;
  const diskLimit = stats?.limitDisk || server.disk || 0;
  const cpuPct = Math.min(100, cpuLimit ? ((stats?.cpu || 0) / (cpuLimit * 100)) * 100 : 0);
  const ramPct = Math.min(100, ramLimit ? ((stats?.ram || 0) / ramLimit) * 100 : 0);
  const diskPct = Math.min(100, diskLimit ? ((stats?.disk || 0) / diskLimit) * 100 : 0);

  const stateLabel = isOnline ? "online" : isTransitioning ? stats?.status || server.status : "offline";
  const stateTone = isOnline
    ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300"
    : isTransitioning
    ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-300"
    : "border-white/[0.08] bg-white/[0.03] text-zinc-400";

  return (
    <div className="space-y-4">
      {/* ══════════════════════════════════ state rail ═══════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.035] to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* breathing state ring */}
            <span className="relative flex h-2.5 w-2.5 flex-none">
              {isOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  isOnline ? "bg-emerald-400" : isTransitioning ? "bg-amber-400 animate-pulse" : "bg-zinc-600"
                }`}
              />
            </span>
            <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.12em] ${stateTone}`}>
              {stateLabel}
            </span>
            <span className="truncate font-mono text-[0.7rem] text-zinc-500">
              pid {stats?.pid ?? "—"} · {server.software} {server.version}
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[0.62rem] text-zinc-600">
            {counts.err > 0 && (
              <span className="flex items-center gap-1 text-rose-400/90">
                <span className="h-1 w-1 rounded-full bg-rose-400" />
                {counts.err} error{counts.err === 1 ? "" : "s"}
              </span>
            )}
            {counts.warn > 0 && (
              <span className="flex items-center gap-1 text-amber-400/80">
                <span className="h-1 w-1 rounded-full bg-amber-400" />
                {counts.warn} warning{counts.warn === 1 ? "" : "s"}
              </span>
            )}
            <span className="hidden items-center gap-1 sm:flex">
              <Radio size={10} className="text-brand-500" />
              live
            </span>
            <span>{clockTime(stats?.startedAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap divide-x divide-white/[0.05] px-4">
          <Readout
            icon={<Wifi size={12} />}
            label="Endpoint"
            value={
              <span className="text-[0.85rem]">
                {server.ip === "0.0.0.0" ? "0.0.0.0" : server.ip}:{server.port}
              </span>
            }
            accent
          />
          <Readout
            icon={<Clock size={12} />}
            label="Uptime"
            value={isOnline ? formatUptime(uptimeSeconds) : "—"}
          />
          <div className="min-w-0 flex-1 px-4 py-3">
            <Readout
              icon={<Cpu size={12} />}
              label="CPU"
              value={isOnline ? `${(stats?.cpu ?? 0).toFixed(2)}%` : "—"}
              hint={isOnline ? `of ${(cpuLimit * 100).toFixed(0)}%` : undefined}
            />
            <MicroBar value={isOnline ? cpuPct : 0} />
          </div>
          <div className="min-w-0 flex-1 px-4 py-3">
            <Readout
              icon={<MemoryStick size={12} />}
              label="Memory"
              value={isOnline ? formatMb(stats?.ram ?? 0) : "—"}
              hint={isOnline ? `/ ${formatMb(ramLimit)}` : undefined}
            />
            <MicroBar value={isOnline ? ramPct : 0} />
          </div>
          <div className="min-w-0 flex-1 px-4 py-3">
            <Readout
              icon={<HardDrive size={12} />}
              label="Disk"
              value={formatMb(stats?.disk ?? 0)}
              hint={diskLimit ? `/ ${formatMb(diskLimit)}` : undefined}
            />
            <MicroBar value={diskPct} tone="bg-sky-500/80" />
          </div>
          <Readout
            icon={<Activity size={12} />}
            label="Net"
            value={isOnline ? (
              <span className="flex items-center gap-1.5 text-[0.78rem]">
                <span className="text-emerald-400">↓{formatRate(stats?.netInRate ?? 0)}</span>
                <span className="text-zinc-600">/</span>
                <span className="text-amber-400">↑{formatRate(stats?.netOutRate ?? 0)}</span>
              </span>
            ) : (
              "—"
            )}
          />
        </div>
      </div>

      {/* ═══════════════════════ terminal + instrument column ═══════════════ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ------------------------------------------------------ terminal */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/70">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-ink-850/80 px-3 py-2">
            <TerminalSquare size={13} className="text-brand-500" />
            <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-zinc-400">
              terminal
            </span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.58rem] text-zinc-600">
              {visible.length}
              {filter ? ` / ${lines.length}` : ""}
            </span>

            <div className="ml-auto flex items-center gap-0.5">
              {showFilter ? (
                <div className="mr-1 flex items-center gap-1 rounded-lg border border-white/[0.08] bg-black/40 px-2">
                  <Search size={11} className="text-zinc-600" />
                  <input
                    autoFocus
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="filter"
                    className="w-24 bg-transparent py-1 font-mono text-[0.65rem] text-zinc-200 outline-none placeholder:text-zinc-700"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowFilter(false);
                      setFilter("");
                    }}
                    className="text-zinc-600 transition hover:text-zinc-200"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFilter(true)}
                  className="rounded-md p-1.5 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                  title="Filter output"
                >
                  <Search size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setCompact((v) => !v)}
                className={`rounded-md p-1.5 transition hover:bg-white/5 hover:text-zinc-200 ${compact ? "text-brand-400" : "text-zinc-600"}`}
                title={compact ? "Comfortable spacing" : "Compact spacing"}
              >
                <ScrollText size={13} />
              </button>
              <button
                type="button"
                onClick={copyLogs}
                className="rounded-md p-1.5 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                title="Copy console"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
              <button
                type="button"
                onClick={() => apiDownload(`/servers/${server.id}/logs?lines=10000`, `${server.name}-console.log`)}
                className="rounded-md p-1.5 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                title="Download log"
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                onClick={clearConsole}
                className="rounded-md p-1.5 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                title="Clear console"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {/* body */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-ink-900 to-transparent" />
            <div
              ref={bodyRef}
              onScroll={onScroll}
              onClick={() => inputRef.current?.focus()}
              className={`select-text overflow-y-auto overflow-x-hidden bg-[#08080a] px-3.5 py-3 font-mono text-zinc-300 [overflow-wrap:anywhere] ${
                compact ? "text-[11px] leading-[1.45]" : "text-[12px] leading-[1.72]"
              } ${TERMINAL_HEIGHT}`}
            >
              {visible.length === 0 && (
                <div className="space-y-1 py-6 text-center text-zinc-700">
                  <TerminalSquare size={22} className="mx-auto mb-2 opacity-40" />
                  <p className="text-[0.72rem]">{filter ? "Nothing matches that filter." : "No output yet."}</p>
                  {!filter && (
                    <p className="text-[0.66rem] text-zinc-800">
                      {isOnline ? "Live output will appear here." : "Start the server to stream output."}
                    </p>
                  )}
                </div>
              )}
              {visible.map((line, index) => {
                const kind = classify(line);
                const mark = LINE_MARK[kind];
                return (
                  <div
                    key={`${index}-${line.slice(0, 14)}`}
                    className={`group/mark flex min-w-0 items-start gap-1.5 ${LINE_TONE[kind]} ${
                      compact ? "mb-0" : "mb-[1px]"
                    }`}
                  >
                    <span className="w-2.5 flex-none select-none opacity-0 group-hover/mark:opacity-100">
                      {mark}
                    </span>
                    <span className="min-w-0 break-words">{stripAnsi(line)}</span>
                  </div>
                );
              })}
            </div>

            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-800/95 px-3 py-1.5 text-[11px] font-medium text-zinc-200 shadow-xl backdrop-blur transition hover:border-brand-500/40 hover:text-white active:scale-95"
              >
                <ArrowDown className="h-3.5 w-3.5 animate-bounce text-brand-400" />
                Jump to latest
              </button>
            )}
          </div>

          {/* docked command bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-ink-850/80 px-3 py-2.5"
          >
            <span
              className={`flex-none font-mono text-[0.8rem] font-bold ${
                isOnline ? "text-brand-500" : "text-zinc-700"
              }`}
            >
              ⌘
            </span>
            <input
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!isOnline}
              placeholder={isOnline ? "run a command…" : "server is offline"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-700 disabled:cursor-not-allowed"
            />
            <div className="hidden items-center gap-1 sm:flex">
              <span className="zk-kbd">↑</span>
              <span className="zk-kbd">↓</span>
              <span className="zk-kbd">⌃L</span>
            </div>
            <button
              type="submit"
              disabled={!isOnline || !command.trim() || sending}
              className="flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-ink-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-25"
            >
              {sending ? <span className="h-2.5 w-2.5 animate-spin rounded-full border border-ink-950/40 border-t-ink-950" /> : <Zap size={11} className="fill-current" />}
              run
            </button>
          </form>
        </div>

        {/* --------------------------------------------- instrument column */}
        <div className="flex flex-col gap-4">
          {/* power */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/70">
            <div className="flex items-center gap-2 border-b border-white/[0.06] bg-ink-850/80 px-4 py-2">
              <Power size={12} className="text-zinc-500" />
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                power
              </span>
            </div>
            <PowerKey
              label="Start"
              hint="boot the process"
              icon={<Play size={14} className="fill-current" />}
              tone="start"
              disabled={isOnline || isTransitioning || server.status === "suspended"}
              loading={busy === "start"}
              onClick={() => act("start")}
            />
            <PowerKey
              label="Restart"
              hint="graceful cycle"
              icon={<RotateCw size={14} />}
              tone="restart"
              disabled={!isOnline || isTransitioning}
              loading={busy === "restart"}
              onClick={() => act("restart")}
            />
            <PowerKey
              label="Stop"
              hint="save & shut down"
              icon={<Square size={13} className="fill-current" />}
              tone="stop"
              disabled={!isOnline || isTransitioning}
              loading={busy === "stop"}
              onClick={() => act("stop")}
            />
            <PowerKey
              label="Force kill"
              hint="SIGKILL — no save"
              icon={<Power size={14} />}
              tone="kill"
              disabled={!isOnline || isTransitioning}
              loading={busy === "kill"}
              onClick={() => act("kill")}
            />
          </div>

          {/* telemetry */}
          <div className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/70">
            <div className="flex items-center gap-2 bg-ink-850/80 px-4 py-2">
              <Activity size={12} className="text-zinc-500" />
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                telemetry
              </span>
              <span className="ml-auto font-mono text-[0.55rem] text-zinc-700">40 samples</span>
            </div>
            <Spark
              label="CPU"
              value={isOnline ? `${(stats?.cpu ?? 0).toFixed(2)}%` : "—"}
              data={cpuHist}
              keys={["cpu"]}
              colors={["#ff7a18"]}
              max={Math.max(10, cpuLimit * 100)}
            />
            <Spark
              label="Memory"
              value={isOnline ? formatMb(stats?.ram ?? 0) : "—"}
              data={ramHist}
              keys={["ram"]}
              colors={["#38bdf8"]}
              max={ramLimit}
            />
            <Spark
              label="Network"
              value={isOnline ? `↓${Math.round(stats?.netInRate ?? 0)} ↑${Math.round(stats?.netOutRate ?? 0)}` : "—"}
              data={netHist}
              keys={["netIn", "netOut"]}
              colors={["#34d399", "#fbbf24"]}
              legend={[
                { label: "in", color: "#34d399" },
                { label: "out", color: "#fbbf24" },
              ]}
            />
          </div>

          {/* session */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-900/70">
            <div className="flex items-center gap-2 border-b border-white/[0.06] bg-ink-850/80 px-4 py-2">
              <Clock size={12} className="text-zinc-500" />
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                session
              </span>
            </div>
            <dl className="divide-y divide-white/[0.04] font-mono text-[0.65rem]">
              {[
                ["started", stats?.startedAt ? clockTime(stats.startedAt) : "—"],
                ["uptime", isOnline ? formatUptime(uptimeSeconds) : "—"],
                ["pid", stats?.pid ? String(stats.pid) : "—"],
                ["ports", stats?.listeningPorts?.length ? stats.listeningPorts.join(", ") : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-1.5">
                  <dt className="text-zinc-600">{k}</dt>
                  <dd className="truncate pl-3 text-zinc-300">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2">
              <button
                type="button"
                onClick={() => setAutoScroll((v) => !v)}
                className="flex items-center gap-1.5 text-[0.62rem] text-zinc-500 transition hover:text-zinc-300"
              >
                <span
                  className={`flex h-3 w-5 items-center rounded-full px-[2px] transition-colors ${
                    autoScroll ? "bg-brand-500/80" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`h-[9px] w-[9px] rounded-full bg-white transition-transform ${
                      autoScroll ? "translate-x-[9px]" : "translate-x-0"
                    }`}
                  />
                </span>
                auto-scroll
              </button>
              <ArrowUp size={11} className={`transition ${autoScroll ? "text-zinc-600" : "text-amber-400"}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServerConsole;

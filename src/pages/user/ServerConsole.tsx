import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TerminalSquare,
  Cpu,
  MemoryStick,
  HardDrive,
  ArrowDown,
  ArrowUp,
  Trash2,
  Download,
  Search,
  X,
  Copy,
  Check,
  Activity,
  ScrollText,
  Radio,
  Users,
  CircleSlash,
  Clock,
  Loader2,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useServerSocket } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { formatUptime } from "../../lib/format";

/**
 * Server console — the control deck.
 * ---------------------------------------------------------------------------
 * Three columns, one instrument panel:
 *
 *   ┌──────────────┬────────────────────┬──────────────────────────────┐
 *   │  TELEMETRY   │  PLAYERS           │  SYSTEM CONSOLE              │
 *   │  gauges      │  live roster       │  stream + quick commands     │
 *   └──────────────┴────────────────────┴──────────────────────────────┘
 *
 * The rail (server tile, status, menu) is drawn by ServerView so the same
 * navigation stays visible on every tab. Everything here reads real process
 * numbers — nothing is faked.
 */

const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");

const pad = (n: number) => String(n).padStart(2, "0");
const clockTime = (date = new Date()) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

const formatMb = (mb: number) => {
  if (!mb) return "0 MB";
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatRate = (bytesPerSecond: number) => {
  if (!bytesPerSecond) return "0 B/s";
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
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
  info: "text-zinc-400",
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

/** Commands offered as one-click chips under the stream. */
const QUICK_COMMANDS = ["list", "seed", "save-all", "whitelist list", "stop"];

interface StatsPayload {
  running: boolean;
  isRunning?: boolean;
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

/** Circular gauge: one arc, the value in the middle, no decoration. */
const Gauge: React.FC<{ value: number; tone?: string; size?: number }> = ({
  value,
  tone = "#fafafa",
  size = 44,
}) => {
  const clamped = Math.max(0, Math.min(100, value || 0));
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[0.56rem] font-semibold text-zinc-400">
        {Math.round(clamped)}%
      </span>
    </div>
  );
};

/** A telemetry tile: gauge, label + big value + limit, and a sparkline. */
const TelemetryTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  limit?: string;
  percent: number;
  tone: string;
  data: Array<Record<string, number>>;
  dataKey: string;
  max: number;
}> = ({ icon, label, value, unit, limit, percent, tone, data, dataKey, max }) => {
  const padded = useMemo(() => {
    const rows = [...data];
    while (rows.length < SPARK_CAP) {
      rows.unshift({ [dataKey]: 0 });
    }
    return rows;
  }, [data, dataKey]);

  return (
    <div className="flex items-center gap-3 border-b border-white/[0.05] px-3.5 py-3 last:border-b-0">
      <Gauge value={percent} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[0.58rem] font-bold uppercase tracking-[0.14em] text-zinc-600">
          <span className="text-zinc-700">{icon}</span>
          {label}
        </p>
        <p className="mt-0.5 truncate font-mono text-[1.02rem] font-semibold leading-tight text-zinc-100">
          {value}
          {unit && <span className="ml-0.5 text-[0.62rem] font-medium text-zinc-500">{unit}</span>}
        </p>
        {limit && <p className="truncate font-mono text-[0.56rem] text-zinc-700">{limit}</p>}
      </div>
      <div className="h-9 w-[74px] flex-none">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={padded} margin={{ top: 2, left: 0, right: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`tile-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity={0.35} />
                <stop offset="100%" stopColor={tone} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[0, max || "auto"]} hide />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={tone}
              strokeWidth={1.4}
              fill={`url(#tile-${dataKey})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
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
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compact, setCompact] = useState(false);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [cpuHist, setCpuHist] = useState<Array<Record<string, number>>>([]);
  const [ramHist, setRamHist] = useState<Array<Record<string, number>>>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const [now, setNow] = useState(() => clockTime());

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

  /* ---- roster ---- */
  const pullPlayers = useCallback(async () => {
    try {
      const data = await api<{ onlinePlayers?: string[] }>(`/servers/${server.id}/players`);
      setPlayers(data.onlinePlayers || []);
    } catch {
      /* keep the last roster */
    }
  }, [server.id]);

  useEffect(() => {
    pullPlayers();
    const timer = window.setInterval(pullPlayers, 10000);
    return () => window.clearInterval(timer);
  }, [pullPlayers]);

  /* ---- clock ---- */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(clockTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const uptimeSeconds = useMemo(() => {
    if (!isOnline || !stats?.startedAt) return 0;
    const started = new Date(stats.startedAt).getTime();
    if (Number.isNaN(started)) return stats.uptimeSeconds || 0;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [isOnline, stats?.startedAt, stats?.uptimeSeconds, now]);

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
  const send = async (raw?: string) => {
    const value = (raw ?? command).trim();
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

  const exportLogs = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${server.name.replace(/[^\w-]+/g, "-")}-console.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /* ---- derived ---- */
  const visible = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => stripAnsi(line).toLowerCase().includes(needle));
  }, [lines, filter]);

  const cpuLimit = stats?.limitCpu || server.cpu || 1;
  const ramLimit = stats?.limitRam || server.ram || 1024;
  const diskLimit = stats?.limitDisk || server.disk || 0;
  const cpuPct = Math.min(100, cpuLimit ? ((stats?.cpu || 0) / (cpuLimit * 100)) * 100 : 0);
  const ramPct = Math.min(100, ramLimit ? ((stats?.ram || 0) / ramLimit) * 100 : 0);
  const diskPct = Math.min(100, diskLimit ? ((stats?.disk || 0) / diskLimit) * 100 : 0);

  // A stable pseudo-id for the stream, derived from the server id — displayed
  // so an operator can tell two consoles apart in a screenshot.
  const streamId = useMemo(() => {
    const raw = String(server.id || "").replace(/[^\w]/g, "").slice(-12);
    return `${raw.slice(0, 4) || "srv"}-${raw.slice(4, 8) || "0000"}-${raw.slice(8, 12) || "0000"}`;
  }, [server.id]);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ══════════════════════════ left column: telemetry + players ═══════ */}
      <div className="flex flex-col gap-3">
        <div className="zk-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.055] px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.16em] text-zinc-400">
              <Activity size={11} className="text-brand-500" />
              Telemetry
            </span>
            <span className="font-mono text-[0.56rem] text-zinc-700">
              {isOnline ? formatUptime(uptimeSeconds) : "offline"}
            </span>
          </div>
          <TelemetryTile
            icon={<Cpu size={10} />}
            label="CPU load"
            value={isOnline ? (stats?.cpu ?? 0).toFixed(1) : "0.0"}
            unit="%"
            limit={`of ${(cpuLimit * 100).toFixed(0)}% allocated`}
            percent={isOnline ? cpuPct : 0}
            tone="#ff7a18"
            data={cpuHist}
            dataKey="cpu"
            max={Math.max(10, cpuLimit * 100)}
          />
          <TelemetryTile
            icon={<MemoryStick size={10} />}
            label="Memory"
            value={isOnline ? formatMb(stats?.ram ?? 0).replace(/ (MB|GB)$/, "") : "0"}
            unit={isOnline && (stats?.ram ?? 0) >= 1024 ? "GB" : "MB"}
            limit={`xmx ${formatMb(ramLimit)}`}
            percent={isOnline ? ramPct : 0}
            tone="#38bdf8"
            data={ramHist}
            dataKey="ram"
            max={ramLimit}
          />
          <TelemetryTile
            icon={<HardDrive size={10} />}
            label="Storage"
            value={((stats?.disk ?? 0) / 1024).toFixed(1)}
            unit="GB"
            limit={`cap ${(diskLimit / 1024).toFixed(1)} GB`}
            percent={diskPct}
            tone="#a78bfa"
            data={[]}
            dataKey="disk"
            max={100}
          />
        </div>

        <div className="zk-card flex min-h-[280px] flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.055] px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.16em] text-zinc-400">
              <Users size={11} className="text-brand-500" />
              Players
            </span>
            <span
              className={
                "rounded px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold " +
                (players.length
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "border border-white/[0.08] bg-white/[0.03] text-zinc-500")
              }
            >
              {players.length} online
            </span>
          </div>

          {players.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="relative">
                <Users size={30} className="text-zinc-800" strokeWidth={1.5} />
                <CircleSlash size={14} className="absolute -bottom-1 -right-1 text-zinc-700" />
              </div>
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-zinc-700">
                No players online
              </p>
              <p className="max-w-[190px] text-[0.62rem] leading-relaxed text-zinc-800">
                {isOnline ? "The roster updates within ten seconds of a join." : "Start the server to populate the roster."}
              </p>
            </div>
          ) : (
            <ul className="no-scrollbar flex-1 divide-y divide-white/[0.045] overflow-y-auto">
              {players.map((name) => (
                <li key={name} className="flex items-center gap-2.5 px-3.5 py-2">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded bg-white/[0.07] font-mono text-[0.58rem] font-bold uppercase text-zinc-300">
                    {name.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.72rem] text-zinc-300">{name}</span>
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-emerald-400" />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-white/[0.05] px-3.5 py-2 font-mono text-[0.56rem] text-zinc-700">
            <span>net ↓{formatRate(stats?.netInRate ?? 0)}</span>
            <span>↑{formatRate(stats?.netOutRate ?? 0)}</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════ right: system console ════════════ */}
      <div className="zk-console-shell flex min-h-[560px] flex-col overflow-hidden">
        {/* window chrome */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3.5 py-2.5">
          <span className="flex flex-none items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </span>

          <span className="ml-2 flex min-w-0 items-center gap-1.5">
            <TerminalSquare size={12} className="flex-none text-zinc-500" />
            <span className="truncate text-[0.62rem] font-bold uppercase tracking-[0.16em] text-zinc-300">
              System console
            </span>
          </span>

          <span className="hidden min-w-0 items-center gap-1.5 font-mono text-[0.56rem] text-zinc-700 md:flex">
            <span className="text-zinc-800">stream</span>
            <span className="truncate rounded border border-dashed border-white/[0.1] px-1.5 py-0.5 text-zinc-500">
              {streamId}
            </span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1 font-mono text-[0.58rem] text-zinc-600 sm:flex">
              <Clock size={10} />
              {now}
            </span>
            <span
              className={
                "flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.1em] " +
                (isOnline
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : isTransitioning
                  ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
                  : "border-white/[0.08] bg-white/[0.03] text-zinc-500")
              }
            >
              <Radio size={9} className={isOnline ? "text-emerald-400" : ""} />
              {isOnline ? "Live" : isTransitioning ? "Busy" : "Idle"}
            </span>

            <span className="mx-0.5 hidden h-4 w-px bg-white/[0.08] sm:block" />

            {showFilter ? (
              <div className="flex items-center gap-1 rounded border border-white/[0.08] bg-black/40 px-1.5">
                <Search size={10} className="text-zinc-600" />
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="filter"
                  className="w-20 bg-transparent py-0.5 font-mono text-[0.62rem] text-zinc-200 outline-none placeholder:text-zinc-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowFilter(false);
                    setFilter("");
                  }}
                  className="text-zinc-600 transition hover:text-zinc-200"
                >
                  <X size={10} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowFilter(true)}
                className="rounded p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                title="Filter output"
              >
                <Search size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setCompact((v) => !v)}
              className={"rounded p-1 transition hover:bg-white/5 hover:text-zinc-200 " + (compact ? "text-brand-400" : "text-zinc-600")}
              title={compact ? "Comfortable spacing" : "Compact spacing"}
            >
              <ScrollText size={12} />
            </button>
            <button
              type="button"
              onClick={copyLogs}
              className="rounded p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
              title="Copy console"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
            <button
              type="button"
              onClick={exportLogs}
              className="rounded p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
              title="Download log"
            >
              <Download size={12} />
            </button>
            <button
              type="button"
              onClick={clearConsole}
              className="rounded p-1 text-zinc-600 transition hover:bg-red-500/10 hover:text-red-300"
              title="Clear console"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* stream body */}
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-black/60 to-transparent" />
          <div
            ref={bodyRef}
            onScroll={onScroll}
            onClick={() => inputRef.current?.focus()}
            className={
              "zk-terminal h-full select-text overflow-y-auto overflow-x-hidden bg-transparent px-4 py-3.5 text-zinc-300 [overflow-wrap:anywhere] " +
              (compact ? "text-[11px] leading-[1.5]" : "text-[12px] leading-[1.75]")
            }
            style={{ minHeight: 380 }}
          >
            {visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 py-16 text-center">
                <TerminalSquare size={20} className="text-zinc-800" />
                <p className="text-[0.72rem] text-zinc-700">{filter ? "Nothing matches that filter." : "No output yet."}</p>
                <p className="text-[0.64rem] text-zinc-800">
                  {isOnline ? "Live output will appear here." : "Start the server to stream output."}
                </p>
              </div>
            ) : (
              visible.map((line, index) => {
                const kind = classify(line);
                const mark = LINE_MARK[kind];
                return (
                  <div key={`${index}-${line.slice(0, 12)}`} className={`group/mark flex min-w-0 items-start gap-2 ${LINE_TONE[kind]}`}>
                    <span className="w-3 flex-none select-none text-center text-[0.62rem] leading-[1.9] text-zinc-800">
                      {mark || ";"}
                    </span>
                    <span className="min-w-0 break-words">{stripAnsi(line)}</span>
                  </div>
                );
              })
            )}
          </div>

          {!atBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0e0e11]/95 px-2.5 py-1 text-[0.62rem] font-medium text-zinc-200 shadow-lg backdrop-blur transition hover:border-white/25 hover:text-white active:scale-95"
            >
              <ArrowDown size={11} className="animate-bounce text-brand-400" />
              Latest
            </button>
          )}
        </div>

        {/* quick commands */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.055] px-3.5 py-2">
          <span className="mr-1 text-[0.54rem] font-bold uppercase tracking-[0.16em] text-zinc-700">Quick command</span>
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => send(cmd)}
              disabled={!isOnline || sending}
              className="rounded border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[0.62rem] text-zinc-400 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {cmd}
            </button>
          ))}
          <span className="ml-auto hidden items-center gap-1 font-mono text-[0.54rem] text-zinc-800 sm:flex">
            <ArrowUp size={9} /> history
            <span className="mx-1">·</span>
            Ctrl+L clear
          </span>
        </div>

        {/* prompt */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-center gap-2 border-t border-white/[0.06] px-3.5 py-2.5"
        >
          <span className="flex-none select-none font-mono text-[0.72rem] text-zinc-600">
            <span className="text-brand-500">admin@node</span>
            <span className="text-zinc-700">:~$</span>
          </span>
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!isOnline}
            placeholder={isOnline ? "type a command…" : "server is offline"}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[0.76rem] text-zinc-100 outline-none placeholder:text-zinc-700 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!isOnline || !command.trim() || sending}
            className="flex flex-none items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.06] px-2.5 py-1.5 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            {sending ? <Loader2 size={11} className="zk-spin" /> : null}
            Execute
          </button>
        </form>
      </div>
    </div>
  );
};

export default ServerConsole;

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Terminal as TerminalIcon,
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
  ChevronRight,
  Trash2,
  Download,
  Search,
  X,
  Copy,
  Check,
  Signal,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { api, apiDownload } from "../../lib/api";
import { useServerSocket } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { formatUptime } from "../../lib/format";
import { Switch } from "../../components/ui";

/* ------------------------------------------------------------------ helpers */

const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (iso?: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatMb = (mb: number) => {
  if (!mb) return "0 MB";
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatRate = (bytesPerSecond: number) => {
  if (!bytesPerSecond) return "0 KB/s";
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

const LOG_CAP = 2000;
const SPARK_CAP = 36;

interface StatsPayload {
  running: boolean;
  simulated?: boolean;
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
  ramPercent?: number;
  cpuPercent?: number;
  diskPercent?: number;
  status: string;
  address: string;
  listeningPorts?: number[];
}

/* ------------------------------------------------------------------ pieces */

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  suffix?: React.ReactNode;
  hint?: React.ReactNode;
  accent?: string;
}> = ({ icon, label, value, suffix, hint, accent = "text-brand-400" }) => (
  <div className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-850/80 px-3.5 py-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
        <p className="mt-1 truncate font-display text-[0.95rem] font-bold text-zinc-50">
          {value}
          {suffix && <span className="ml-1 text-[0.66rem] font-medium text-zinc-500">{suffix}</span>}
        </p>
        {hint && <p className="mt-0.5 truncate text-[0.6rem] text-zinc-600">{hint}</p>}
      </div>
      <span className={`flex-none ${accent} opacity-70 transition-opacity group-hover:opacity-100`}>{icon}</span>
    </div>
  </div>
);

const SparkCard: React.FC<{
  title: string;
  data: { value: number }[];
  color: string;
  value: string;
  legend?: React.ReactNode;
  max?: number;
}> = ({ title, data, color, value, legend, max }) => {
  const padded = useMemo(() => {
    const rows = [...data];
    while (rows.length < SPARK_CAP) rows.unshift({ value: 0 });
    return rows;
  }, [data]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-850/80 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-zinc-500">{title}</p>
        <span className="flex items-center gap-2 text-[0.62rem] text-zinc-500">{legend}</span>
      </div>
      <p className="mt-1 font-display text-sm font-bold text-zinc-100">{value}</p>
      <div className="mt-2 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={padded} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${title.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis domain={[0, max || "auto"]} hide />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.8}
              fill={`url(#spark-${title.replace(/\W/g, "")})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ main console */

export const ServerConsole: React.FC<{ server: any; onStatus?: (status: string) => void; onRefresh?: () => void }> = ({
  server,
  onStatus,
  onRefresh,
}) => {
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
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [cpuHist, setCpuHist] = useState<{ value: number }[]>([]);
  const [ramHist, setRamHist] = useState<{ value: number }[]>([]);
  const [netHist, setNetHist] = useState<{ value: number }[]>([]);
  const [tick, setTick] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<number>(Date.now());

  const isOnline = stats?.running ?? server.status === "online";

  /* ---- initial backlog ---- */
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

  /* ---- stats polling ---- */
  const pullStats = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const data = await api<StatsPayload>(`/servers/${server.id}/stats`);
      setStats(data);
      setCpuHist((prev) => [...prev, { value: data.cpu || 0 }].slice(-SPARK_CAP));
      setRamHist((prev) => [...prev, { value: data.ram || 0 }].slice(-SPARK_CAP));
      setNetHist((prev) => [...prev, { value: Math.round(((data.netInRate || 0) + (data.netOutRate || 0)) / 1024) }].slice(-SPARK_CAP));
    } catch {
      /* keep the last sample */
    }
  }, [server.id]);

  useEffect(() => {
    pullStats();
    const timer = window.setInterval(pullStats, 3000);
    return () => window.clearInterval(timer);
  }, [pullStats]);

  /* ---- uptime ticker ---- */
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

  /* ---- render ---- */
  const visible = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => stripAnsi(line).toLowerCase().includes(needle));
  }, [lines, filter]);

  const errorCount = useMemo(() => lines.filter((l) => classify(l) === "error").length, [lines]);
  const warnCount = useMemo(() => lines.filter((l) => classify(l) === "warn").length, [lines]);

  const cpuLimit = stats?.limitCpu || server.cpu || 1;
  const ramLimit = stats?.limitRam || server.ram || 1024;

  const tone: Record<LineKind, string> = {
    info: "text-zinc-300",
    warn: "text-amber-300",
    error: "text-red-400",
    input: "text-brand-300",
    system: "text-sky-300",
    success: "text-emerald-300",
  };

  return (
    <div className="space-y-4">
      {/* power bar ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-ink-850/80 px-3 py-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              isOnline
                ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]"
                : stats?.status === "starting" || stats?.status === "stopping"
                ? "bg-amber-400"
                : "bg-zinc-600"
            }`}
          />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-zinc-300">
            {isOnline ? "Running" : stats?.status === "starting" ? "Starting" : stats?.status === "stopping" ? "Stopping" : "Offline"}
          </span>
          {stats?.simulated && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-amber-300">
              Emulated
            </span>
          )}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => act("start")}
            disabled={isOnline || busy === "start" || server.status === "suspended"}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[0.72rem] font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="Start server"
          >
            <Play size={13} className="fill-current" /> Start
          </button>
          <button
            type="button"
            onClick={() => act("restart")}
            disabled={!isOnline || busy === "restart"}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[0.72rem] font-semibold text-ink-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            title="Restart server"
          >
            <RotateCw size={13} /> Restart
          </button>
          <button
            type="button"
            onClick={() => act("stop")}
            disabled={!isOnline || busy === "stop"}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-[0.72rem] font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="Graceful stop"
          >
            <Square size={12} className="fill-current" /> Stop
          </button>
          <button
            type="button"
            onClick={() => act("kill")}
            disabled={!isOnline || busy === "kill"}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-red-950 px-3 text-[0.72rem] font-semibold text-red-200 transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40"
            title="Force kill (SIGKILL)"
          >
            <Power size={13} /> Kill
          </button>
        </div>
      </div>

      {/* console + stats ------------------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#07070a]">
          {/* header */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-ink-900/80 px-3 py-2">
            <TerminalIcon size={13} className="text-brand-400" />
            <span className="font-mono text-[0.7rem] font-semibold text-zinc-300">console</span>
            <span className="font-mono text-[0.62rem] text-zinc-600">{lines.length} lines</span>
            {errorCount > 0 && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[0.58rem] font-bold text-red-300">
                {errorCount} errors
              </span>
            )}
            {warnCount > 0 && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[0.58rem] font-bold text-amber-300">
                {warnCount} warnings
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {showFilter ? (
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-ink-850 px-2">
                  <Search size={11} className="text-zinc-500" />
                  <input
                    autoFocus
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter output"
                    className="w-28 bg-transparent py-1 font-mono text-[0.65rem] text-zinc-200 outline-none placeholder:text-zinc-600"
                  />
                  <button type="button" onClick={() => { setShowFilter(false); setFilter(""); }} className="text-zinc-500 hover:text-zinc-200">
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFilter(true)}
                  className="rounded p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                  title="Filter output"
                >
                  <Search size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={copyLogs}
                className="rounded p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                title="Copy console"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
              <button
                type="button"
                onClick={() => apiDownload(`/servers/${server.id}/logs?lines=10000`, `${server.name}-console.log`)}
                className="rounded p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                title="Download log"
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                onClick={clearConsole}
                className="rounded p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                title="Clear console"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {/* body */}
          <div className="relative flex-1">
            <div
              ref={bodyRef}
              onScroll={onScroll}
              onClick={() => inputRef.current?.focus()}
              className="zk-terminal absolute inset-0 overflow-y-auto px-3 py-2.5 font-mono text-[0.72rem] leading-[1.6]"
            >
              {visible.length === 0 && (
                <div className="space-y-1 text-zinc-600">
                  <p>{filter ? "No lines match that filter." : "Console is empty."}</p>
                  {!filter && <p>Start the server to stream live output here.</p>}
                </div>
              )}
              {visible.map((line, index) => {
                const kind = classify(line);
                return (
                  <div key={`${index}-${line.slice(0, 12)}`} className="group flex gap-2.5">
                    <span className="w-8 flex-none select-none text-right text-[0.62rem] text-zinc-700 group-hover:text-zinc-500">
                      {index + 1}
                    </span>
                    <span className={`min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${tone[kind]}`}>
                      {stripAnsi(line)}
                    </span>
                  </div>
                );
              })}
            </div>

            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-900/95 px-3 py-1.5 text-[0.62rem] font-medium text-zinc-200 shadow-xl backdrop-blur transition hover:bg-ink-800"
              >
                <ArrowDown size={11} className="animate-bounce text-emerald-400" /> Latest
              </button>
            )}
          </div>

          {/* input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-2 border-t border-white/[0.06] bg-ink-900/90 px-3 py-2"
          >
            <ChevronRight size={14} className={isOnline ? "text-emerald-400" : "text-zinc-600"} />
            <input
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!isOnline}
              placeholder={isOnline ? "Type a command — try 'tps', 'list' or 'help'" : "Start the server to send commands"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[0.75rem] text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!isOnline || !command.trim() || sending}
              className="rounded-md bg-brand-500 px-2.5 py-1 text-[0.65rem] font-bold text-ink-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Send
            </button>
          </form>
        </div>

        {/* sidebar */}
        <div className="space-y-2.5">
          <StatCard
            icon={<Signal size={15} />}
            label="Address"
            value={<span className="font-mono text-[0.8rem]">{server.ip === "0.0.0.0" ? "0.0.0.0" : server.ip}:{server.port}</span>}
            hint={stats?.listeningPorts?.length ? `listening on ${stats.listeningPorts.join(", ")}` : "port not bound"}
          />
          <StatCard icon={<Clock size={15} />} label="Uptime" value={isOnline ? formatUptime(uptimeSeconds) : "—"} hint={isOnline ? `PID ${stats?.pid ?? "—"}` : "server stopped"} />
          <StatCard
            icon={<Cpu size={15} />}
            label="CPU load"
            value={isOnline ? `${(stats?.cpu ?? 0).toFixed(1)}%` : "—"}
            suffix={isOnline ? `/ ${cpuLimit} cores` : undefined}
            hint={isOnline ? `${stats?.cpuPercent ?? 0}% of allocated share` : undefined}
          />
          <StatCard
            icon={<MemoryStick size={15} />}
            label="Memory"
            value={isOnline ? formatMb(stats?.ram ?? 0) : "—"}
            suffix={isOnline ? `/ ${formatMb(ramLimit)}` : undefined}
            hint={isOnline ? `${stats?.ramPercent ?? 0}% of heap limit` : undefined}
            accent="text-sky-400"
          />
          <StatCard
            icon={<HardDrive size={15} />}
            label="Disk"
            value={formatMb(stats?.disk ?? 0)}
            suffix={`/ ${formatMb(stats?.limitDisk ?? server.disk ?? 0)}`}
            hint={`${stats?.diskPercent ?? 0}% of quota`}
            accent="text-violet-400"
          />
          <StatCard
            icon={<ArrowDown size={15} />}
            label="Network in"
            value={isOnline ? formatRate(stats?.netInRate ?? 0) : "—"}
            hint={isOnline && stats?.netIn ? `${formatMb(stats.netIn / 1024 / 1024)} received` : undefined}
            accent="text-emerald-400"
          />
          <StatCard
            icon={<ArrowUp size={15} />}
            label="Network out"
            value={isOnline ? formatRate(stats?.netOutRate ?? 0) : "—"}
            hint={isOnline && stats?.netOut ? `${formatMb(stats.netOut / 1024 / 1024)} sent` : undefined}
            accent="text-amber-400"
          />
        </div>
      </div>

      {/* sparklines ------------------------------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SparkCard
          title="CPU %"
          data={cpuHist}
          color="#ff7a18"
          value={isOnline ? `${(stats?.cpu ?? 0).toFixed(1)}%` : "offline"}
          max={Math.max(10, cpuLimit * 100)}
        />
        <SparkCard
          title="Memory MB"
          data={ramHist}
          color="#38bdf8"
          value={isOnline ? formatMb(stats?.ram ?? 0) : "offline"}
          max={ramLimit}
        />
        <SparkCard
          title="Network KB/s"
          data={netHist}
          color="#34d399"
          value={isOnline ? formatRate((stats?.netInRate ?? 0) + (stats?.netOutRate ?? 0)) : "offline"}
          legend={
            <>
              <span className="flex items-center gap-1"><ArrowDown size={9} className="text-emerald-400" />in</span>
              <span className="flex items-center gap-1"><ArrowUp size={9} className="text-amber-400" />out</span>
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[0.62rem] text-zinc-600">
        <span className="flex items-center gap-1.5"><Wifi size={11} /> live via WebSocket</span>
        <span className="flex items-center gap-1.5">
          <span className="zk-kbd">↑</span><span className="zk-kbd">↓</span> history
        </span>
        <span className="flex items-center gap-1.5"><span className="zk-kbd">ctrl</span><span className="zk-kbd">L</span> clear</span>
        <div className="ml-auto flex items-center gap-2">
          <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto-scroll" />
          <span className="text-zinc-600">{clock(stats?.startedAt)}</span>
        </div>
      </div>
    </div>
  );
};

export default ServerConsole;

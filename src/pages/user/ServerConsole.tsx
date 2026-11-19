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

/**
 * Server console — JTG-parity layout.
 * ---------------------------------------------------------------------------
 * Structure matches the JTG panel exactly:
 *   • status orb + server name, with round Start / Restart / Stop / Kill buttons
 *   • a tall monospace console beside a column of stat tiles
 *     (address, uptime, CPU, memory, disk, network in/out)
 *   • three area charts underneath: CPU %, memory MB, network KB/s
 *
 * Numbers are the node's real measurements; nothing is synthesised.
 */

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
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatRateKb = (kbPerSecond: number) => {
  if (!kbPerSecond) return "0 KB/s";
  if (kbPerSecond < 1024) return `${kbPerSecond.toFixed(1)} KB/s`;
  return `${(kbPerSecond / 1024).toFixed(2)} MB/s`;
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
const CHART_CAP = 30;

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
  ramPercent?: number;
  cpuPercent?: number;
  diskPercent?: number;
  status: string;
  address: string;
  listeningPorts?: number[];
}

/* --------------------------------------------------------------- JTG tiles */

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  dim?: React.ReactNode;
}> = ({ icon, label, value, dim }) => (
  <div className="group relative flex min-h-[84px] flex-col justify-center overflow-hidden rounded-[10px] bg-[#131010] py-4 pl-[92px] pr-[18px] transition-colors hover:bg-[#1c1818]">
    <div className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 -rotate-[20deg] text-[#242121] opacity-90 transition-all duration-300 group-hover:scale-110 group-hover:text-[#2f2a2a]">
      {icon}
    </div>
    <div className="relative z-10 mb-1.5 text-[13px] text-[#9a9a9a]">{label}</div>
    <div className="relative z-10 overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-bold text-white">
      {value}
      {dim && <span className="ml-1 text-[13px] font-normal text-[#6f6f6f]">{dim}</span>}
    </div>
  </div>
);

const ChartCard: React.FC<{
  title: string;
  data: Array<Record<string, number>>;
  dataKey: string;
  dataKey2?: string;
  max?: number;
  colors: [string, string];
  icons?: React.ReactNode;
}> = ({ title, data, dataKey, dataKey2, max, colors, icons }) => {
  const padded = useMemo(() => {
    const rows = [...data];
    while (rows.length < CHART_CAP) {
      rows.unshift({ [dataKey]: 0, ...(dataKey2 ? { [dataKey2]: 0 } : {}) });
    }
    return rows;
  }, [data, dataKey, dataKey2]);

  return (
    <div className="rounded-[10px] bg-[#131010] px-5 py-[18px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[15px] font-bold text-white">{title}</div>
        {icons && <div className="flex items-center gap-[9px]">{icons}</div>}
      </div>
      <div className="relative h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={padded} margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[0]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors[0]} stopOpacity={0.03} />
              </linearGradient>
              {dataKey2 && (
                <linearGradient id={`fill-${dataKey2}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[1]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={colors[1]} stopOpacity={0.03} />
                </linearGradient>
              )}
            </defs>
            <YAxis domain={[0, max || "auto"]} hide />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={colors[0]}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#fill-${dataKey})`}
              isAnimationActive={false}
              dot={false}
            />
            {dataKey2 && (
              <Area
                type="monotone"
                dataKey={dataKey2}
                stroke={colors[1]}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#fill-${dataKey2})`}
                isAnimationActive={false}
                dot={false}
              />
            )}
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
  const [cpuHist, setCpuHist] = useState<Array<Record<string, number>>>([]);
  const [ramHist, setRamHist] = useState<Array<Record<string, number>>>([]);
  const [netHist, setNetHist] = useState<Array<Record<string, number>>>([]);
  const [tick, setTick] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<string | null | undefined>(server?.startedAt);

  const isOnline = stats?.isRunning ?? stats?.running ?? server.status === "online";

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

  /* ---- stats polling (JTG: every 3s, paused when the tab is hidden) ---- */
  const pullStats = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const data = await api<StatsPayload>(`/servers/${server.id}/stats`);
      setStats(data);
      setCpuHist((prev) => [...prev, { cpu: Math.round((data.cpu || 0) * 10) / 10 }].slice(-CHART_CAP));
      setRamHist((prev) => [...prev, { ram: Math.round(data.ram || 0) }].slice(-CHART_CAP));
      setNetHist((prev) =>
        [
          ...prev,
          {
            netIn: Math.round(((data.netInRate || 0) / 1024) * 10) / 10,
            netOut: Math.round(((data.netOutRate || 0) / 1024) * 10) / 10,
          },
        ].slice(-CHART_CAP)
      );
      // A new session (restart) starts a fresh console, exactly like JTG.
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

  /* ---- render ---- */
  const visible = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => stripAnsi(line).toLowerCase().includes(needle));
  }, [lines, filter]);

  const cpuLimit = stats?.limitCpu || server.cpu || 1;
  const ramLimit = stats?.limitRam || server.ram || 1024;
  const diskLimit = stats?.limitDisk || server.disk || 0;

  const tone: Record<LineKind, string> = {
    info: "text-zinc-300",
    warn: "text-amber-300",
    error: "text-red-400",
    input: "text-brand-300",
    system: "text-sky-300",
    success: "text-emerald-300",
  };

  const statusLabel = isOnline
    ? "Running"
    : stats?.status === "starting"
    ? "Starting"
    : stats?.status === "stopping"
    ? "Stopping"
    : "Offline";

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------- top bar (JTG) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`h-[11px] w-[11px] shrink-0 rounded-full ${
              isOnline
                ? "bg-[#42e33d] shadow-[0_0_10px_rgba(66,227,61,0.55)]"
                : stats?.status === "starting" || stats?.status === "stopping"
                ? "animate-pulse bg-[#e8bd15]"
                : "bg-[#524b4b]"
            }`}
          />
          <h2 className="truncate text-xl font-extrabold text-white">{server.name}</h2>
          <span className="rounded-full border border-white/[0.07] bg-white/[0.02] px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-zinc-400">
            {statusLabel}
          </span>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-2.5">
          <button
            type="button"
            onClick={() => act("start")}
            disabled={isOnline || busy === "start" || server.status === "suspended"}
            title="Start"
            className="flex h-[42px] min-w-[62px] flex-1 items-center justify-center rounded-full bg-[#4CAF50] text-white transition-all hover:-translate-y-px hover:brightness-110 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 sm:h-[46px] sm:min-w-[86px] sm:flex-initial"
          >
            <Play size={18} className="fill-current" />
          </button>
          <button
            type="button"
            onClick={() => act("restart")}
            disabled={!isOnline || busy === "restart"}
            title="Restart"
            className="flex h-[42px] min-w-[62px] flex-1 items-center justify-center rounded-full bg-[#e8bd15] text-white transition-all hover:-translate-y-px hover:brightness-110 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 sm:h-[46px] sm:min-w-[86px] sm:flex-initial"
          >
            <RotateCw size={18} />
          </button>
          <button
            type="button"
            onClick={() => act("stop")}
            disabled={!isOnline || busy === "stop"}
            title="Graceful stop"
            className="flex h-[42px] min-w-[62px] flex-1 items-center justify-center rounded-full bg-[#fb4242] text-white transition-all hover:-translate-y-px hover:brightness-110 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 sm:h-[46px] sm:min-w-[86px] sm:flex-initial"
          >
            <Square size={17} className="fill-current" />
          </button>
          <button
            type="button"
            onClick={() => act("kill")}
            disabled={!isOnline || busy === "kill"}
            title="Force kill (SIGKILL)"
            className="flex h-[42px] min-w-[62px] flex-1 items-center justify-center rounded-full bg-[#7f1d1d] text-white transition-all hover:-translate-y-px hover:bg-[#991b1b] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 sm:h-[46px] sm:min-w-[86px] sm:flex-initial"
          >
            <Power size={18} />
          </button>
        </div>
      </div>

      {/* ------------------------------------------- console + stat tiles */}
      <div className="grid grid-cols-1 gap-[22px] xl:grid-cols-[1fr_320px]">
        {/* console */}
        <div className="flex h-[420px] flex-col overflow-hidden rounded-[10px] bg-[#131010] sm:h-[520px] xl:h-[700px]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#232020] bg-[#191717] px-3.5 py-2">
            <TerminalIcon size={13} className="text-[#8a8a8a]" />
            <span className="font-mono text-[0.7rem] font-semibold text-[#c9c9c9]">console</span>
            <span className="font-mono text-[0.62rem] text-[#5c5c5c]">{lines.length} lines</span>
            <div className="ml-auto flex items-center gap-1">
              {showFilter ? (
                <div className="flex items-center gap-1 rounded-md border border-[#2a2626] bg-[#0d0c0c] px-2">
                  <Search size={11} className="text-[#5c5c5c]" />
                  <input
                    autoFocus
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter output"
                    className="w-28 bg-transparent py-1 font-mono text-[0.65rem] text-zinc-200 outline-none placeholder:text-[#5c5c5c]"
                  />
                  <button type="button" onClick={() => { setShowFilter(false); setFilter(""); }} className="text-[#5c5c5c] hover:text-zinc-200">
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowFilter(true)} className="rounded p-1.5 text-[#5c5c5c] transition hover:bg-white/5 hover:text-zinc-200" title="Filter output">
                  <Search size={13} />
                </button>
              )}
              <button type="button" onClick={copyLogs} className="rounded p-1.5 text-[#5c5c5c] transition hover:bg-white/5 hover:text-zinc-200" title="Copy console">
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
              <button
                type="button"
                onClick={() => apiDownload(`/servers/${server.id}/logs?lines=10000`, `${server.name}-console.log`)}
                className="rounded p-1.5 text-[#5c5c5c] transition hover:bg-white/5 hover:text-zinc-200"
                title="Download log"
              >
                <Download size={13} />
              </button>
              <button type="button" onClick={clearConsole} className="rounded p-1.5 text-[#5c5c5c] transition hover:bg-white/5 hover:text-zinc-200" title="Clear console">
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          <div className="relative flex-1">
            <div
              ref={bodyRef}
              onScroll={onScroll}
              onClick={() => inputRef.current?.focus()}
              className="absolute inset-0 select-text overflow-y-auto overflow-x-hidden bg-[#0d0c0c] px-3.5 py-3 font-mono text-[12.5px] leading-[1.62] text-[#c9c9c9] [overflow-wrap:anywhere]"
            >
              {visible.length === 0 && (
                <div className="space-y-1 text-[#5c5c5c]">
                  <p>{filter ? "No lines match that filter." : "Console is empty."}</p>
                  {!filter && <p>Start the server to stream live output here.</p>}
                </div>
              )}
              {visible.map((line, index) => (
                <div key={`${index}-${line.slice(0, 12)}`} className={`mb-px min-w-0 break-words ${tone[classify(line)]}`}>
                  {stripAnsi(line)}
                </div>
              ))}
            </div>

            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-[60px] right-3 z-20 flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/95 px-3 py-1.5 text-[11px] font-medium text-zinc-200 shadow-xl backdrop-blur-md transition hover:bg-zinc-800 active:scale-95"
                title="Scroll to bottom"
              >
                <ArrowDown className="h-3.5 w-3.5 animate-bounce text-emerald-400" />
                <span>Scroll to bottom</span>
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex shrink-0 items-center gap-2.5 border-t border-[#232020] bg-[#191717] px-3.5 py-3"
          >
            <ChevronRight size={16} className={isOnline ? "text-[#8a8a8a]" : "text-[#4a4444]"} />
            <input
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!isOnline}
              placeholder={isOnline ? "Type a command..." : "Start the server to send commands"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[#e9eaee] outline-none placeholder:text-[#5c5c5c] disabled:cursor-not-allowed"
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

        {/* stat tiles */}
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 xl:flex xl:flex-col">
          <StatTile
            icon={<Wifi style={{ width: 56, height: 56 }} />}
            label="Address"
            value={<span className="font-mono">{server.ip === "0.0.0.0" ? "0.0.0.0" : server.ip}:{server.port}</span>}
          />
          <StatTile icon={<Clock style={{ width: 56, height: 56 }} />} label="Uptime" value={isOnline ? formatUptime(uptimeSeconds) : "—"} />
          <StatTile
            icon={<Cpu style={{ width: 56, height: 56 }} />}
            label="CPU Load"
            value={isOnline ? `${(stats?.cpu ?? 0).toFixed(2)}%` : "—"}
            dim={isOnline ? `/ ${cpuLimit * 100}%` : undefined}
          />
          <StatTile
            icon={<MemoryStick style={{ width: 56, height: 56 }} />}
            label="Memory"
            value={isOnline ? formatMb(stats?.ram ?? 0) : "—"}
            dim={isOnline ? `/ ${formatMb(ramLimit)}` : undefined}
          />
          <StatTile
            icon={<HardDrive style={{ width: 56, height: 56 }} />}
            label="Disk"
            value={formatMb(stats?.disk ?? 0)}
            dim={diskLimit ? `/ ${formatMb(diskLimit)}` : undefined}
          />
          <StatTile
            icon={<ArrowDown style={{ width: 56, height: 56 }} />}
            label="Network (Inbound)"
            value={isOnline ? `↓ ${formatRate(stats?.netInRate ?? 0)}` : "—"}
          />
          <StatTile
            icon={<ArrowUp style={{ width: 56, height: 56 }} />}
            label="Network (Outbound)"
            value={isOnline ? `↑ ${formatRate(stats?.netOutRate ?? 0)}` : "—"}
          />
        </div>
      </div>

      {/* -------------------------------------------------- charts (JTG) */}
      <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-3">
        <ChartCard
          title="CPU Load (%)"
          data={cpuHist}
          dataKey="cpu"
          max={Math.max(10, cpuLimit * 100)}
          colors={["#22d3ee", "#e8bd15"]}
        />
        <ChartCard title="Memory (MB)" data={ramHist} dataKey="ram" max={ramLimit} colors={["#22d3ee", "#e8bd15"]} />
        <ChartCard
          title="Network (KB/s)"
          data={netHist}
          dataKey="netIn"
          dataKey2="netOut"
          colors={["#22d3ee", "#e8bd15"]}
          icons={
            <>
              <ArrowDown className="h-3 w-3 text-[#22d3ee]" />
              <ArrowUp className="h-3 w-3 text-[#e8bd15]" />
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[0.62rem] text-zinc-600">
        <span className="flex items-center gap-1.5">
          <Signal size={11} /> live via WebSocket
        </span>
        <span className="flex items-center gap-1.5">
          <span className="zk-kbd">↑</span>
          <span className="zk-kbd">↓</span> history
        </span>
        <span className="flex items-center gap-1.5">
          <span className="zk-kbd">ctrl</span>
          <span className="zk-kbd">L</span> clear
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto-scroll" />
          <span className="text-zinc-600">{clock(stats?.startedAt)}</span>
        </div>
      </div>
    </div>
  );
};

export default ServerConsole;

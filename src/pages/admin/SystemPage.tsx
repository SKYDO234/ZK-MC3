import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  HardDrive,
  MemoryStick,
  Play,
  Power,
  RefreshCw,
  ScrollText,
  Server,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, Button, Badge, Progress, PageSkeleton, ResourceMeter, StatCard } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { formatUptime, relativeTime } from "../../lib/format";

interface HealthPayload {
  system: any;
  software: {
    java: { installed: boolean; version: string; path: string | null };
    node: { installed: boolean; version: string; path: string };
    docker: { installed: boolean; version: string; socket: boolean };
    internet: { online: boolean };
    python: { installed: boolean };
    git: { installed: boolean };
    pm2: { installed: boolean };
  };
  process: { pid: number; uptime: number; memoryMb: number; nodeVersion: string; platform: string; cwd: string };
}

const Check: React.FC<{ ok: boolean; label: string; detail?: string }> = ({ ok, label, detail }) => (
  <div className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
    {ok ? (
      <CheckCircle2 size={14} className="mt-0.5 flex-none text-emerald-400" />
    ) : (
      <XCircle size={14} className="mt-0.5 flex-none text-zinc-600" />
    )}
    <div className="min-w-0">
      <p className="text-[0.76rem] font-medium text-zinc-200">{label}</p>
      <p className="truncate text-[0.64rem] text-zinc-500">{detail || (ok ? "available" : "not detected")}</p>
    </div>
  </div>
);

export const SystemPage: React.FC = () => {
  useDocumentTitle("System · ZK-MC3-PANEL");
  const { success, error, confirm } = useToast();
  const { data: health, reload: reloadHealth } = useApi<HealthPayload>("/admin/health");
  const { data: dashboard, reload: reloadDashboard } = useApi<any>("/admin/dashboard");
  const [logs, setLogs] = useState<string[]>([]);
  const [crashLog, setCrashLog] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const pullLogs = useCallback(async () => {
    try {
      const data = await api<{ lines: string[]; crashLog: string | null }>("/admin/system/logs", { query: { limit: 300 } });
      setLogs(data.lines || []);
      setCrashLog(data.crashLog);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    pullLogs();
    if (!autoRefresh) return;
    const timer = window.setInterval(pullLogs, 4000);
    return () => window.clearInterval(timer);
  }, [pullLogs, autoRefresh]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const runAction = async (action: string, label: string) => {
    const needsConfirm = ["stop-all", "restart-panel", "clear-logs"].includes(action);
    if (needsConfirm) {
      const ok = await confirm({
        title: `${label}?`,
        message:
          action === "stop-all"
            ? "Every running game server will be stopped gracefully."
            : action === "restart-panel"
            ? "The panel process exits and must be respawned by your process manager (systemd/pm2)."
            : "Console history for all servers will be erased.",
        danger: action !== "clear-logs",
        confirmLabel: label,
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const result = await api<{ message?: string; results?: any[]; cleared?: number; stopped?: number }>("/admin/system/action", {
        method: "POST",
        body: { action },
      });
      if (action === "backup-all") {
        const okCount = (result.results || []).filter((r) => r.ok).length;
        success("Backup complete", `${okCount}/${result.results?.length || 0} servers archived.`);
      } else if (action === "stop-all") {
        success("Servers stopped", `${result.stopped || 0} server(s) shut down.`);
      } else {
        success(label + " requested", result.message || "Done.");
      }
      reloadHealth();
      reloadDashboard();
      pullLogs();
    } catch (err: any) {
      error(`${label} failed`, err.message);
    } finally {
      setBusy("");
    }
  };

  const exportData = async () => {
    try {
      const data = await api<any>("/admin/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `zk-mc3-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      success("Export downloaded");
    } catch (err: any) {
      error("Export failed", err.message);
    }
  };

  const system = health?.system || dashboard?.system;
  const software = health?.software;

  const errorLines = useMemo(() => logs.filter((l) => l.includes("[error]")).length, [logs]);

  if (!health) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Wrench size={20} />}
        breadcrumb={[{ label: "Admin", to: "/admin" }, { label: "System" }]}
        title="System"
        subtitle="Platform health, maintenance actions and the panel's own runtime"
        actions={
          <>
            <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => { reloadHealth(); pullLogs(); }}>
              Refresh
            </Button>
            <Button size="sm" icon={<Download size={13} />} onClick={exportData}>
              Export data
            </Button>
          </>
        }
      />

      {/* gauges */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Cpu size={18} />}
          label="CPU load"
          value={`${system?.loadPercent ?? 0}%`}
          hint={`${system?.cpuCores ?? 0} cores · ${system?.cpuModel ?? "unknown"}`}
        />
        <StatCard
          icon={<MemoryStick size={18} />}
          label="Memory"
          value={`${system?.memoryPercent ?? 0}%`}
          hint={`${system?.memoryUsedMb ?? 0} / ${system?.memoryTotalMb ?? 0} MB`}
        />
        <StatCard
          icon={<HardDrive size={18} />}
          label="Disk"
          value={`${system?.diskPercent ?? 0}%`}
          hint={`${system?.diskUsedMb ?? 0} / ${system?.diskTotalMb ?? 0} MB`}
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Panel uptime"
          value={formatUptime(health.process.uptime)}
          hint={`PID ${health.process.pid} · RSS ${health.process.memoryMb} MB`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* platform console */}
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <Terminal size={14} className="text-brand-400" />
            <span className="text-[0.8rem] font-semibold text-zinc-200">Platform console</span>
            <Badge tone={errorLines ? "warn" : "online"} dot>
              {logs.length} lines{errorLines ? ` · ${errorLines} errors` : ""}
            </Badge>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoRefresh((v) => !v)}
                className={`rounded-md px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-wide ${
                  autoRefresh ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-zinc-500"
                }`}
              >
                {autoRefresh ? "live" : "paused"}
              </button>
              <Button size="sm" icon={<Trash2 size={12} />} onClick={() => runAction("clear-logs", "Clear all logs")} loading={busy === "clear-logs"}>
                Clear
              </Button>
            </div>
          </div>
          <div ref={logRef} className="zk-terminal h-[420px] overflow-y-auto px-3 py-2.5 font-mono text-[0.7rem] leading-[1.6]">
            {logs.length === 0 && <p className="text-zinc-600">No panel output captured yet.</p>}
            {logs.map((line, index) => (
              <div
                key={index}
                className={
                  line.includes("[error]")
                    ? "text-red-400"
                    : line.includes("[warn]")
                    ? "text-amber-300"
                    : "text-zinc-300"
                }
              >
                <span className="mr-2 select-none text-zinc-700">{String(index + 1).padStart(3, "0")}</span>
                {line}
              </div>
            ))}
          </div>
        </Card>

        {/* maintenance */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Maintenance" subtitle="One-click platform operations" icon={<Wrench size={16} />} />
            <div className="mt-3 space-y-2">
              <Button
                className="w-full justify-start"
                icon={<Archive size={14} />}
                loading={busy === "backup-all"}
                onClick={() => runAction("backup-all", "Back up all servers")}
              >
                Back up all servers
              </Button>
              <Button
                className="w-full justify-start"
                icon={<Power size={14} />}
                loading={busy === "stop-all"}
                onClick={() => runAction("stop-all", "Stop all servers")}
              >
                Stop all game servers
              </Button>
              <Button
                className="w-full justify-start"
                icon={<Database size={14} />}
                loading={busy === "clear-cache"}
                onClick={() => runAction("clear-cache", "Purge upload cache")}
              >
                Purge upload cache
              </Button>
              <Button
                className="w-full justify-start"
                variant="danger"
                icon={<RefreshCw size={14} />}
                loading={busy === "restart-panel"}
                onClick={() => runAction("restart-panel", "Restart the panel")}
              >
                Restart panel service
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Runtime checks" subtitle="What this node can execute" icon={<Server size={16} />} />
            <div className="mt-3 space-y-2">
              <Check
                ok={Boolean(software?.java.installed)}
                label="Java runtime"
                detail={software?.java.installed ? `${software.java.version}` : "install OpenJDK 21 to run real Minecraft jars"}
              />
              <Check ok={Boolean(software?.node.installed)} label="Node.js" detail={software?.node.version} />
              <Check ok={Boolean(software?.python.installed)} label="Python 3" />
              <Check ok={Boolean(software?.git.installed)} label="Git" />
              <Check ok={Boolean(software?.docker.installed)} label="Docker" detail={software?.docker.version} />
              <Check ok={Boolean(software?.internet.online)} label="Outbound internet" detail="needed for jar and plugin downloads" />
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Host" subtitle="Where this panel is running" icon={<Server size={16} />} />
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.74rem]">
            {[
              ["Hostname", system?.hostname],
              ["Platform", `${system?.platform} · ${system?.arch}`],
              ["Node version", health.process.nodeVersion],
              ["Working dir", health.process.cwd],
              ["Uptime", formatUptime(system?.uptime ?? 0)],
              ["Last check", relativeTime(new Date().toISOString())],
            ].map(([label, value]) => (
              <React.Fragment key={String(label)}>
                <dt className="text-zinc-500">{label}</dt>
                <dd className="truncate text-right font-mono text-[0.7rem] text-zinc-300">{String(value || "—")}</dd>
              </React.Fragment>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Capacity" subtitle="Allocation across the fleet" icon={<Cpu size={16} />} />
          <div className="mt-3 space-y-3">
            <ResourceMeter
              label="RAM allocated"
              used={dashboard?.resources?.ramAllocated ?? 0}
              total={dashboard?.resources?.ramLimit ?? 1}
              formatter={(n) => `${Math.round(n / 1024)} GB`}
            />
            <ResourceMeter
              label="CPU cores allocated"
              used={dashboard?.resources?.cpuAllocated ?? 0}
              total={dashboard?.resources?.cpuLimit ?? 1}
              formatter={(n) => `${n}`}
            />
            <ResourceMeter
              label="Disk allocated"
              used={dashboard?.resources?.diskAllocated ?? 0}
              total={dashboard?.resources?.diskLimit ?? 1}
              formatter={(n) => `${Math.round(n / 1024)} GB`}
            />
          </div>
          {crashLog && (
            <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2">
              <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-red-300">
                <AlertTriangle size={12} /> Last crash report
              </p>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[0.62rem] text-red-200/80">{crashLog.slice(0, 600)}</pre>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default SystemPage;

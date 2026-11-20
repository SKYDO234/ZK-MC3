import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Server,
  PlayCircle,
  PauseCircle,
  Cpu,
  MemoryStick,
  HardDrive,
  Rocket,
  Terminal,
  ArrowUpRight,
  Activity,
  Bell,
  Plus,
  RefreshCw,
  Clock,
  ShieldCheck,
  Zap,
  Gauge,
  Network,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, StatCard, Progress, Button, EmptyState, PageSkeleton, ResourceMeter } from "../../components/ui";
import { StatusPill } from "../../components/StatusPill";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { formatMb, formatUptime, relativeTime, pct } from "../../lib/format";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  server: <Server size={13} />,
  auth: <ShieldCheck size={13} />,
  backup: <HardDrive size={13} />,
  api: <Zap size={13} />,
  admin: <Gauge size={13} />,
  node: <Network size={13} />,
};

export const UserDashboard: React.FC = () => {
  useDocumentTitle("Dashboard · ZK-MC3-PANEL");
  const { user } = useAuth();
  const { settings } = useSettings();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const { data, loading, reload } = useApi<any>("/system/dashboard");
  const { data: activity } = useApi<any[]>("/system/activity");
  const { data: notifications } = useApi<any[]>("/system/notifications");

  const servers = data?.servers || [];
  const counts = data?.counts || { total: 0, online: 0, offline: 0, installing: 0 };
  const usage = data?.usage || { ramAllocated: 0, ramUsed: 0, cpuAllocated: 0, cpuUsed: 0, diskAllocated: 0, diskUsed: 0 };
  const system = data?.system;

  const quickAction = async (serverId: string, action: "start" | "stop" | "restart") => {
    try {
      await api(`/servers/${serverId}/${action}`, { method: "POST" });
      success(`Server ${action === "stop" ? "stopping" : action === "start" ? "starting" : "restarting"}`, "Live status will update automatically.");
      setTimeout(reload, 1200);
    } catch (err: any) {
      error("Action failed", err.message);
    }
  };

  const unread = (notifications || []).filter((n) => !n.read).slice(0, 3);
  const topServers = useMemo(() => servers.slice(0, 4), [servers]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Gauge size={20} />}
        title="Dashboard"
        subtitle={`Welcome back, ${user?.name?.split(" ")[0] || user?.username}. Here's your live server overview.`}
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={reload} size="sm">
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={15} />}
              onClick={() => navigate(settings.allowUserServerCreation ? "/admin/create-server" : "/servers")}
            >
              New Server
            </Button>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total servers"
          value={counts.total}
          icon={<Server size={14} />}
          tone="blue"
          hint={`In your account`}
          footer={
            <div className="flex gap-1">
              {servers.slice(0, 8).map((s: any) => (
                <span
                  key={s.id}
                  title={s.name}
                  className={`h-1.5 flex-1 rounded-full ${s.status === "online" ? "bg-emerald-400" : "bg-white/12"}`}
                />
              ))}
            </div>
          }
        />
        <StatCard
          label="Running"
          value={counts.online}
          icon={<PlayCircle size={14} />}
          tone="green"
          hint={`Active processes`}
        />
        <StatCard
          label="Offline"
          value={counts.offline}
          icon={<PauseCircle size={14} />}
          tone="red"
          hint={counts.installing ? `${counts.installing} installing` : "Not running"}
        />
        <StatCard
          label="RAM allocation"
          value={formatMb(usage.ramAllocated)}
          icon={<MemoryStick size={14} />}
          tone="brand"
          hint={`${formatMb(usage.ramUsed)} in use`}
          footer={<Progress value={pct(usage.ramUsed, Math.max(1, usage.ramAllocated))} />}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Servers grid */}
        <Card className="xl:col-span-2" padded={false}>
          <div className="p-5">
            <CardHeader
              title="My servers"
              subtitle="Live status, resource usage and quick power actions"
              icon={<Server size={16} />}
              action={
                <Link to="/servers" className="zk-btn zk-btn-ghost zk-btn-sm">
                  View all <ArrowUpRight size={13} />
                </Link>
              }
            />
          </div>
          <div className="px-2 pb-2">
            {topServers.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<Server size={22} />}
                  title="No servers yet"
                  message="Your hosting journey starts with a single click. Ask an administrator to provision a server for you, or deploy one instantly if self-service creation is enabled."
                  action={
                    <Button variant="primary" icon={<Rocket size={15} />} onClick={() => navigate("/servers")}>
                      Get started
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {topServers.map((server: any) => (
                  <div
                    key={server.id}
                    className="flex flex-wrap items-center gap-4 px-3 py-3.5 transition hover:bg-white/[0.025]"
                  >
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-400">
                      <Server size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/servers/${server.id}`}
                          className="truncate text-[0.86rem] font-semibold text-zinc-100 hover:text-brand-300"
                        >
                          {server.name}
                        </Link>
                        <StatusPill status={server.status} />
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[0.68rem] text-zinc-500">
                        {server.software} {server.version} · port {server.port} · {server.nodeId}
                      </p>
                    </div>
                    <div className="hidden w-32 lg:block">
                      <div className="mb-1 flex justify-between text-[0.62rem] text-zinc-500">
                        <span>CPU</span>
                        <span className="font-mono">{server.cpuUsage?.toFixed?.(1) || 0}%</span>
                      </div>
                      <Progress value={Math.min(100, server.cpuUsage || 0)} />
                    </div>
                    <div className="hidden w-32 lg:block">
                      <div className="mb-1 flex justify-between text-[0.62rem] text-zinc-500">
                        <span>RAM</span>
                        <span className="font-mono">
                          {formatMb(server.ramUsage || 0)} / {formatMb(server.ram)}
                        </span>
                      </div>
                      <Progress value={pct(server.ramUsage || 0, server.ram)} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {server.status === "online" ? (
                        <Button
                          size="sm"
                          onClick={() => quickAction(server.id, "stop")}
                          icon={<PauseCircle size={13} />}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => quickAction(server.id, "start")}
                          icon={<PlayCircle size={13} />}
                          disabled={server.status === "installing" || server.status === "suspended"}
                        >
                          Start
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Terminal size={13} />}
                        onClick={() => navigate(`/servers/${server.id}`)}
                      >
                        Manage
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* System + resources */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Resource usage" subtitle="Live allocation across your servers" icon={<Cpu size={16} />} />
            <div className="mt-4 space-y-4">
              <ResourceMeter
                label="CPU cores"
                used={Number((usage.cpuUsed || 0).toFixed?.(2) ?? usage.cpuUsed ?? 0)}
                total={usage.cpuAllocated || 1}
                formatter={(n) => `${n}`}
                icon={<Cpu size={12} />}
              />
              <ResourceMeter
                label="Memory"
                used={usage.ramUsed}
                total={Math.max(usage.ramAllocated, 1)}
                formatter={formatMb}
                icon={<MemoryStick size={12} />}
              />
              <ResourceMeter
                label="Disk"
                used={usage.diskUsed}
                total={Math.max(usage.diskAllocated, 1)}
                formatter={formatMb}
                icon={<HardDrive size={12} />}
              />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="zk-inset p-3">
                <p className="text-[0.62rem] uppercase tracking-wider text-zinc-500">Server slots</p>
                <p className="mt-1 font-display text-sm font-bold text-zinc-100">
                  {counts.total}
                  <span className="text-zinc-600"> / {data?.limits?.maxServers ?? 5}</span>
                </p>
              </div>
              <div className="zk-inset p-3">
                <p className="text-[0.62rem] uppercase tracking-wider text-zinc-500">Node uptime</p>
                <p className="mt-1 font-display text-sm font-bold text-zinc-100">{formatUptime(system?.uptime || 0)}</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="System status" subtitle="Host node health" icon={<Activity size={16} />} />
            <div className="mt-4 space-y-3">
              {[
                { label: "CPU load", value: `${system?.loadPercent ?? 0}%`, percent: system?.loadPercent ?? 0 },
                { label: "Memory", value: `${system?.memoryPercent ?? 0}%`, percent: system?.memoryPercent ?? 0 },
                { label: "Disk", value: `${system?.diskPercent ?? 0}%`, percent: system?.diskPercent ?? 0 },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between text-[0.72rem]">
                    <span className="text-zinc-400">{row.label}</span>
                    <span className="font-mono text-zinc-300">{row.value}</span>
                  </div>
                  <Progress
                    value={row.percent}
                    tone={row.percent > 85 ? "#ef4444" : row.percent > 65 ? "#f59e0b" : undefined}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2">
                <span className="flex items-center gap-2 text-[0.72rem] font-medium text-emerald-200">
                  <span className="zk-live-dot" /> All systems operational
                </span>
                <span className="font-mono text-[0.62rem] text-emerald-500/70">{system?.hostname}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Quick actions + activity */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Quick actions" subtitle="Jump straight into common tasks" icon={<Zap size={16} />} />
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {[
              { label: "My servers", icon: <Server size={16} />, to: "/servers" },
              { label: "API keys", icon: <ShieldCheck size={16} />, to: "/api-keys" },
              { label: "Account", icon: <Gauge size={16} />, to: "/account" },
              { label: "Console", icon: <Terminal size={16} />, to: servers[0] ? `/servers/${servers[0].id}` : "/servers" },
            ].map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="group flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 transition hover:border-brand-500/30 hover:bg-brand-500/[0.06]"
              >
                <span className="text-brand-400 transition group-hover:scale-110">{action.icon}</span>
                <span className="text-[0.76rem] font-medium text-zinc-300">{action.label}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent activity"
            subtitle="Your latest actions on the panel"
            icon={<Clock size={16} />}
            action={<span className="zk-badge zk-badge-brand">{activity?.length || 0} events</span>}
          />
          <div className="mt-4 space-y-1">
            {(activity || []).length === 0 && (
              <p className="py-6 text-center text-xs text-zinc-500">No activity recorded yet.</p>
            )}
            {(activity || []).slice(0, 6).map((item: any) => (
              <div key={item.id} className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.025]">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-brand-400">
                  {ACTIVITY_ICON[item.type] || <Activity size={13} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.78rem] text-zinc-300">{item.message}</p>
                  <p className="text-[0.64rem] text-zinc-600">{relativeTime(item.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {unread.length > 0 && (
        <Card>
          <CardHeader title="Notifications" subtitle="Latest announcements and alerts" icon={<Bell size={16} />} />
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {unread.map((n: any) => (
              <div key={n.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${n.type === "error" ? "bg-red-400" : n.type === "success" ? "bg-emerald-400" : n.type === "warning" ? "bg-amber-400" : "bg-sky-400"}`} />
                  <p className="truncate text-[0.78rem] font-semibold text-zinc-200">{n.title}</p>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[0.7rem] leading-relaxed text-zinc-500">{n.message}</p>
                <p className="mt-2 text-[0.62rem] text-zinc-600">{relativeTime(n.createdAt)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

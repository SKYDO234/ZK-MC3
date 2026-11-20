import React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  Users,
  Server,
  Boxes,
  Cpu,
  MemoryStick,
  HardDrive,
  TrendingUp,
  Activity,
  Plus,
  Settings2,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
  Network,
  KeyRound,
  DollarSign,
  Wifi,
  CheckCircle2,
  XCircle,
  Terminal,
  Play,
  StopCircle,
  UserCog,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, StatCard, Button, Progress, Badge, PageSkeleton, ResourceMeter, EmptyState } from "../../components/ui";
import { StatusPill } from "../../components/StatusPill";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useSettings } from "../../context/SettingsContext";
import { formatMb, formatMoney, formatUptime, relativeTime, pct } from "../../lib/format";

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d0d10]/95 px-3 py-2 text-[0.7rem] shadow-xl backdrop-blur">
      <p className="mb-1 font-semibold text-zinc-200">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="flex items-center gap-1.5" style={{ color: entry.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
          {entry.name}: <span className="font-mono">{entry.value}</span>
        </p>
      ))}
    </div>
  );
};

export const AdminDashboard: React.FC = () => {
  useDocumentTitle("Admin Overview · ZK-MC3-PANEL");
  const { data, loading, reload } = useApi<any>("/admin/dashboard");
  const { settings } = useSettings();
  const { data: panelSettings } = useApi<any>("/admin/settings");
  const navigate = useNavigate();

  if (loading) return <PageSkeleton />;
  if (!data) return <EmptyState icon={<AlertTriangle size={22} />} title="Unable to load dashboard" message="Check that the API server is running." action={<Button onClick={reload}>Retry</Button>} />;

  const { counts, system, resources, activity, servers, usersGrowth, resourcesSeries, nodes } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ShieldCheck size={20} />}
        title="Admin Overview"
        subtitle="System-wide monitoring and management."
        badge={
          <span className="flex items-center gap-1.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.1em] text-emerald-400">
            <span className="h-1 w-1 rounded-full bg-emerald-400" /> Operational
          </span>
        }
        actions={
          <>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Refresh
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => navigate("/admin/create-server")}>
              Create Server
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total users"
          value={counts.users}
          icon={<Users size={14} />}
          tone="blue"
          hint={`Registered in the panel`}
        />
        <StatCard
          label="Total servers"
          value={counts.servers}
          icon={<Server size={14} />}
          tone="neutral"
          hint={`${counts.onlineServers} online · ${counts.offlineServers} offline`}
        />
        <StatCard
          label="Running"
          value={counts.onlineServers}
          icon={<Play size={14} />}
          tone="green"
          hint={`Active server processes`}
        />
        <StatCard
          label="Stopped"
          value={counts.offlineServers}
          icon={<StopCircle size={14} />}
          tone="red"
          hint={`Not currently running`}
        />
      </div>

      {/* System information + quick actions, as in the reference overview. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="rounded-xl border border-white/[0.07] zk-surface">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
              <Cpu size={13} className="text-zinc-500" />
              <h3 className="zk-eyebrow">System Information</h3>
            </div>
            <div className="zk-cellgrid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "Platform", value: system?.platform || "—" },
                { label: "Node.js", value: system?.nodeVersion || "—" },
                { label: "Panel Version", value: "1.0.0" },
                { label: "CPU Cores", value: String(system?.cpuCores ?? "—") },
                { label: "Uptime", value: formatUptime(system?.uptime ?? 0) },
                { label: "Total Memory", value: formatMb(system?.memoryTotalMb ?? 0) },
                { label: "Free Memory", value: formatMb(system?.memoryFreeMb ?? 0) },
                { label: "Disk Space", value: `${system?.diskPercent ?? 0}% used · ${formatMb(system?.diskFreeMb ?? 0)} free` },
                { label: "Architecture", value: system?.arch || "—" },
                { label: "OS Release", value: system?.platform?.split(" ").slice(1).join(" ") || "—" },
              ].map((cell) => (
                <div key={cell.label}>
                  <p className="zk-cell-label">{cell.label}</p>
                  <p className="zk-cell-value">{cell.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] zk-surface">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <Plus size={13} className="text-zinc-500" />
            <h3 className="zk-eyebrow">Quick Actions</h3>
          </div>
          <div className="space-y-1.5 p-2.5">
            <button
              onClick={() => navigate("/admin/users")}
              className="flex w-full items-center gap-2 rounded-md bg-[#ededed] px-3 py-2 text-[0.78rem] font-semibold text-[#0a0a0a] transition hover:bg-white"
            >
              <UserCog size={14} /> Create User
            </button>
            {[
              { to: "/admin/create-server", label: "Create Server", icon: <Server size={14} /> },
              { to: "/admin/nodes", label: "Create Node", icon: <Boxes size={14} /> },
              { to: "/admin/settings", label: "Panel Settings", icon: <Settings2 size={14} /> },
            ].map((item) => (
              <button
                key={item.to}
                onClick={() => navigate(item.to)}
                className="flex w-full items-center gap-2 rounded-md border border-white/[0.07] px-3 py-2 text-[0.78rem] font-medium text-zinc-300 transition hover:border-white/[0.14] hover:bg-white/[0.03]"
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>

          <div className="border-t border-white/[0.06] px-4 py-2.5">
            <h3 className="zk-eyebrow">At a Glance</h3>
          </div>
          <div className="space-y-2 px-2.5 pb-2.5">
            {[
              {
                label: "Server uptime",
                value: `${counts.onlineServers} running`,
                tone: counts.onlineServers > 0 ? "text-emerald-400" : "text-zinc-500",
                dot: counts.onlineServers > 0 ? "bg-emerald-400" : "bg-zinc-600",
                icon: <Activity size={13} />,
              },
              {
                label: "Admin",
                value: `${counts.admins} staff users`,
                tone: "text-blue-400",
                dot: "bg-blue-400",
                icon: <ShieldCheck size={13} />,
              },
              {
                label: "Panel status",
                value: "Operational",
                tone: "text-emerald-400",
                dot: "bg-emerald-400",
                icon: <CheckCircle2 size={13} />,
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5 rounded-md border border-white/[0.05] px-2.5 py-2">
                <span className={`flex h-6 w-6 flex-none items-center justify-center rounded bg-white/[0.04] ${row.tone}`}>
                  {row.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.72rem] font-medium text-zinc-300">{row.label}</p>
                  <p className="truncate text-[0.62rem] text-zinc-600">{row.value}</p>
                </div>
                <span className={`h-1.5 w-1.5 flex-none rounded-full ${row.dot}`} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Platform growth"
            subtitle="Registered users and provisioned servers by month"
            icon={<TrendingUp size={16} />}
            action={<Badge tone="brand">6 months</Badge>}
          />
          <div className="mt-5 h-[248px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={usersGrowth}>
                <defs>
                  <linearGradient id="usersGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff7a18" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#ff7a18" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="serversGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" stroke="#6b6b78" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b6b78" fontSize={11} tickLine={false} axisLine={false} width={30} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="users" stroke="#ff7a18" strokeWidth={2} fill="url(#usersGrad)" name="Users" />
                <Area type="monotone" dataKey="servers" stroke="#38bdf8" strokeWidth={2} fill="url(#serversGrad)" name="Servers" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="System health" subtitle={system.hostname} icon={<Activity size={16} />} />
          <div className="mt-4 space-y-4">
            <ResourceMeter label="CPU load" used={system.load1} total={system.cpuCores} formatter={(n) => n.toFixed(1)} icon={<Cpu size={12} />} />
            <ResourceMeter label="Memory" used={system.memoryUsedMb} total={system.memoryTotalMb} formatter={formatMb} icon={<MemoryStick size={12} />} />
            <ResourceMeter label="Disk" used={system.diskUsedMb} total={system.diskTotalMb} formatter={formatMb} icon={<HardDrive size={12} />} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["Cores", system.cpuCores],
              ["Uptime", formatUptime(system.uptime)],
              ["Platform", system.arch],
              ["Node", system.nodeVersion],
            ].map(([label, value]) => (
              <div key={label} className="zk-inset px-2.5 py-2">
                <p className="text-[0.6rem] uppercase tracking-wider text-zinc-600">{label}</p>
                <p className="truncate font-mono text-[0.7rem] text-zinc-300">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-100">
              <CheckCircle2 size={12} /> Operational
            </span>
            <span className="font-mono text-[0.62rem] text-emerald-500/70">{system.cpuModel?.slice(0, 22)}</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Resource allocation" subtitle="Committed vs available capacity" icon={<Cpu size={16} />} />
          <div className="mt-4 space-y-4">
            <ResourceMeter label="RAM committed" used={resources.ramAllocated} total={resources.ramLimit} formatter={formatMb} />
            <ResourceMeter label="CPU cores committed" used={resources.cpuAllocated} total={resources.cpuLimit} formatter={(n) => `${n}`} />
            <ResourceMeter label="Disk committed" used={resources.diskAllocated} total={resources.diskLimit} formatter={formatMb} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="zk-inset p-2.5">
              <p className="text-[0.6rem] uppercase tracking-wider text-zinc-600">Live RAM in use</p>
              <p className="mt-0.5 font-display text-sm font-bold text-zinc-100">{formatMb(resources.ramUsed)}</p>
            </div>
            <div className="zk-inset p-2.5">
              <p className="text-[0.6rem] uppercase tracking-wider text-zinc-600">Live disk in use</p>
              <p className="mt-0.5 font-display text-sm font-bold text-zinc-100">{formatMb(resources.diskUsed)}</p>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Live resource trend" subtitle="Sample window of node utilisation" icon={<Activity size={16} />} />
          <div className="mt-5 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resourcesSeries}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" stroke="#6b6b78" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b6b78" fontSize={10} tickLine={false} axisLine={false} width={26} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: "#9b9ba8" }} />
                <Bar dataKey="cpu" name="CPU %" fill="#ff7a18" radius={[3, 3, 0, 0]} />
                <Bar dataKey="ram" name="RAM %" fill="#fbbf24" radius={[3, 3, 0, 0]} />
                <Bar dataKey="disk" name="Disk %" fill="#38bdf8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="All servers"
              subtitle={`${servers.length} instances across ${counts.nodes} node(s)`}
              icon={<Server size={16} />}
              action={
                <Link to="/admin/servers" className="zk-btn zk-btn-ghost zk-btn-sm">
                  Manage <ArrowUpRight size={12} />
                </Link>
              }
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Node</th>
                  <th>RAM</th>
                  <th className="text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {servers.slice(0, 8).map((server: any) => (
                  <tr key={server.id}>
                    <td>
                      <Link to={`/servers/${server.id}`} className="font-medium text-zinc-100 hover:text-brand-300">
                        {server.name}
                      </Link>
                      <p className="font-mono text-[0.64rem] text-zinc-600">
                        {server.software} · :{server.port}
                      </p>
                    </td>
                    <td className="text-[0.72rem] text-zinc-400">{server.ownerName || "—"}</td>
                    <td><StatusPill status={server.status} /></td>
                    <td className="text-[0.72rem] text-zinc-500">{server.nodeId}</td>
                    <td className="font-mono text-[0.7rem]">{formatMb(server.ram)}</td>
                    <td className="text-right">
                      <Link to={`/servers/${server.id}`} className="text-brand-400 hover:text-brand-300">
                        <ArrowUpRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
                {servers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-zinc-500">
                      No servers provisioned yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Node status" subtitle="Agent heartbeat & capacity" icon={<Network size={16} />} />
            <div className="mt-4 space-y-2">
              {(nodes || []).map((node: any) => (
                <Link
                  key={node.id}
                  to="/admin/nodes"
                  className="block rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-brand-500/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[0.78rem] font-medium text-zinc-200">
                      <Wifi size={12} className={node.status === "online" ? "text-emerald-400" : "text-zinc-500"} />
                      {node.name}
                    </span>
                    <Badge tone={node.status === "online" ? "online" : "offline"} dot>
                      {node.status}
                    </Badge>
                  </div>
                  <div className="mt-2">
                    <Progress value={node.usage?.memoryPercent || 0} />
                  </div>
                  <p className="mt-1 font-mono text-[0.62rem] text-zinc-600">
                    {node.serverCount} servers · {node.location}
                  </p>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Quick administration" icon={<Settings2 size={16} />} />
            <div className="mt-3 grid gap-1.5">
              {[
                { label: "Create a server", icon: <Plus size={13} />, to: "/admin/create-server" },
                { label: "Manage users", icon: <Users size={13} />, to: "/admin/users" },
                { label: "Add a node", icon: <Boxes size={13} />, to: "/admin/nodes" },
                { label: "API keys", icon: <KeyRound size={13} />, to: "/admin/api-keys" },
                { label: "Panel settings", icon: <Settings2 size={13} />, to: "/admin/settings" },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.78rem] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                >
                  <span className="text-brand-400">{item.icon}</span>
                  {item.label}
                  <ArrowUpRight size={11} className="ml-auto text-zinc-600" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Recent activity"
          subtitle="Audit trail across the panel"
          icon={<Terminal size={16} />}
          action={<Badge tone="info">{activity.length} events</Badge>}
        />
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {activity.slice(0, 8).map((item: any) => (
            <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2">
              <span
                className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
                  item.type === "server"
                    ? "bg-brand-400"
                    : item.type === "auth"
                    ? "bg-emerald-400"
                    : item.type === "admin"
                    ? "bg-sky-400"
                    : item.type === "backup"
                    ? "bg-amber-400"
                    : "bg-zinc-500"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.76rem] text-zinc-300">{item.message}</p>
                <p className="text-[0.62rem] text-zinc-600">
                  {relativeTime(item.createdAt)} · {item.ip || "internal"}
                </p>
              </div>
            </div>
          ))}
        </div>
        {activity.length === 0 && <p className="py-6 text-center text-xs text-zinc-500">No activity yet.</p>}
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[0.7rem] text-zinc-500">
        <XCircle size={13} className="text-amber-400" />
        <span>
          Plan limits: {settings.panelName} caps each server at {formatMb(panelSettings?.maxRamPerServer ?? 8192)} RAM and{" "}
          {panelSettings?.maxServersPerUser ?? 5} servers per user — adjust these in Panel Settings.
        </span>
        <div className="ml-auto flex items-center gap-4">
          <Link to="/admin/themes" className="font-medium text-zinc-300 hover:text-white">
            Themes &amp; Fonts →
          </Link>
          <Link to="/admin/settings" className="font-medium text-brand-400 hover:text-brand-300">
            Open settings →
          </Link>
        </div>
      </div>
    </div>
  );
};

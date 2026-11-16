import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Server as ServerIcon,
  Play,
  Square,
  RotateCw,
  Power,
  Trash2,
  Search,
  LayoutGrid,
  List,
  Cpu,
  MemoryStick,
  HardDrive,
  Terminal,
  FolderOpen,
  RefreshCcw,
  Plus,
  Filter,
  Boxes,
  Rocket,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, Button, Badge, EmptyState, PageSkeleton, Progress, SearchInput, StatCard } from "../../components/ui";
import { StatusPill } from "../../components/StatusPill";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { formatMb, formatUptime, relativeTime, pct } from "../../lib/format";

type ViewMode = "grid" | "table";

export const ServerList: React.FC = () => {
  useDocumentTitle("My Servers · ZK-MC3-PANEL");
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const { success, error, confirm } = useToast();
  const navigate = useNavigate();

  const { data, loading, reload } = useApi<any[]>("/servers");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [busy, setBusy] = useState<string | null>(null);

  const servers = data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      const matchesQuery =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.software.toLowerCase().includes(q) ||
        String(s.port).includes(q);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "online" && s.status === "online") ||
        (statusFilter === "offline" && s.status !== "online");
      return matchesQuery && matchesStatus;
    });
  }, [servers, search, statusFilter]);

  const act = async (server: any, action: "start" | "stop" | "restart" | "kill") => {
    setBusy(server.id + action);
    try {
      await api(`/servers/${server.id}/${action}`, { method: "POST" });
      success(
        action === "kill" ? "Server killed" : `Server ${action}ed`,
        `"${server.name}" — status updates automatically.`
      );
      setTimeout(reload, 1000);
    } catch (err: any) {
      error("Action failed", err.message);
    } finally {
      setBusy(null);
    }
  };

  const reinstall = async (server: any) => {
    const ok = await confirm({
      title: `Reinstall "${server.name}"?`,
      message: "The server jar and libraries will be re-downloaded. Your worlds and configuration are preserved.",
      confirmLabel: "Reinstall",
      danger: true,
    });
    if (!ok) return;
    setBusy(server.id + "reinstall");
    try {
      await api(`/servers/${server.id}/reinstall`, { method: "POST" });
      success("Reinstallation started", "This may take a minute depending on your connection.");
      setTimeout(reload, 1500);
    } catch (err: any) {
      error("Reinstall failed", err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (server: any) => {
    const ok = await confirm({
      title: `Delete "${server.name}"?`,
      message: "This permanently removes the server, its world files and all backups. This cannot be undone.",
      confirmLabel: "Delete server",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/servers/${server.id}`, { method: "DELETE" });
      success("Server deleted");
      reload();
    } catch (err: any) {
      error("Delete failed", err.message);
    }
  };

  if (loading) return <PageSkeleton />;

  const online = servers.filter((s) => s.status === "online").length;
  const totalRam = servers.reduce((a, s) => a + (s.ram || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ServerIcon size={20} />}
        title="My Servers"
        subtitle="Manage every instance from one place — power controls, console, files and backups."
        actions={
          <>
            <Button icon={<RefreshCcw size={14} />} onClick={reload} size="sm">
              Refresh
            </Button>
            {settings.allowUserServerCreation && (
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate("/admin/create-server")}>
                Create server
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total servers" value={servers.length} icon={<ServerIcon size={16} />} accent />
        <StatCard label="Online" value={online} icon={<Play size={16} />} hint={`${servers.length - online} offline`} />
        <StatCard label="RAM allocated" value={formatMb(totalRam)} icon={<MemoryStick size={16} />} />
        <StatCard
          label="Live CPU"
          value={`${servers.reduce((a, s) => a + (s.cpuUsage || 0), 0).toFixed(1)}%`}
          icon={<Cpu size={16} />}
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, software or port…" className="min-w-[220px] flex-1" />
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-black/30 p-1">
            <Filter size={13} className="ml-1.5 text-zinc-500" />
            {[
              { id: "all", label: "All" },
              { id: "online", label: "Online" },
              { id: "offline", label: "Offline" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setStatusFilter(opt.id)}
                className={`rounded-md px-2.5 py-1 text-[0.72rem] font-medium transition ${
                  statusFilter === opt.id ? "bg-brand-500/18 text-brand-200" : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-white/[0.07] bg-black/30 p-1">
            <button
              onClick={() => setView("grid")}
              className={`rounded-md p-1.5 ${view === "grid" ? "bg-brand-500/18 text-brand-300" : "text-zinc-500"}`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setView("table")}
              className={`rounded-md p-1.5 ${view === "table" ? "bg-brand-500/18 text-brand-300" : "text-zinc-500"}`}
            >
              <List size={14} />
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<ServerIcon size={22} />}
              title={servers.length === 0 ? "No servers yet" : "No servers match your filters"}
              message={
                servers.length === 0
                  ? "Once a server is provisioned it will appear here with live controls, console access and resource graphs."
                  : "Try a different search term or clear the status filter."
              }
              action={
                servers.length === 0 ? (
                  <Button variant="primary" icon={<Rocket size={15} />} onClick={() => navigate("/servers")}>
                    Learn how to get a server
                  </Button>
                ) : (
                  <Button onClick={() => { setSearch(""); setStatusFilter("all"); }}>Clear filters</Button>
                )
              }
            />
          </div>
        ) : view === "grid" ? (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((server: any) => (
              <div
                key={server.id}
                className="zk-card zk-card-hover group overflow-hidden p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-500/20 bg-brand-500/10 text-brand-400">
                      <ServerIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <Link
                        to={`/servers/${server.id}`}
                        className="block truncate text-[0.86rem] font-semibold text-zinc-100 transition hover:text-brand-300"
                      >
                        {server.name}
                      </Link>
                      <p className="truncate font-mono text-[0.64rem] text-zinc-500">
                        {server.software} {server.version}
                      </p>
                    </div>
                  </div>
                  <StatusPill status={server.status} />
                </div>

                <div className="mt-3.5 grid grid-cols-2 gap-2 text-[0.68rem]">
                  <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5">
                    <p className="text-zinc-600">Address</p>
                    <p className="truncate font-mono text-zinc-300">:25565 → {server.port}</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5">
                    <p className="text-zinc-600">Uptime</p>
                    <p className="font-mono text-zinc-300">{formatUptime(server.uptimeSeconds)}</p>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {[
                    { icon: <Cpu size={11} />, label: "CPU", value: `${(server.cpuUsage || 0).toFixed(1)}%`, percent: Math.min(100, server.cpuUsage || 0) },
                    { icon: <MemoryStick size={11} />, label: "RAM", value: `${formatMb(server.ramUsage || 0)} / ${formatMb(server.ram)}`, percent: pct(server.ramUsage || 0, server.ram) },
                    { icon: <HardDrive size={11} />, label: "Disk", value: formatMb(server.diskUsage || 0), percent: pct(server.diskUsage || 0, server.disk) },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="mb-1 flex items-center justify-between text-[0.64rem]">
                        <span className="flex items-center gap-1 text-zinc-500">{row.icon}{row.label}</span>
                        <span className="font-mono text-zinc-400">{row.value}</span>
                      </div>
                      <Progress value={row.percent} />
                    </div>
                  ))}
                </div>

                <div className="mt-3.5 flex items-center gap-1.5">
                  {server.status === "online" ? (
                    <Button
                      size="sm"
                      icon={<Square size={12} />}
                      loading={busy === server.id + "stop"}
                      onClick={() => act(server, "stop")}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="success"
                      icon={<Play size={12} />}
                      loading={busy === server.id + "start"}
                      onClick={() => act(server, "start")}
                      disabled={server.status === "installing" || server.status === "suspended"}
                    >
                      Start
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon={<RotateCw size={12} />}
                    loading={busy === server.id + "restart"}
                    onClick={() => act(server, "restart")}
                    disabled={server.status !== "online"}
                  >
                    Restart
                  </Button>
                  <Link
                    to={`/servers/${server.id}`}
                    className="zk-btn zk-btn-primary zk-btn-sm ml-auto"
                  >
                    <Terminal size={12} /> Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Software</th>
                  <th>Address</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>Disk</th>
                  <th>Node</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((server: any) => (
                  <tr key={server.id}>
                    <td>
                      <Link to={`/servers/${server.id}`} className="font-medium text-zinc-100 hover:text-brand-300">
                        {server.name}
                      </Link>
                      <p className="text-[0.66rem] text-zinc-600">created {relativeTime(server.createdAt)}</p>
                    </td>
                    <td><StatusPill status={server.status} /></td>
                    <td>
                      <Badge tone="brand">{server.software}</Badge>
                      <span className="ml-1.5 font-mono text-[0.68rem] text-zinc-500">{server.version}</span>
                    </td>
                    <td className="font-mono text-[0.72rem] text-zinc-400">:{server.port}</td>
                    <td className="font-mono text-[0.72rem]">{(server.cpuUsage || 0).toFixed(1)}%</td>
                    <td className="font-mono text-[0.72rem]">
                      {formatMb(server.ramUsage || 0)} <span className="text-zinc-600">/ {formatMb(server.ram)}</span>
                    </td>
                    <td className="font-mono text-[0.72rem]">{formatMb(server.diskUsage || 0)}</td>
                    <td className="text-[0.72rem] text-zinc-500">{server.nodeId}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {server.status === "online" ? (
                          <button
                            title="Stop"
                            onClick={() => act(server, "stop")}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-amber-500/15 hover:text-amber-300"
                          >
                            <Square size={12} />
                          </button>
                        ) : (
                          <button
                            title="Start"
                            onClick={() => act(server, "start")}
                            disabled={server.status === "installing" || server.status === "suspended"}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-emerald-500/15 hover:text-emerald-300 disabled:opacity-40"
                          >
                            <Play size={12} />
                          </button>
                        )}
                        <button
                          title="Restart"
                          onClick={() => act(server, "restart")}
                          disabled={server.status !== "online"}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-brand-500/15 hover:text-brand-300 disabled:opacity-40"
                        >
                          <RotateCw size={12} />
                        </button>
                        <button
                          title="Force kill"
                          onClick={() => act(server, "kill")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-red-500/15 hover:text-red-300"
                        >
                          <Power size={12} />
                        </button>
                        <button
                          title="Reinstall"
                          onClick={() => reinstall(server)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-sky-500/15 hover:text-sky-300"
                        >
                          <RefreshCcw size={12} />
                        </button>
                        <Link
                          to={`/servers/${server.id}`}
                          title="Open"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white"
                        >
                          <FolderOpen size={12} />
                        </Link>
                        {(isAdmin || server.owner) && (
                          <button
                            title="Delete"
                            onClick={() => remove(server)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-red-500/15 hover:text-red-300"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[0.7rem] text-zinc-500">
        <Boxes size={14} className="text-brand-400" />
        Every power action is streamed live — status pills update automatically without a page refresh.
      </div>
    </div>
  );
};

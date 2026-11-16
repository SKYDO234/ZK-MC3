import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Server as ServerIcon,
  Search,
  Play,
  Square,
  RotateCw,
  Trash2,
  Ban,
  CheckCircle2,
  Cpu,
  MemoryStick,
  HardDrive,
  RefreshCw,
  Users,
  SlidersHorizontal,
  ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
  Card,
  Button,
  Badge,
  Modal,
  Field,
  PageSkeleton,
  StatCard,
  SearchInput,
  EmptyState,
} from "../../components/ui";
import { StatusPill } from "../../components/StatusPill";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { formatMb, relativeTime } from "../../lib/format";

export const AdminServers: React.FC = () => {
  useDocumentTitle("All Servers · ZK-MC3-PANEL");
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/servers");
  const { data: users } = useApi<any[]>("/users/directory");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [resourceTarget, setResourceTarget] = useState<any>(null);
  const [resources, setResources] = useState({ ram: 1024, cpu: 1, disk: 10240 });

  const servers = data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      const match =
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.ownerName || "").toLowerCase().includes(q) ||
        s.software.toLowerCase().includes(q) ||
        String(s.port).includes(q);
      const statusOk = statusFilter === "all" || (statusFilter === "online" ? s.status === "online" : s.status !== "online");
      return match && statusOk;
    });
  }, [servers, search, statusFilter]);

  const act = async (server: any, action: string) => {
    setBusy(`${server.id}:${action}`);
    try {
      if (action === "suspend") {
        await api(`/servers/${server.id}/suspend`, { method: "PUT", body: { suspend: server.status !== "suspended" } });
      } else {
        await api(`/servers/${server.id}/${action}`, { method: "POST" });
      }
      success(`Server ${action} complete`.replace("suspend complete", server.status === "suspended" ? "reactivated" : "suspended"));
      setTimeout(reload, 900);
    } catch (err: any) {
      error("Action failed", err.message);
    } finally {
      setBusy("");
    }
  };

  const remove = async (server: any) => {
    const ok = await confirm({
      title: `Delete "${server.name}"?`,
      message: "This permanently deletes all files, worlds and backups for this server.",
      danger: true,
      confirmLabel: "Delete permanently",
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

  const saveResources = async () => {
    try {
      await api(`/servers/${resourceTarget.id}/resources`, { method: "PUT", body: resources });
      success("Resources updated", "Restart the server to apply new limits.");
      setResourceTarget(null);
      reload();
    } catch (err: any) {
      error("Update failed", err.message);
    }
  };

  const changeOwner = async (server: any, ownerId: string) => {
    try {
      await api(`/servers/${server.id}/owner`, { method: "PUT", body: { ownerId } });
      success("Owner updated");
      reload();
    } catch (err: any) {
      error("Update failed", err.message);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ServerIcon size={20} />}
        title="All Servers"
        subtitle="Administrator view of every instance — power, resources, ownership and suspension."
        actions={
          <>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Refresh
            </Button>
            <Link to="/admin/create-server" className="zk-btn zk-btn-primary zk-btn-sm">
              <ServerIcon size={13} /> Create server
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total servers" value={servers.length} icon={<ServerIcon size={16} />} accent />
        <StatCard label="Online" value={servers.filter((s) => s.status === "online").length} icon={<Play size={16} />} />
        <StatCard label="Suspended" value={servers.filter((s) => s.status === "suspended").length} icon={<Ban size={16} />} />
        <StatCard label="RAM committed" value={formatMb(servers.reduce((a, s) => a + (s.ram || 0), 0))} icon={<MemoryStick size={16} />} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search servers, owners, ports…" className="min-w-[220px] flex-1" />
          <select className="zk-select w-auto min-w-[130px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<ServerIcon size={22} />} title="No servers" message="Provision your first instance to get started." action={<Link to="/admin/create-server" className="zk-btn zk-btn-primary">Create server</Link>} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Software</th>
                  <th>Resources</th>
                  <th>Port</th>
                  <th>Node</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <Link to={`/servers/${server.id}`} className="font-medium text-zinc-100 hover:text-brand-300">
                        {server.name}
                      </Link>
                      <p className="font-mono text-[0.62rem] text-zinc-600">{server.id.slice(0, 14)}</p>
                    </td>
                    <td>
                      <select
                        className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[0.72rem] text-zinc-400 outline-none transition hover:border-white/10"
                        value={server.owner}
                        onChange={(e) => changeOwner(server, e.target.value)}
                      >
                        {(users || []).map((u: any) => (
                          <option key={u.id} value={u.id} className="bg-[#121216]">
                            {u.username}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td><StatusPill status={server.status} /></td>
                    <td>
                      <Badge tone="brand">{server.software}</Badge>
                      <span className="ml-1 font-mono text-[0.64rem] text-zinc-500">{server.version}</span>
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 text-[0.66rem] text-zinc-400">
                        <span className="flex items-center gap-1"><Cpu size={10} /> {server.cpu} core(s)</span>
                        <span className="flex items-center gap-1"><MemoryStick size={10} /> {formatMb(server.ram)}</span>
                        <span className="flex items-center gap-1"><HardDrive size={10} /> {formatMb(server.disk)}</span>
                      </div>
                    </td>
                    <td className="font-mono text-[0.72rem]">{server.port}</td>
                    <td className="text-[0.7rem] text-zinc-500">{server.nodeId}</td>
                    <td className="text-[0.68rem] text-zinc-600">{relativeTime(server.createdAt)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {server.status === "online" ? (
                          <button
                            onClick={() => act(server, "stop")}
                            title="Stop"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-amber-500/15 hover:text-amber-300"
                          >
                            <Square size={12} />
                          </button>
                        ) : (
                          <button
                            onClick={() => act(server, "start")}
                            title="Start"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-emerald-500/15 hover:text-emerald-300"
                          >
                            <Play size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => act(server, "restart")}
                          title="Restart"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-brand-500/15 hover:text-brand-300"
                        >
                          <RotateCw size={12} />
                        </button>
                        <button
                          onClick={() => {
                            setResourceTarget(server);
                            setResources({ ram: server.ram, cpu: server.cpu, disk: server.disk });
                          }}
                          title="Resources"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-sky-500/15 hover:text-sky-300"
                        >
                          <SlidersHorizontal size={12} />
                        </button>
                        <button
                          onClick={() => act(server, "suspend")}
                          title={server.status === "suspended" ? "Reactivate" : "Suspend"}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-amber-500/15 hover:text-amber-300"
                        >
                          {server.status === "suspended" ? <CheckCircle2 size={12} /> : <Ban size={12} />}
                        </button>
                        <Link
                          to={`/servers/${server.id}`}
                          title="Open"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                        >
                          <ArrowUpRight size={12} />
                        </Link>
                        <button
                          onClick={() => remove(server)}
                          title="Delete"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(resourceTarget)}
        onClose={() => setResourceTarget(null)}
        title={`Resources · ${resourceTarget?.name || ""}`}
        subtitle="Adjust the limits enforced on this instance"
        icon={<SlidersHorizontal size={16} />}
        footer={
          <>
            <Button onClick={() => setResourceTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveResources}>Apply changes</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="RAM (MB)">
            <input type="number" className="zk-input" value={resources.ram} onChange={(e) => setResources((r) => ({ ...r, ram: Number(e.target.value) }))} />
          </Field>
          <Field label="CPU cores">
            <input type="number" className="zk-input" value={resources.cpu} onChange={(e) => setResources((r) => ({ ...r, cpu: Number(e.target.value) }))} />
          </Field>
          <Field label="Disk (MB)">
            <input type="number" className="zk-input" value={resources.disk} onChange={(e) => setResources((r) => ({ ...r, disk: Number(e.target.value) }))} />
          </Field>
        </div>
        <p className="mt-3 text-[0.7rem] text-zinc-500">
          Changes take effect the next time this server starts. Existing allocations remain until restart.
        </p>
      </Modal>
    </div>
  );
};

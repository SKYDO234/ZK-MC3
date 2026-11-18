import React, { useState } from "react";
import {
  Boxes,
  Plus,
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  Wifi,
  WifiOff,
  Trash2,
  Pencil,
  RefreshCw,
  MapPin,
  Activity,
  Copy,
  Network,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, Button, Badge, Field, Modal, PageSkeleton, Progress, StatCard, EmptyState } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { copyToClipboard, formatMb, relativeTime } from "../../lib/format";

export const NodesPage: React.FC = () => {
  useDocumentTitle("Nodes · ZK-MC3-PANEL");
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/nodes");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    hostname: "",
    ip: "",
    port: 31120,
    cpuCores: 8,
    memoryMb: 16384,
    diskMb: 204800,
    location: "",
    description: "",
  });

  const nodes = data || [];

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", hostname: "", ip: "", port: 31120, cpuCores: 8, memoryMb: 16384, diskMb: 204800, location: "", description: "" });
    setModalOpen(true);
  };

  const openEdit = (node: any) => {
    setEditing(node);
    setForm({
      name: node.name,
      hostname: node.hostname,
      ip: node.ip,
      port: node.port,
      cpuCores: node.cpuCores,
      memoryMb: node.memoryMb,
      diskMb: node.diskMb,
      location: node.location,
      description: node.description || "",
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.ip) return error("Name and IP are required");
    setSaving(true);
    try {
      if (editing) {
        await api(`/nodes/${editing.id}`, { method: "PATCH", body: form });
        success("Node updated");
      } else {
        await api("/nodes", { method: "POST", body: form });
        success("Node added", "Deploy the agent on the remote host to bring it online.");
      }
      setModalOpen(false);
      reload();
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (node: any) => {
    const ok = await confirm({
      title: `Remove "${node.name}"?`,
      message: "Servers assigned to this node must be moved or deleted first.",
      danger: true,
      confirmLabel: "Remove node",
    });
    if (!ok) return;
    try {
      await api(`/nodes/${node.id}`, { method: "DELETE" });
      success("Node removed");
      reload();
    } catch (err: any) {
      error("Remove failed", err.message);
    }
  };

  const totals = nodes.reduce(
    (acc, n) => ({
      cpu: acc.cpu + (n.cpuCores || 0),
      ram: acc.ram + (n.memoryMb || 0),
      disk: acc.disk + (n.diskMb || 0),
      servers: acc.servers + (n.serverCount || 0),
      online: acc.online + (n.status === "online" ? 1 : 0),
    }),
    { cpu: 0, ram: 0, disk: 0, servers: 0, online: 0 }
  );

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Boxes size={20} />}
        title="Node Management"
        subtitle="Register and monitor the machines that run your game servers."
        actions={
          <>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Refresh
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
              Add node
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Nodes" value={nodes.length} icon={<Boxes size={16} />} accent hint={`${totals.online} online`} />
        <StatCard label="Total cores" value={totals.cpu} icon={<Cpu size={16} />} />
        <StatCard label="Total memory" value={formatMb(totals.ram)} icon={<MemoryStick size={16} />} />
        <StatCard label="Servers deployed" value={totals.servers} icon={<Server size={16} />} />
      </div>

      {nodes.length === 0 ? (
        <EmptyState icon={<Boxes size={22} />} title="No nodes registered" message="Add your first remote node to scale beyond this machine." action={<Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>Add node</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {nodes.map((node) => {
            const memPct = node.memoryMb ? Math.round((node.usage.ram / node.memoryMb) * 100) : 0;
            const diskPct = node.diskMb ? Math.round((node.usage.disk / node.diskMb) * 100) : 0;
            return (
              <Card key={node.id} hover>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl border ${
                        node.status === "online"
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                          : "border-white/10 bg-white/[0.03] text-zinc-500"
                      }`}
                    >
                      {node.status === "online" ? <Wifi size={17} /> : <WifiOff size={17} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[0.92rem] font-semibold text-zinc-100">{node.name}</h3>
                        <Badge tone={node.id === "local" ? "brand" : node.status === "online" ? "online" : "offline"} dot>
                          {node.id === "local" ? "local" : node.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[0.68rem] text-zinc-500">
                        {node.ip}:{node.port} · {node.hostname}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[0.66rem] text-zinc-600">
                        <MapPin size={10} /> {node.location || "Unassigned"} · {node.serverCount} servers
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {node.id === "local" ? (
                      <Badge tone="info">Built-in</Badge>
                    ) : (
                      <>
                        <button
                          onClick={async () => {
                            const text = `ip=${node.ip}\nport=${node.port}\ntoken=${node.token}`;
                            await copyToClipboard(text);
                            success("Agent config copied");
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                          title="Copy agent config"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => openEdit(node)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-brand-500/15 hover:text-brand-300"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => remove(node)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="zk-inset px-2 py-2">
                    <div className="flex items-center justify-center gap-1 text-[0.6rem] uppercase tracking-wider text-zinc-600">
                      <Cpu size={10} /> Cores alloc.
                    </div>
                    <p className={`mt-0.5 font-mono text-[0.78rem] font-semibold ${node.allocated.cpu > node.cpuCores ? "text-amber-400" : "text-zinc-200"}`}>
                      {node.allocated.cpu}
                      <span className="text-zinc-600">/{node.cpuCores}</span>
                    </p>
                  </div>
                  <div className="zk-inset px-2 py-2">
                    <div className="flex items-center justify-center gap-1 text-[0.6rem] uppercase tracking-wider text-zinc-600">
                      <MemoryStick size={10} /> RAM alloc.
                    </div>
                    <p className={`mt-0.5 font-mono text-[0.78rem] font-semibold ${node.allocated.ram > node.memoryMb ? "text-amber-400" : "text-zinc-200"}`}>
                      {formatMb(node.allocated.ram)}
                      <span className="text-zinc-600">/{formatMb(node.memoryMb)}</span>
                    </p>
                  </div>
                  <div className="zk-inset px-2 py-2">
                    <div className="flex items-center justify-center gap-1 text-[0.6rem] uppercase tracking-wider text-zinc-600">
                      <HardDrive size={10} /> Disk alloc.
                    </div>
                    <p className={`mt-0.5 font-mono text-[0.78rem] font-semibold ${node.allocated.disk > node.diskMb ? "text-amber-400" : "text-zinc-200"}`}>
                      {formatMb(node.allocated.disk)}
                      <span className="text-zinc-600">/{formatMb(node.diskMb)}</span>
                    </p>
                  </div>
                </div>

                {(node.allocated.cpu > node.cpuCores || node.allocated.ram > node.memoryMb || node.allocated.disk > node.diskMb) && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2 py-1.5 text-[0.62rem] leading-snug text-amber-300">
                    <AlertTriangle size={11} className="mt-px flex-none" />
                    Over-allocated — committed resources exceed this node's capacity.
                  </p>
                )}

                <div className="mt-3 space-y-2">
                  <div>
                    <div className="mb-1 flex justify-between text-[0.66rem]">
                      <span className="flex items-center gap-1 text-zinc-500"><Activity size={10} /> CPU load</span>
                      <span className="font-mono text-zinc-400">{node.usage.cpu}%</span>
                    </div>
                    <Progress value={node.usage.cpu} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[0.66rem]">
                      <span className="flex items-center gap-1 text-zinc-500"><MemoryStick size={10} /> Memory</span>
                      <span className="font-mono text-zinc-400">{formatMb(node.usage.ram)} / {formatMb(node.memoryMb)}</span>
                    </div>
                    <Progress value={memPct} tone={memPct > 85 ? "#ef4444" : undefined} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[0.66rem]">
                      <span className="flex items-center gap-1 text-zinc-500"><HardDrive size={10} /> Disk</span>
                      <span className="font-mono text-zinc-400">{formatMb(node.usage.disk)} / {formatMb(node.diskMb)}</span>
                    </div>
                    <Progress value={diskPct} tone={diskPct > 85 ? "#ef4444" : undefined} />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2.5 text-[0.64rem] text-zinc-600">
                  <span className="flex items-center gap-1">
                    <Network size={10} /> {node.description || node.allocPortRange}
                  </span>
                  <span>Last seen {node.lastSeen ? relativeTime(node.lastSeen) : "never"}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader title="Deploying a remote node" subtitle="Agent setup instructions" icon={<Network size={16} />} />
        <div className="mt-4 space-y-2 text-[0.76rem] text-zinc-400">
          <p className="text-zinc-500">
            Run the installer on the target host, then register it here with its public IP and port. The bundled
            agent reports health, allocation usage and heartbeat data back to this panel.
          </p>
          <pre className="zk-console">
{`# On the remote machine
curl -fsSL https://raw.githubusercontent.com/SKYDO234/ZK-MC3/main/install.sh -o install.sh
sudo bash install.sh --agent

# Start the agent (reports to this panel)
PORT=31120 ZK_PANEL_TOKEN=<node-token> node agent/agent.js`}
          </pre>
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : "Add a new node"}
        subtitle={editing ? "Update capacity and connection details" : "Register a machine to host game servers"}
        icon={<Boxes size={16} />}
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {editing ? "Save changes" : "Add node"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Node name" required>
            <input className="zk-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Node EU-2" />
          </Field>
          <Field label="Hostname">
            <input className="zk-input" value={form.hostname} onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))} placeholder="eu2.zk-mc3.host" />
          </Field>
          <Field label="Public IP" required>
            <input className="zk-input font-mono" value={form.ip} onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))} placeholder="203.0.113.10" />
          </Field>
          <Field label="Agent port">
            <input type="number" className="zk-input font-mono" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))} />
          </Field>
          <Field label="CPU cores">
            <input type="number" className="zk-input" value={form.cpuCores} onChange={(e) => setForm((f) => ({ ...f, cpuCores: Number(e.target.value) }))} />
          </Field>
          <Field label="Memory (MB)">
            <input type="number" className="zk-input" value={form.memoryMb} onChange={(e) => setForm((f) => ({ ...f, memoryMb: Number(e.target.value) }))} />
          </Field>
          <Field label="Disk (MB)">
            <input type="number" className="zk-input" value={form.diskMb} onChange={(e) => setForm((f) => ({ ...f, diskMb: Number(e.target.value) }))} />
          </Field>
          <Field label="Location">
            <input className="zk-input" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Frankfurt, DE" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input className="zk-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Ryzen 9 7950X · NVMe storage" />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

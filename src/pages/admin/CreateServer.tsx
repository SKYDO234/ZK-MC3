import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusSquare,
  Server,
  User,
  Boxes,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Check,
  Info,
  Rocket,
  Loader2,
  Sparkles,
} from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { CategorizedVersionDropdown } from "../../components/CategorizedVersionDropdown";
import { Card, CardHeader, Button, Field, Badge, Modal } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { formatMb } from "../../lib/format";

const RAM_PRESETS = [1024, 2048, 4096, 6144, 8192, 12288, 16384];
const CPU_PRESETS = [1, 2, 4, 6, 8];
const DISK_PRESETS = [5120, 10240, 20480, 40960, 81920];

export const CreateServer: React.FC = () => {
  useDocumentTitle("Create Server · ZK-MC3-PANEL");
  const navigate = useNavigate();
  const { success, error } = useToast();

  const { data: users } = useApi<any[]>("/users/directory");
  const { data: nodes } = useApi<any[]>("/nodes");
  const { data: softwareList } = useApi<any[]>("/system/software");
  const { data: settings } = useApi<any>("/admin/settings");

  const [form, setForm] = useState({
    name: "",
    ownerId: "",
    nodeId: "local",
    software: "PAPER",
    version: "",
    ram: 2048,
    cpu: 2,
    disk: 10240,
    port: 25565,
    description: "",
    autoRestart: false,
    javaVersion: "",
  });
  const [versions, setVersions] = useState<string[]>([]);
  const [versionError, setVersionError] = useState("");
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [portCheck, setPortCheck] = useState<{ checking: boolean; inUse: boolean }>({ checking: false, inUse: false });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (users && users.length && !form.ownerId) {
      const firstNonAdmin = users.find((u) => u.role === "user") || users[0];
      setForm((f) => ({ ...f, ownerId: firstNonAdmin.id }));
    }
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!form.software) return;
      setLoadingVersions(true);
      setVersionError("");
      try {
        const data = await api<{ versions: string[] }>("/system/versions", { query: { software: form.software } });
        if (cancelled) return;
        setVersions(data.versions || []);
        setForm((f) => ({ ...f, version: data.versions?.[0] || "" }));
      } catch (err: any) {
        if (cancelled) return;
        setVersions([]);
        // A 503 means the node could not reach the software's version API; show
        // that verbatim instead of an empty dropdown.
        setVersionError(err?.message || `Could not load ${form.software} versions.`);
      } finally {
        if (!cancelled) setLoadingVersions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.software]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!form.port) return;
      setPortCheck((p) => ({ ...p, checking: true }));
      try {
        const data = await api<{ inUse: boolean }>("/servers/check-port", { query: { port: form.port } });
        setPortCheck({ checking: false, inUse: data.inUse });
      } catch {
        setPortCheck({ checking: false, inUse: false });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.port]);

  const maxRam = settings?.maxRamPerServer || 8192;
  const maxCpu = settings?.maxCpuPerServer || 8;
  const maxDisk = settings?.maxDiskPerServer || 51200;

  const selectedSoftware = useMemo(() => softwareList?.find((s) => s.id === form.software), [softwareList, form.software]);

  const suggestedPort = useMemo(() => {
    const base = 25565;
    return base;
  }, []);

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 3) next.name = "Name must be at least 3 characters";
    if (!form.ownerId) next.ownerId = "Select an owner";
    if (!form.version) next.version = "Select a software version";
    if (form.ram < 512) next.ram = "Minimum 512 MB";
    if (form.ram > maxRam) next.ram = `Panel limit is ${formatMb(maxRam)}`;
    if (form.cpu > maxCpu) next.cpu = `Panel limit is ${maxCpu} cores`;
    if (form.disk > maxDisk) next.disk = `Panel limit is ${formatMb(maxDisk)}`;
    if (form.port < 1024 || form.port > 65535) next.port = "Port must be between 1024 and 65535";
    if (portCheck.inUse) next.port = "This port is already allocated";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      error("Please fix the highlighted fields");
      return;
    }
    setCreating(true);
    try {
      const server = await api("/servers", { method: "POST", body: form });
      setCreated(server);
      success("Server created", "Installation is running in the background.");
    } catch (err: any) {
      error("Creation failed", err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<PlusSquare size={20} />}
        title="Create Server"
        subtitle="Provision a new Minecraft instance. The server jar downloads automatically after creation."
        actions={<Badge tone="brand">Admin</Badge>}
      />

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Basic information" subtitle="Identity and ownership" icon={<Server size={16} />} />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Server name" required error={errors.name} className="sm:col-span-2">
                <input
                  className="zk-input"
                  placeholder="e.g. Skyblock Legends"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="Owner" required error={errors.ownerId}>
                <select
                  className="zk-select"
                  value={form.ownerId}
                  onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}
                >
                  <option value="">Select a user…</option>
                  {(users || []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.username} ({u.role})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Node" hint="Where this instance runs">
                <select
                  className="zk-select"
                  value={form.nodeId}
                  onChange={(e) => setForm((f) => ({ ...f, nodeId: e.target.value }))}
                >
                  {(nodes || []).map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} {n.status === "offline" ? "(offline)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description" className="sm:col-span-2" hint="Optional — helps you and your team identify this server">
                <input
                  className="zk-input"
                  placeholder="Survival world for friends"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Software & version" subtitle="Choose the server jar to install" icon={<Sparkles size={16} />} />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Software type" required>
                <select
                  className="zk-select"
                  value={form.software}
                  onChange={(e) => setForm((f) => ({ ...f, software: e.target.value }))}
                >
                  {(softwareList || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — {s.category}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Version" required error={errors.version}>
                <CategorizedVersionDropdown
                  value={form.version}
                  onChange={(v) => setForm((f) => ({ ...f, version: v }))}
                  versions={versions}
                  software={form.software}
                  loading={loadingVersions}
                />
                {versionError && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[0.66rem] leading-relaxed text-amber-400">
                    <AlertTriangle size={11} className="mt-0.5 flex-none" /> {versionError}
                  </p>
                )}
              </Field>
              {selectedSoftware && (
                <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-3.5 py-2.5">
                  <Info size={14} className="mt-0.5 flex-none text-brand-400" />
                  <p className="text-[0.72rem] leading-relaxed text-brand-100/70">
                    <span className="font-semibold text-brand-200">{selectedSoftware.label}</span> ·{" "}
                    {selectedSoftware.description}
                    {(selectedSoftware as any).java ? ` · requires Java ${(selectedSoftware as any).java}` : ""}
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Resources" subtitle="CPU, memory, storage and network allocation" icon={<Cpu size={16} />} />
            <div className="mt-5 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="zk-label !mb-0">Memory (RAM)</label>
                  <span className="font-mono text-[0.72rem] text-brand-300">{formatMb(form.ram)}</span>
                </div>
                <input
                  type="range"
                  min={512}
                  max={maxRam}
                  step={512}
                  value={form.ram}
                  onChange={(e) => setForm((f) => ({ ...f, ram: Number(e.target.value) }))}
                  className="w-full accent-brand-500"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {RAM_PRESETS.filter((r) => r <= maxRam).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, ram: preset }))}
                      className={`rounded-lg border px-2.5 py-1 text-[0.68rem] font-medium transition ${
                        form.ram === preset
                          ? "border-brand-500/40 bg-brand-500/15 text-brand-200"
                          : "border-white/[0.07] text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                      }`}
                    >
                      {formatMb(preset)}
                    </button>
                  ))}
                </div>
                {errors.ram && <p className="mt-1.5 text-[0.7rem] text-red-400">{errors.ram}</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="zk-label">CPU cores</label>
                  <div className="flex gap-1.5">
                    {CPU_PRESETS.filter((c) => c <= maxCpu).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, cpu: preset }))}
                        className={`flex-1 rounded-lg border py-1.5 text-[0.72rem] font-medium transition ${
                          form.cpu === preset
                            ? "border-brand-500/40 bg-brand-500/15 text-brand-200"
                            : "border-white/[0.07] text-zinc-500 hover:border-white/20"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  {errors.cpu && <p className="mt-1.5 text-[0.7rem] text-red-400">{errors.cpu}</p>}
                </div>
                <div>
                  <label className="zk-label">Disk space</label>
                  <select
                    className="zk-select"
                    value={form.disk}
                    onChange={(e) => setForm((f) => ({ ...f, disk: Number(e.target.value) }))}
                  >
                    {DISK_PRESETS.filter((d) => d <= maxDisk).map((preset) => (
                      <option key={preset} value={preset}>
                        {formatMb(preset)}
                      </option>
                    ))}
                  </select>
                  {errors.disk && <p className="mt-1.5 text-[0.7rem] text-red-400">{errors.disk}</p>}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Network port" required error={errors.port} hint="Players connect via your-node-ip:port">
                  <input
                    type="number"
                    className="zk-input font-mono"
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                  />
                </Field>
                <div className="flex items-end">
                  <div className="w-full rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[0.7rem]">
                    {portCheck.checking ? (
                      <span className="flex items-center gap-1.5 text-zinc-500">
                        <Loader2 size={12} className="zk-spin" /> Checking availability…
                      </span>
                    ) : portCheck.inUse ? (
                      <span className="text-red-400">Port {form.port} is already allocated</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <Check size={12} /> Port {form.port} is available
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="sticky top-20">
            <CardHeader title="Summary" subtitle="Review before provisioning" icon={<Rocket size={16} />} />
            <div className="mt-4 space-y-2 text-[0.76rem]">
              {[
                ["Name", form.name || "—"],
                ["Owner", users?.find((u) => u.id === form.ownerId)?.username || "—"],
                ["Node", nodes?.find((n) => n.id === form.nodeId)?.name || form.nodeId],
                ["Software", `${form.software} ${form.version || "—"}`],
                ["Memory", formatMb(form.ram)],
                ["CPU", `${form.cpu} core(s)`],
                ["Disk", formatMb(form.disk)],
                ["Port", String(form.port)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-white/[0.04] pb-1.5">
                  <span className="text-zinc-500">{label}</span>
                  <span className="truncate font-medium text-zinc-200">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-zinc-300">
                <Network size={12} className="text-brand-400" /> Auto-restart
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="zk-checkbox"
                  checked={form.autoRestart}
                  onChange={(e) => setForm((f) => ({ ...f, autoRestart: e.target.checked }))}
                />
                <span className="text-[0.7rem] text-zinc-400">Restart automatically after a crash</span>
              </label>
            </div>

            <Button type="submit" variant="primary" className="mt-4 w-full py-2.5" loading={creating} icon={<Rocket size={15} />}>
              {creating ? "Provisioning…" : "Create server"}
            </Button>
            <p className="mt-2 text-center text-[0.64rem] leading-relaxed text-zinc-600">
              The jar is downloaded in the background. Large versions can take a minute.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-1.5 text-center">
              {[
                { icon: <MemoryStick size={12} />, value: formatMb(form.ram) },
                { icon: <Cpu size={12} />, value: `${form.cpu}c` },
                { icon: <HardDrive size={12} />, value: formatMb(form.disk) },
              ].map((item, i) => (
                <div key={i} className="zk-inset py-2">
                  <span className="flex items-center justify-center gap-1 text-brand-400">{item.icon}</span>
                  <p className="mt-0.5 font-mono text-[0.66rem] text-zinc-400">{item.value}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </form>

      <Modal
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        title="Server created successfully"
        subtitle="Installation is running in the background"
        icon={<Check size={16} />}
        footer={
          <>
            <Button onClick={() => setCreated(null)}>Create another</Button>
            <Button variant="primary" onClick={() => navigate(`/servers/${created?.id}`)}>
              Open server
            </Button>
          </>
        }
      >
        {created && (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
              <p className="text-sm font-semibold text-emerald-100">{created.name}</p>
              <p className="mt-1 font-mono text-[0.72rem] text-emerald-200/70">
                {created.software} {created.version} · {formatMb(created.ram)} · port {created.port}
              </p>
            </div>
            <div className="space-y-1.5 text-[0.74rem]">
              {[
                ["Server ID", created.id],
                ["Owner", created.ownerName],
                ["Node", created.nodeId],
                ["Status", created.status],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-zinc-500">{label}</span>
                  <span className="truncate font-mono text-zinc-300">{value}</span>
                </div>
              ))}
            </div>
            <p className="text-[0.7rem] leading-relaxed text-zinc-500">
              The console tab will show live installation output. Once complete the status changes from
              "installing" to "offline" and you can start the server.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

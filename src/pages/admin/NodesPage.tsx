import React, { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Plus,
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  WifiOff,
  Trash2,
  RefreshCw,
  Activity,
  Copy,
  AlertTriangle,
  Check,
  X,
  TerminalSquare,
  KeyRound,
  Download,
  PlugZap,
  ShieldCheck,
  Server,
  DownloadCloud,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, Button, Badge, Field, Modal, PageSkeleton, Progress, StatCard, EmptyState } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { copyToClipboard, formatMb, relativeTime } from "../../lib/format";

/* --------------------------------------------------------------- helpers */

const DAEMON_ZIP = "/downloads/zkdaemon.zip";

/**
 * Node status is decided by the socket, not by a stored flag: a daemon that
 * dropped reads as offline even if its last write said otherwise.
 */
const isOnline = (node: any) => node?.id === "local" || Boolean(node?.connected);

const Meter: React.FC<{ label: string; icon: React.ReactNode; value: number; max: number; unit: string }> = ({
  label,
  icon,
  value,
  max,
  unit,
}) => {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct > 90 ? "danger" : pct > 70 ? "warn" : "brand";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.55rem] uppercase tracking-[0.14em] text-zinc-600">
          {icon} {label}
        </span>
        <span className="font-mono text-[0.62rem] text-zinc-400">
          {max ? `${formatMb(value)} / ${formatMb(max)}` : "—"}
        </span>
      </div>
      <div className="mt-1">
        <Progress value={pct} tone={tone} />
      </div>
      <p className="mt-0.5 text-right font-mono text-[0.55rem] text-zinc-600">{max ? `${pct}%` : unit}</p>
    </div>
  );
};

/* ------------------------------------------------------------------- page */

export const NodesPage: React.FC = () => {
  useDocumentTitle("Nodes · ZK-MC3-PANEL");
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/nodes");
  const nodes = data || [];

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", location: "" });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [busy, setBusy] = useState("");
  const [pinging, setPinging] = useState("");

  // Keep the detail sheet and the freshly created node in sync with polling.
  useEffect(() => {
    if (!detail) return;
    const fresh = nodes.find((n) => n.id === detail.id);
    if (fresh) setDetail(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!created) return;
    const fresh = nodes.find((n) => n.id === created.id);
    if (fresh && fresh.status === "online" && created.status !== "online") {
      success("Node connected", `${fresh.name} is online — ${fresh.hostname || fresh.ip}.`);
    }
    if (fresh) setCreated(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const openWizard = () => {
    setForm({ name: "", location: "" });
    setCreated(null);
    setOpen(true);
  };

  const create = async () => {
    if (!form.name.trim()) return error("Give the node a name");
    setSaving(true);
    try {
      const node = await api<any>("/nodes", { method: "POST", body: form });
      setCreated(node);
      await copyToClipboard(node.installCommand).catch(() => {});
      success("Node added", "The install command is on your clipboard.");
      reload();
    } catch (err: any) {
      error("Could not add the node", err.message);
    } finally {
      setSaving(false);
    }
  };

  const ping = async (node: any) => {
    setPinging(node.id);
    try {
      const result = await api<{ ok: boolean; latencyMs: number }>(`/nodes/${node.id}/ping`, { method: "POST" });
      success(`${node.name} answered`, `${result.latencyMs} ms round-trip to the daemon.`);
    } catch (err: any) {
      error(`${node.name} did not answer`, err.message);
    } finally {
      setPinging("");
      reload();
    }
  };

  const rotate = async (node: any) => {
    const ok = await confirm({
      title: "Rotate this node's token?",
      message:
        "The daemon on that machine keeps the old token and will be locked out until you restart it with the new one.",
      danger: true,
      confirmLabel: "Rotate token",
    });
    if (!ok) return;
    try {
      const result = await api<{ installCommand: string }>(`/nodes/${node.id}/token/rotate`, { method: "POST" });
      await copyToClipboard(result.installCommand).catch(() => {});
      success("Token rotated", "The new command is on your clipboard.");
      reload();
    } catch (err: any) {
      error("Rotate failed", err.message);
    }
  };

  const remove = async (node: any) => {
    const ok = await confirm({
      title: `Remove "${node.name}"?`,
      message: "Servers assigned to it must be moved or deleted first. The daemon on that machine can be stopped.",
      danger: true,
      confirmLabel: "Remove node",
    });
    if (!ok) return;
    setBusy(node.id);
    try {
      await api(`/nodes/${node.id}`, { method: "DELETE" });
      success("Node removed");
      setDetail(null);
      reload();
    } catch (err: any) {
      error("Remove failed", err.message);
    } finally {
      setBusy("");
    }
  };

  const totals = useMemo(
    () =>
      nodes.reduce(
        (acc, n) => ({
          servers: acc.servers + (n.serverCount || 0),
          online: acc.online + (isOnline(n) ? 1 : 0),
          cores: acc.cores + (n.capacity?.cpuCores || 0),
          ram: acc.ram + (n.capacity?.memoryMb || 0),
        }),
        { servers: 0, online: 0, cores: 0, ram: 0 }
      ),
    [nodes]
  );

  if (loading && !data) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nodes"
        subtitle="Machines that run your game servers. Each one runs a small daemon that connects out to this panel — no ports, no firewall rules."
        icon={<Boxes size={20} />}
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={reload}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={openWizard}>
              Add node
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Nodes online" value={`${totals.online}/${nodes.length}`} icon={<Wifi size={14} />} />
        <StatCard label="Servers hosted" value={totals.servers} icon={<Server size={14} />} />
        <StatCard label="Total cores" value={totals.cores || "—"} icon={<Cpu size={14} />} />
        <StatCard label="Total memory" value={totals.ram ? formatMb(totals.ram) : "—"} icon={<MemoryStick size={14} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {nodes.map((node) => {
          const online = isOnline(node);
          const local = node.id === "local";
          return (
            <Card key={node.id} className="relative overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "h-1.5 w-1.5 flex-none rounded-full " +
                        (online ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60" : "bg-zinc-600")
                      }
                    />
                    <h3 className="truncate text-sm font-medium text-zinc-100">{node.name}</h3>
                    {local && <Badge tone="info">built-in</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[0.62rem] text-zinc-600">
                    {node.hostname || (local ? "this panel" : "waiting for the daemon")}
                    {node.ip && node.ip !== "127.0.0.1" ? ` · ${node.ip}` : ""}
                  </p>
                </div>
                <Badge tone={online ? "online" : "offline"}>{online ? "online" : "offline"}</Badge>
              </div>

              <div className="mt-3 grid gap-3 px-4">
                <Meter
                  label="CPU"
                  icon={<Cpu size={9} />}
                  value={node.usage?.cpu || 0}
                  max={100}
                  unit={`${node.capacity?.cpuCores || 0} cores`}
                />
                <Meter
                  label="Memory"
                  icon={<MemoryStick size={9} />}
                  value={node.usage?.ram || 0}
                  max={node.capacity?.memoryMb || 0}
                  unit="—"
                />
                <Meter
                  label="Disk"
                  icon={<HardDrive size={9} />}
                  value={node.usage?.disk || 0}
                  max={node.capacity?.diskMb || 0}
                  unit="—"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2 text-[0.6rem] text-zinc-600">
                <span className="flex min-w-0 items-center gap-1">
                  {online ? (
                    <Activity size={10} className="text-emerald-400" />
                  ) : (
                    <WifiOff size={10} className="text-zinc-600" />
                  )}
                  <span className="truncate">{node.connectivity}</span>
                </span>
                <span className="flex-none">
                  {node.serverCount} server{node.serverCount === 1 ? "" : "s"}
                  {node.lastSeen ? ` · seen ${relativeTime(node.lastSeen)}` : ""}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] px-4 py-2">
                <Button size="sm" variant="ghost" icon={<TerminalSquare size={11} />} onClick={() => setDetail(node)}>
                  Details
                </Button>
                {!local && online && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<PlugZap size={11} />}
                    loading={pinging === node.id}
                    onClick={() => ping(node)}
                  >
                    Ping
                  </Button>
                )}
                {!local && (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={11} />} onClick={() => remove(node)}>
                    Remove
                  </Button>
                )}
              </div>
            </Card>
          );
        })}

        {!nodes.length && (
          <Card className="lg:col-span-2">
            <EmptyState
              icon={<Boxes size={20} />}
              title="No nodes yet"
              message="Add a machine to run servers on it. You will get a single command to paste there."
              action={
                <Button variant="primary" icon={<Plus size={13} />} onClick={openWizard}>
                  Add node
                </Button>
              }
            />
          </Card>
        )}
      </div>

      {/* ═══════════════════════════ add node ═════════════════════════ */}
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reload();
        }}
        title={created ? "Node added" : "Add a node"}
        subtitle={created ? "Run one command on the machine" : "Name it, then paste one command on the machine"}
        icon={<Boxes size={16} />}
        width="max-w-2xl"
        footer={
          created ? (
            <>
              <Button onClick={() => setOpen(false)}>Close</Button>
              <Button icon={<RefreshCw size={12} />} onClick={reload}>
                Check again
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} icon={<Plus size={13} />} onClick={create}>
                Add node
              </Button>
            </>
          )
        }
      >
        {!created ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Node name" required hint="Shown on the card, e.g. EU-2 or VPS-Frankfurt.">
                <input
                  className="zk-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="EU-2"
                  autoFocus
                />
              </Field>
              <Field label="Location" hint="Optional.">
                <input
                  className="zk-input"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Frankfurt, DE"
                />
              </Field>
            </div>

            <div className="rounded-lg border border-white/[0.07] bg-black/25 p-3">
              <p className="text-[0.7rem] leading-relaxed text-zinc-400">
                That is everything. The panel issues a token and shows you one command. The daemon on the node dials{" "}
                <span className="text-zinc-200">out</span> to this panel over WebSocket, so you never open a port, find
                an IP, or touch a firewall.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── the token: shown once ────────────────────────────────── */}
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-amber-300/80">
                  <KeyRound size={10} /> Node token
                </span>
                <Badge tone="warn">shown once</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded border border-white/[0.08] bg-black/45 px-2 py-1.5 font-mono text-[0.68rem] text-amber-100">
                  {created.token}
                </code>
                <Button
                  size="sm"
                  icon={<Copy size={11} />}
                  onClick={() => copyToClipboard(created.token).then(() => success("Token copied"))}
                >
                  Copy
                </Button>
              </div>
              <p className="mt-1.5 text-[0.6rem] leading-relaxed text-amber-200/60">
                Not shown again. If you lose it, open the node and rotate the token.
              </p>
            </div>

            {/* ── 1 · download ─────────────────────────────────────────── */}
            <div className="rounded-lg border border-white/[0.07] p-3">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                1 · Get the daemon onto the machine
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={DAEMON_ZIP}
                  download
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.68rem] font-medium text-zinc-200 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <DownloadCloud size={12} /> Download zkdaemon.zip
                </a>
                <span className="text-[0.6rem] text-zinc-600">or</span>
                <code className="rounded border border-white/[0.08] bg-black/40 px-2 py-1 font-mono text-[0.62rem] text-zinc-400">
                  wget {window.location.origin}
                  {DAEMON_ZIP}
                </code>
              </div>
            </div>

            {/* Warnings the panel raised about the command's reachability. */}
            {(created.warnings || []).length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
                {(created.warnings as string[]).map((w) => (
                  <p key={w} className="flex items-start gap-1.5 text-[0.63rem] leading-relaxed text-amber-200">
                    <AlertTriangle size={11} className="mt-0.5 flex-none" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}

            {/* ── 2 · run ──────────────────────────────────────────────── */}
            <div className="rounded-lg border border-white/[0.07] p-3">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                2 · Unzip and run it
              </p>
              <div className="relative mt-2">
                <pre className="zk-console max-h-[140px] overflow-auto !text-[0.64rem] leading-relaxed">
{`unzip zkdaemon.zip && cd zkdaemon
sudo bash install.sh ${created.token} ${created.panelUrl}`}
                </pre>
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      `unzip zkdaemon.zip && cd zkdaemon\nsudo bash install.sh ${created.token} ${created.panelUrl}`
                    ).then(() => success("Command copied"))
                  }
                  className="absolute right-2 top-2 rounded border border-white/10 bg-black/70 p-1.5 text-zinc-400 transition hover:text-white"
                  title="Copy command"
                >
                  <Copy size={11} />
                </button>
              </div>
              <p className="mt-2 text-[0.6rem] leading-relaxed text-zinc-600">
                Installs it as a systemd service that survives a reboot. Already have it? Just run{" "}
                <code className="font-mono text-zinc-500">node .</code> inside the folder — it reads{" "}
                <code className="font-mono text-zinc-500">config.json</code>.
              </p>
            </div>

            {/* ── 3 · watch ────────────────────────────────────────────── */}
            <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (created.status === "online" ? "bg-emerald-400" : "bg-amber-400 animate-pulse")
                  }
                />
                <span className="text-[0.68rem] text-zinc-300">
                  {created.status === "online"
                    ? `Connected — ${created.hostname || created.ip} · ${created.capacity?.cpuCores} cores · ${formatMb(created.capacity?.memoryMb || 0)}`
                    : "Waiting for the daemon to connect…"}
                </span>
              </div>
              {created.status === "online" && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Address", created.ip || "—"],
                    ["Platform", created.hostInfo?.platform || "—"],
                    ["Cores", String(created.capacity?.cpuCores ?? "—")],
                    ["Memory", formatMb(created.capacity?.memoryMb || 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                      <p className="text-[0.52rem] uppercase tracking-[0.14em] text-zinc-600">{label}</p>
                      <p className="truncate font-mono text-[0.66rem] text-zinc-300">{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ═══════════════════════════ detail ═════════════════════════ */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name || "Node"}
        subtitle={detail ? (detail.hostname || detail.ip || "no address yet") : undefined}
        icon={<Boxes size={16} />}
        width="max-w-xl"
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ["Status", isOnline(detail) ? "online" : "offline"],
                ["Daemon", detail.daemonVersion ? `v${detail.daemonVersion}` : "—"],
                ["Address", detail.ip || "—"],
                ["Platform", detail.hostInfo?.platform || "—"],
                ["CPU", detail.hostInfo?.cpuModel || "—"],
                ["Java", detail.java?.version || (detail.java?.installed ? "installed" : "not installed")],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                  <p className="text-[0.52rem] uppercase tracking-[0.14em] text-zinc-600">{label}</p>
                  <p className="truncate font-mono text-[0.66rem] text-zinc-300" title={String(value)}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-[0.66rem] leading-relaxed text-zinc-500">{detail.connectivity}</p>

            {detail.id !== "local" && (
              <div className="space-y-2 rounded-lg border border-white/[0.07] p-3">
                <p className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <ShieldCheck size={10} /> Token
                </p>
                <p className="text-[0.62rem] leading-relaxed text-zinc-600">
                  The token is only shown once, when the node is added. If it is lost, rotate it — the daemon must then
                  be restarted with the new value.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<KeyRound size={11} />} onClick={() => rotate(detail)}>
                    Rotate token
                  </Button>
                  <a
                    href={DAEMON_ZIP}
                    download
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.68rem] font-medium text-zinc-200 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    <Download size={11} /> Daemon zip
                  </a>
                </div>
              </div>
            )}

            {detail.id === "local" && (
              <p className="flex items-start gap-1.5 text-[0.62rem] leading-relaxed text-zinc-600">
                <Check size={11} className="mt-0.5 flex-none text-emerald-400" />
                The built-in node runs inside this panel process and needs no daemon.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default NodesPage;

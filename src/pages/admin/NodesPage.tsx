import React, { useEffect, useMemo, useState } from "react";
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
  Check,
  X,
  Loader2,
  TerminalSquare,
  KeyRound,
  PlugZap,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
  Card,
  CardHeader,
  Button,
  Badge,
  Field,
  Modal,
  PageSkeleton,
  Progress,
  StatCard,
  EmptyState,
  Tabs,
} from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { copyToClipboard, formatMb, formatUptime, relativeTime } from "../../lib/format";

/* --------------------------------------------------------------- helpers */

type Probe = {
  reachable: boolean;
  authenticated: boolean;
  message: string;
  latencyMs: number | null;
  system?: any;
  java?: any;
  processes?: any[];
  /** What the agent says its own reachable address is. */
  publicAddress?: AgentAddress | null;
};

type AgentAddress = {
  host: string;
  port: number;
  protocol: string;
  localIp?: string;
  publicIp?: string | null;
  codespace?: boolean;
  portForwardUrl?: string | null;
  source?: string;
};

/** The agent port the installer uses (`AGENT_PORT`, default 6768). */
const DEFAULT_AGENT_PORT = 6768;

const emptyForm = {
  name: "",
  hostname: "",
  ip: "",
  port: DEFAULT_AGENT_PORT,
  protocol: "http" as "http" | "https",
  cpuCores: "",
  memoryMb: "",
  diskMb: "",
  location: "",
  description: "",
};

/** The one-line installer, published with the panel itself. */
const INSTALLER_URL = `${window.location.origin}/install-agent.sh`;


/** A three-step progress row used inside the setup sheet. */
const Step: React.FC<{
  index: number;
  title: string;
  done?: boolean;
  active?: boolean;
  children?: React.ReactNode;
}> = ({ index, title, done, active, children }) => (
  <div className="flex gap-3">
    <div className="flex flex-col items-center">
      <span
        className={
          "flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[0.6rem] font-bold " +
          (done
            ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
            : active
            ? "border-white/40 bg-white/10 text-white"
            : "border-white/10 bg-white/[0.03] text-zinc-600")
        }
      >
        {done ? <Check size={11} /> : index}
      </span>
      <span className="mt-1 w-px flex-1 bg-white/[0.08]" />
    </div>
    <div className="min-w-0 flex-1 pb-4">
      <p className={"text-[0.78rem] font-medium " + (done || active ? "text-zinc-100" : "text-zinc-500")}>{title}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  </div>
);

const ProbeResult: React.FC<{ probe: Probe }> = ({ probe }) => (
  <div
    className={
      "flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.7rem] leading-relaxed " +
      (probe.authenticated
        ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-200"
        : probe.reachable
        ? "border-amber-500/25 bg-amber-500/[0.07] text-amber-200"
        : "border-rose-500/25 bg-rose-500/[0.07] text-rose-200")
    }
  >
    {probe.authenticated ? (
      <Check size={13} className="mt-px flex-none" />
    ) : probe.reachable ? (
      <AlertTriangle size={13} className="mt-px flex-none" />
    ) : (
      <X size={13} className="mt-px flex-none" />
    )}
    <div className="min-w-0">
      <p className="font-medium">{probe.message}</p>
      {probe.authenticated && probe.system && (
        <p className="mt-0.5 font-mono text-[0.62rem] text-emerald-300/70">
          {probe.system.hostname} · {probe.system.cpuCores} cores · {formatMb(probe.system.memoryTotalMb)} RAM ·{" "}
          {probe.latencyMs} ms
        </p>
      )}
    </div>
  </div>
);

/* ------------------------------------------------------------------- page */

export const NodesPage: React.FC = () => {
  useDocumentTitle("Nodes · ZK-MC3-PANEL");
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/nodes");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [agentToken, setAgentToken] = useState("");
  const [detected, setDetected] = useState<AgentAddress | null>(null);
  const [touchedIp, setTouchedIp] = useState(false);
  const [busy, setBusy] = useState("");
  const [detail, setDetail] = useState<any | null>(null);
  const [detailTab, setDetailTab] = useState("overview");

  const nodes = data || [];

  /**
   * The base URL a *remote* machine should use to reach this panel. Derived
   * from the app's own origin by default, but editable, because a panel on
   * localhost cannot hand a public URL to a VPS.
   */
  const [panelBase, setPanelBase] = useState(
    () => localStorage.getItem("zk.panelBase") || window.location.origin
  );
  const updatePanelBase = (value: string) => {
    setPanelBase(value);
    localStorage.setItem("zk.panelBase", value);
  };

  useEffect(() => {
    // Keep the open detail sheet in sync with the latest poll.
    if (!detail) return;
    const fresh = nodes.find((n) => n.id === detail.id);
    if (fresh) setDetail(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const openWizard = () => {
    setForm({ ...emptyForm });
    setProbe(null);
    setCreatedId(null);
    setAgentToken("");
    setDetected(null);
    setTouchedIp(false);
    setIsWaiting(false);
    setWizardOpen(true);
  };

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  /** The node we just created, as the latest poll sees it. */
  const live = createdId ? nodes.find((n) => n.id === createdId) : null;
  const [isWaiting, setIsWaiting] = useState(false);

  // While the sheet is open and the node has not checked in, look again sooner
  // than the global poll — this is the moment the operator is watching.
  useEffect(() => {
    if (!isWaiting || !createdId || live?.status === "online") return;
    const timer = setInterval(async () => {
      await reload();
      const fresh = await api<any[]>("/nodes").catch(() => null);
      if (fresh?.find((n) => n.id === createdId)?.status === "online") {
        setIsWaiting(false);
        success("Node connected", "The agent called in — it is online now.");
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [isWaiting, createdId, live?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const testConnection = async () => {
    if (!form.ip.trim()) return error("Enter the node's IP or hostname first");
    setTesting(true);
    setProbe(null);
    try {
      const result = await api<{ ok: boolean; probe: Probe }>("/nodes/validate", {
        method: "POST",
        body: { ...form, token: agentToken },
      });
      setProbe(result.probe);
      if (result.probe.publicAddress?.host) {
        const address = result.probe.publicAddress;
        setDetected(address);
        // Never clobber an address the operator typed deliberately.
        if (!touchedIp) {
          setForm((f) => ({
            ...f,
            ip: address.host,
            port: address.port || f.port,
            protocol: address.protocol === "https" ? "https" : "http",
          }));
        }
      }
    } catch (err: any) {
      error("Test failed", err.message);
    } finally {
      setTesting(false);
    }
  };

  const createAndInstall = async () => {
    if (!form.name.trim()) return error("Give the node a name");
    setSaving(true);
    try {
      const node = await api<any>("/nodes", {
        method: "POST",
        body: {
          ...form,
          // The address is discovered by the agent; until then it is a
          // placeholder that is corrected the moment the node checks in.
          ip: form.ip.trim(),
          port: form.port || DEFAULT_AGENT_PORT,
        },
      });
      setCreatedId(node.id);
      setDetail(null);
      const issued = await api<{ token: string }>(`/nodes/${node.id}/token`);
      setAgentToken(issued.token);
      await copyToClipboard(installCommand(issued.token, panelBase)).catch(() => {});
      success("Node reserved", "Paste the command on that machine — it connects itself.");
      reload();
    } catch (err: any) {
      error("Could not add node", err.message);
    } finally {
      setSaving(false);
    }
  };

  const testNode = async (node: any) => {
    setBusy(node.id);
    try {
      const result = await api<{ ok: boolean; probe: Probe }>(`/nodes/${node.id}/test`, { method: "POST" });
      if (result.ok) success(`${node.name} is online`, result.probe.message);
      else error(`${node.name} is not reachable`, result.probe.message);
      reload();
    } catch (err: any) {
      error("Test failed", err.message);
    } finally {
      setBusy("");
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
      setDetail(null);
      reload();
    } catch (err: any) {
      error("Remove failed", err.message);
    }
  };

  const rotate = async (node: any) => {
    const ok = await confirm({
      title: "Rotate the agent token?",
      message: "The running agent keeps its old token and will go offline until you restart it with the new one.",
      danger: true,
      confirmLabel: "Rotate token",
    });
    if (!ok) return;
    try {
      const result = await api<{ token: string }>(`/nodes/${node.id}/token/rotate`, { method: "POST" });
      setAgentToken(result.token);
      await copyToClipboard(installCommand(result.token, panelBase));
      success("Token rotated", "The new token is shown above and its command is on your clipboard.");
      reload();
    } catch (err: any) {
      error("Rotate failed", err.message);
    }
  };

  const totals = useMemo(
    () =>
      nodes.reduce(
        (acc, n) => ({
          cpu: acc.cpu + (n.capacity?.cpuCores || 0),
          ram: acc.ram + (n.capacity?.memoryMb || 0),
          disk: acc.disk + (n.capacity?.diskMb || 0),
          servers: acc.servers + (n.serverCount || 0),
          online: acc.online + (n.status === "online" ? 1 : 0),
        }),
        { cpu: 0, ram: 0, disk: 0, servers: 0, online: 0 }
      ),
    [nodes]
  );

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Boxes size={20} />}
        title="Nodes"
        subtitle="Machines that run your game servers. Add one with the guided setup — it tests the connection as you go."
        actions={
          <>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Refresh
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={openWizard}>
              Add node
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Nodes"
          value={`${totals.online}/${nodes.length}`}
          icon={<Boxes size={16} />}
          hint="online / total"
          accent
        />
        <StatCard label="Total cores" value={totals.cpu} icon={<Cpu size={16} />} />
        <StatCard label="Total memory" value={formatMb(totals.ram)} icon={<MemoryStick size={16} />} />
        <StatCard label="Servers deployed" value={totals.servers} icon={<Server size={16} />} />
      </div>

      {nodes.length === 0 ? (
        <EmptyState
          icon={<Boxes size={22} />}
          title="No nodes registered"
          message="Add your first remote node to scale beyond this machine."
          action={
            <Button variant="primary" icon={<Plus size={14} />} onClick={openWizard}>
              Add node
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {nodes.map((node) => {
            const memPct = node.usage?.memoryPercent || 0;
            const diskPct = node.usage?.diskPercent || 0;
            const online = node.status === "online";
            const isLocal = node.id === "local";
            return (
              <Card key={node.id} hover className="!p-0">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={
                        "relative flex h-10 w-10 flex-none items-center justify-center rounded-xl border " +
                        (online
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                          : "border-white/10 bg-white/[0.03] text-zinc-500")
                      }
                    >
                      {online ? <Wifi size={17} /> : <WifiOff size={17} />}
                      {online && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[#0a0a0c]" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-[0.92rem] font-semibold text-zinc-100">{node.name}</h3>
                        <Badge tone={isLocal ? "brand" : online ? "online" : "offline"} dot>
                          {isLocal ? "built-in" : node.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[0.68rem] text-zinc-500">
                        {node.ip}:{node.port}
                        {node.hostname ? ` · ${node.hostname}` : ""}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.64rem] text-zinc-600">
                        <span className="flex items-center gap-1">
                          <MapPin size={10} /> {node.location || "Unassigned"}
                        </span>
                        <span>·</span>
                        <span>{node.serverCount} servers</span>
                        {node.hostInfo?.cpuModel && (
                          <>
                            <span>·</span>
                            <span className="truncate">{node.hostInfo.cpuModel}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5">
                    {!isLocal && (
                      <>
                        <button
                          onClick={() => testNode(node)}
                          disabled={busy === node.id}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                          title="Test connection"
                        >
                          {busy === node.id ? <Loader2 size={12} className="zk-spin" /> : <PlugZap size={12} />}
                        </button>
                        <button
                          onClick={() => rotate(node)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/10 hover:text-white"
                          title="Rotate agent token"
                        >
                          <KeyRound size={12} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setDetail(node);
                        setDetailTab("overview");
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/10 hover:text-white"
                      title="Details"
                    >
                      <ChevronRight size={13} />
                    </button>
                    {!isLocal && (
                      <button
                        onClick={() => remove(node)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition hover:bg-red-500/15 hover:text-red-300"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* live meters, three across */}
                <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-y border-white/[0.05]">
                  {[
                    { label: "CPU", value: `${node.usage?.cpu ?? 0}%`, pct: node.usage?.cpu ?? 0, tone: "#ff7a18" },
                    {
                      label: "Memory",
                      value: `${formatMb(node.usage?.ram ?? 0)} / ${formatMb(node.capacity?.memoryMb ?? 0)}`,
                      pct: memPct,
                      tone: memPct > 85 ? "#ef4444" : "#38bdf8",
                    },
                    {
                      label: "Disk",
                      value: `${formatMb(node.usage?.disk ?? 0)} / ${formatMb(node.capacity?.diskMb ?? 0)}`,
                      pct: diskPct,
                      tone: diskPct > 85 ? "#ef4444" : "#a78bfa",
                    },
                  ].map((meter) => (
                    <div key={meter.label} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[0.56rem] font-bold uppercase tracking-[0.12em] text-zinc-600">{meter.label}</span>
                        <span className="font-mono text-[0.62rem] text-zinc-400">{Math.round(meter.pct)}%</span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[0.68rem] text-zinc-300">{meter.value}</p>
                      <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${Math.min(100, meter.pct)}%`, background: meter.tone }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[0.62rem] text-zinc-600">
                  <span className="flex min-w-0 items-center gap-1">
                    {online ? <Activity size={10} className="text-emerald-400" /> : <AlertTriangle size={10} className="text-amber-500/70" />}
                    <span className="truncate">{node.connectivity}</span>
                  </span>
                  <span className="flex-none">
                    {online && node.hostInfo?.uptime ? `up ${formatUptime(node.hostInfo.uptime)} · ` : ""}
                    {node.lastSeen ? `seen ${relativeTime(node.lastSeen)}` : "never seen"}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════ add-node wizard ═════════════════════ */}
      <Modal
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          reload();
        }}
        title="Add a node"
        subtitle="Connect a machine that will run game servers"
        icon={<Boxes size={16} />}
        width="max-w-3xl"
        footer={
          createdId ? (
            <>
              <Button onClick={() => setWizardOpen(false)}>Close</Button>
              <Button variant="primary" icon={<RefreshCw size={12} />} onClick={reload}>
                Re-check status
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setWizardOpen(false)}>Cancel</Button>
              {probe && (
                <Button icon={<PlugZap size={13} />} loading={testing} onClick={testConnection}>
                  Test address
                </Button>
              )}
              <Button variant="primary" loading={saving} icon={<Plus size={13} />} onClick={createAndInstall}>
                Generate token
              </Button>
            </>
          )
        }
      >
        <div className="space-y-1">
          <Step index={1} title="Name the machine" done={Boolean(createdId)} active={!createdId}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Node name" required>
                <input
                  className="zk-input"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="EU-2"
                  autoFocus
                />
              </Field>
              <Field label="Location" hint="Optional — shown on the node card.">
                <input
                  className="zk-input"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Frankfurt, DE"
                />
              </Field>
            </div>
            <p className="mt-2 text-[0.64rem] leading-relaxed text-zinc-600">
              That is all you type. The agent reports its own public IP, port and capacity the moment it connects.
            </p>
          </Step>

          <Step index={2} title="Run one command on that machine" done={Boolean(createdId) && false} active={Boolean(createdId)}>
            {createdId ? (
              <div className="space-y-3">
                {/* ── the token, whole, once ─────────────────────────────── */}
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-amber-300/80">
                      <KeyRound size={10} /> Agent token
                    </span>
                    <Badge tone="warn">shown once</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 select-all break-all rounded border border-white/[0.08] bg-black/45 px-2 py-1.5 font-mono text-[0.68rem] text-amber-100">
                      {agentToken || "generating…"}
                    </code>
                    <Button
                      size="sm"
                      icon={<Copy size={11} />}
                      onClick={() => copyToClipboard(agentToken).then(() => success("Token copied"))}
                      disabled={!agentToken}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[0.6rem] leading-relaxed text-amber-200/60">
                    Keep this. It is not shown again — reopen the node and rotate it if you lose it.
                  </p>
                </div>

                {/* ── one command, nothing to edit ──────────────────────── */}
                <div className="relative">
                  <pre className="zk-console max-h-[120px] overflow-auto !text-[0.64rem] leading-relaxed">
{installCommand(agentToken, panelBase)}
                  </pre>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(installCommand(agentToken, panelBase)).then(() => success("Command copied"))
                    }
                    className="absolute right-2 top-2 rounded border border-white/10 bg-black/70 p-1.5 text-zinc-400 transition hover:text-white"
                    title="Copy command"
                  >
                    <Copy size={11} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    icon={<Copy size={12} />}
                    onClick={() =>
                      copyToClipboard(installCommand(agentToken, panelBase)).then(() => success("Command copied"))
                    }
                  >
                    Copy command
                  </Button>
                  <Button size="sm" icon={<RefreshCw size={12} />} onClick={() => setIsWaiting(true)}>
                    {isWaiting ? "Waiting for the agent…" : "Wait for it to connect"}
                  </Button>
                </div>
                <p className="text-[0.61rem] leading-relaxed text-zinc-600">
                  The command downloads <span className="font-mono text-zinc-400">install-agent.sh</span> from this
                  panel, so the token already knows where to dial back. It prints the node's real public address,
                  installs Node if missing, and starts the agent as a service.
                </p>
              </div>
            ) : (
              <p className="text-[0.68rem] leading-relaxed text-zinc-500">
                Press <span className="text-zinc-300">Generate token</span> and you get the full token plus the exact
                command to run — no IP hunting, no manual port juggling.
              </p>
            )}
          </Step>

          <Step
            index={3}
            title="The node connects itself"
            done={nodes.find((n) => n.id === createdId)?.status === "online"}
            active={Boolean(createdId)}
          >
            {createdId ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2">
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (live
                        ? "bg-emerald-400"
                        : "bg-amber-400 animate-pulse")
                    }
                  />
                  <span className="text-[0.7rem] text-zinc-300">
                    {live
                      ? `Connected — the panel detected ${live.hostInfo?.cpuModel || "this machine"} at ${live.ip}:${live.port}.`
                      : "Waiting for the agent to call in…"}
                  </span>
                </div>

                {/* What the node says about itself, when it is online. */}
                {live?.hostInfo && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Address", `${live.ip}`],
                      ["Port", String(live.port)],
                      ["Cores", String(live.capacity?.cpuCores ?? "—")],
                      ["Memory", formatMb(live.capacity?.memoryMb ?? 0)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                        <p className="text-[0.52rem] uppercase tracking-[0.14em] text-zinc-600">{label}</p>
                        <p className="truncate font-mono text-[0.68rem] text-zinc-300">{value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {live?.ip && live.ip !== "0.0.0.0" && (
                  <p className={
                    "text-[0.61rem] leading-relaxed " +
                    (live.status === "online" ? "text-emerald-300/70" : "text-zinc-600")
                  }>
                    {live.status === "online"
                      ? "Nothing else to do. The address above was reported by the agent itself."
                      : "If it stays offline, the panel cannot reach that address — check the firewall and the panel URL below."}
                  </p>
                )}

                {/* Where the installer came from — must be reachable by the node. */}
                <details className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
                  <summary className="cursor-pointer text-[0.62rem] text-zinc-500">
                    Panel address used by the installer
                  </summary>
                  <div className="mt-2 space-y-2">
                    <input
                      className="zk-input font-mono !text-[0.68rem]"
                      value={panelBase}
                      onChange={(e) => updatePanelBase(e.target.value)}
                      placeholder="http://203.0.113.5:31120"
                      spellCheck={false}
                    />
                    <p className="text-[0.58rem] leading-relaxed text-zinc-600">
                      Rendered from this browser's origin. If the node cannot reach it (localhost, or a Codespace
                      URL behind a private port), set the panel's public URL here — the command updates instantly.
                    </p>
                  </div>
                </details>
              </div>
            ) : (
              <p className="text-[0.68rem] leading-relaxed text-zinc-500">
                Status refreshes on its own. You can close this sheet and watch the card instead.
              </p>
            )}
          </Step>
        </div>
      </Modal>

      {/* ═══════════════════════════ node detail ═════════════════════════ */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name || "Node"}
        subtitle={detail ? `${detail.ip}:${detail.port}` : undefined}
        icon={<Boxes size={16} />}
        width="max-w-2xl"
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-3">
            <Tabs
              tabs={[
                { id: "overview", label: "Overview", icon: <Activity size={12} /> },
                { id: "agent", label: "Agent & token", icon: <TerminalSquare size={12} /> },
              ]}
              active={detailTab}
              onChange={setDetailTab}
            />

            {detailTab === "overview" && (
              <div className="space-y-3">
                <ProbeResult
                  probe={{
                    reachable: detail.status === "online",
                    authenticated: detail.status === "online",
                    message: detail.connectivity,
                    latencyMs: null,
                  }}
                />
                <div className="zk-cellgrid grid-cols-2 overflow-hidden rounded-lg">
                  {[
                    ["Status", detail.status],
                    ["Hostname", detail.hostname || "—"],
                    ["Cores", detail.capacity?.cpuCores ?? "—"],
                    ["Memory", formatMb(detail.capacity?.memoryMb ?? 0)],
                    ["Disk", formatMb(detail.capacity?.diskMb ?? 0)],
                    ["Platform", detail.hostInfo?.platform || "—"],
                    ["Java", detail.hostInfo?.java?.version || "not detected"],
                    ["Last seen", detail.lastSeen ? relativeTime(detail.lastSeen) : "never"],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <p className="zk-cell-label">{label}</p>
                      <p className="zk-cell-value">{String(value)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.id !== "local" && (
                    <>
                      <Button size="sm" icon={<PlugZap size={12} />} loading={busy === detail.id} onClick={() => testNode(detail)}>
                        Test connection
                      </Button>
                      <Button size="sm" icon={<Pencil size={12} />} onClick={() => { setDetail(null); setForm({ ...emptyForm, ...detail }); setWizardOpen(true); }}>
                        Edit address
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {detailTab === "agent" && (
              <div className="space-y-3">
                {detail.id === "local" ? (
                  <p className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2 text-[0.7rem] text-zinc-500">
                    The built-in node runs inside this panel process; it has no agent or token.
                  </p>
                ) : (
                  <>
                    <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2">
                      <p className="zk-eyebrow mb-1 flex items-center gap-1.5">
                        <ShieldCheck size={10} /> Token
                      </p>
                      <p className="font-mono text-[0.7rem] text-zinc-400">{detail.tokenHint || "not set"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        icon={<Copy size={12} />}
                        onClick={async () => {
                          try {
                            const result = await api<{ token: string }>(`/nodes/${detail.id}/token`);
                            await copyToClipboard(installCommand(result.token, panelBase));
                            success("Install command copied", "It carries this node's token.");
                          } catch (err: any) {
                            error("Could not fetch token", err.message);
                          }
                        }}
                      >
                        Copy install command
                      </Button>
                      <Button size="sm" icon={<KeyRound size={12} />} onClick={() => rotate(detail)}>
                        Rotate token
                      </Button>
                      <Button size="sm" icon={<Network size={12} />} onClick={() => testNode(detail)} loading={busy === detail.id}>
                        Test connection
                      </Button>
                    </div>
                    <pre className="zk-console max-h-[150px] overflow-auto !text-[0.6rem] leading-relaxed">
{`# On the node, as root:
curl -fsSL https://raw.githubusercontent.com/SKYDO234/ZK-MC3/main/install.sh -o install.sh
sudo ZK_PANEL_TOKEN=<token> AGENT_PORT=${detail.port} bash install.sh --agent

# or, if the repository is already on that host:
ZK_PANEL_TOKEN=<token> PORT=${detail.port} node agent/agent.cjs`}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

/** One copy-paste block that both installs and starts the agent. */
/**
 * The whole node setup, in one line. The token carries the panel's own address,
 * so the agent dials back to whoever issued it — nothing else to fill in, and
 * no way to typo the IP.
 */
const installCommand = (token: string, panelBase: string) =>
  `curl -fsSL ${panelBase}/install-agent.sh | sudo bash -s -- ${token || "<token>"}`;


/** Fallback for hosts that already have the repository. */
const directCommand = (token: string, port: number | string) =>
  `ZK_PANEL_TOKEN=${token || "<token>"} PORT=${port} node agent/agent.cjs`;

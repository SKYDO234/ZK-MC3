import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe2,
  Play,
  Square,
  RotateCw,
  Link2,
  ExternalLink,
  Loader2,
  AlertTriangle,
  ShieldOff,
  TerminalSquare,
  Copy,
  Check,
  Radio,
  ArrowRight,
  Wifi,
  Info,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

/**
 * Playit.gg tunnel
 * ---------------------------------------------------------------------------
 * Playit exposes a local port to the internet without port-forwarding. The panel
 * runs the official agent beside the server and shows:
 *
 *   • the tunnel state (with the real agent PID)
 *   • the claim URL, which must be opened once to bind the agent to a
 *     playit.gg account — after that the tunnel survives restarts
 *   • the agent's live output, so a failure is never a mystery
 *
 * The page is a two-column "status + stream" layout: the left column explains
 * what the current state means and offers the actions, the right column is the
 * agent log. Nothing is simulated — an agent that cannot download reports why.
 */

interface TunnelState {
  status: "running" | "stopped" | "starting" | "downloading" | "error";
  claimUrl: string | null;
  logs: string[];
  pid: number | null;
  startedAt: string | null;
  error: string | null;
  address?: string | null;
  localPort?: number;
}

const STATUS_UI: Record<
  string,
  { label: string; dot: string; text: string; ring: string; blurb: string }
> = {
  running: {
    label: "Tunnel live",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    ring: "shadow-[0_0_0_4px_rgba(52,211,153,0.12)]",
    blurb: "Your server is reachable from the internet through playit.gg.",
  },
  starting: {
    label: "Starting agent",
    dot: "bg-amber-400",
    text: "text-amber-300",
    ring: "shadow-[0_0_0_4px_rgba(251,191,36,0.12)]",
    blurb: "The agent is booting and negotiating a tunnel.",
  },
  downloading: {
    label: "Fetching agent",
    dot: "bg-sky-400",
    text: "text-sky-300",
    ring: "shadow-[0_0_0_4px_rgba(56,189,248,0.12)]",
    blurb: "Downloading the official playit binary for this node.",
  },
  error: {
    label: "Agent failed",
    dot: "bg-rose-500",
    text: "text-rose-300",
    ring: "shadow-[0_0_0_4px_rgba(244,63,94,0.12)]",
    blurb: "The tunnel could not start. The agent output on the right explains why.",
  },
  stopped: {
    label: "Tunnel stopped",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    ring: "",
    blurb: "Start the tunnel to generate a public address for this server.",
  },
};

export const PlayitTunnel: React.FC<{ serverId: string; enabled: boolean }> = ({ serverId, enabled }) => {
  const { success, error: toastError } = useToast();
  // Only an admin can act on the "disabled" notice, so only they get the link.
  const { isAdmin } = useAuth();
  const [state, setState] = useState<TunnelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "start" | "stop" | "restart" | "reset">("");
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      const data = await api<TunnelState>(`/servers/${serverId}/playit`);
      setState(data);
      setFetchError("");
    } catch (err: any) {
      setFetchError(err.message || "Could not read the tunnel state.");
    } finally {
      setLoading(false);
    }
  }, [serverId, enabled]);

  useEffect(() => {
    load();
    if (!enabled) return;
    // The agent needs a few seconds to print a claim URL, so poll while it matters.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [load, enabled]);

  /* follow the log tail */
  useEffect(() => {
    const el = logRef.current;
    if (!el || !autoScroll.current) return;
    el.scrollTop = el.scrollHeight;
  }, [state?.logs]);

  const run = async (action: "start" | "stop" | "restart" | "reset") => {
    setBusy(action);
    setConfirmReset(false);
    try {
      const data = await api<TunnelState>(`/servers/${serverId}/playit/${action}`, { method: "POST" });
      setState(data);
      if (action === "start" && data.status === "running") success("Tunnel started", "Follow the claim link if one is shown.");
      if (action === "stop") success("Tunnel stopped");
      if (action === "restart") success("Tunnel restarted", "The agent reconnected with its existing identity.");
      if (action === "reset") success("Agent reset", "Start the tunnel again for a new claim link.");
    } catch (err: any) {
      toastError("Tunnel action failed", err.message);
    } finally {
      setBusy("");
      load();
    }
  };

  const copyClaim = async () => {
    if (!state?.claimUrl) return;
    try {
      await navigator.clipboard.writeText(state.claimUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toastError("Copy failed", "Your browser blocked clipboard access.");
    }
  };

  /* ---------------------------------------------------------- gated view */
  if (!enabled) {
    return (
      <div className="rounded-xl border border-white/[0.07] zk-surface px-6 py-14 text-center">
        <ShieldOff size={26} className="mx-auto mb-3 text-zinc-600" />
        <h3 className="font-display text-base font-bold text-zinc-200">Playit tunnels are disabled</h3>
        <p className="mx-auto mt-1.5 max-w-md text-[0.78rem] leading-relaxed text-zinc-500">
          An administrator can switch them on under{" "}
          <span className="text-zinc-300">Panel Settings → Features → Playit.gg tunnels</span>. Once enabled, every
          server gets a Tunnel tab and can expose its port through playit.gg without any router configuration.
        </p>
        {isAdmin && (
          <Link
            to="/admin/settings?tab=features"
            className="zk-btn zk-btn-primary mt-4 inline-flex !justify-center"
          >
            Open feature settings
          </Link>
        )}
      </div>
    );
  }

  const ui = STATUS_UI[state?.status || "stopped"] || STATUS_UI.stopped;
  const isBusy = Boolean(busy);
  const logs = state?.logs || [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* ══════════════════════════════════ status column ═══════════════════ */}
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-white/[0.07] zk-surface">
          <div className="flex items-center gap-2 border-b border-white/[0.06] zk-surface px-4 py-2.5">
            <Globe2 size={13} className="text-brand-500" />
            <span className="zk-eyebrow">
              tunnel
            </span>
            {state?.pid && (
              <span className="ml-auto rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.55rem] text-zinc-500">
                pid {state.pid}
              </span>
            )}
          </div>

          <div className="px-4 py-4">
            <div className="flex items-center gap-2.5">
              <span className={`relative flex h-2.5 w-2.5 ${ui.ring} rounded-full`}>
                {state?.status === "running" && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${ui.dot}`} />
              </span>
              <span className={`text-[0.9rem] font-semibold ${ui.text}`}>{ui.label}</span>
              {state?.status === "running" && (
                <span className="ml-auto flex items-center gap-1 font-mono text-[0.58rem] text-zinc-600">
                  <Radio size={9} className="text-emerald-400" />
                  public
                </span>
              )}
            </div>
            <p className="mt-2 text-[0.74rem] leading-relaxed text-zinc-500">{ui.blurb}</p>

            {state?.error && state.status === "error" && (
              <>
                <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-2 text-[0.7rem] leading-relaxed text-rose-300">
                  <AlertTriangle size={12} className="mt-0.5 flex-none" />
                  <span className="min-w-0 break-words">{state.error}</span>
                </p>
                <p className="mt-1.5 text-[0.66rem] leading-relaxed text-zinc-500">
                  Press <span className="text-zinc-300">Start tunnel</span> to try again. If it fails the same way,
                  the agent's own output below is the full story — copy it before resetting.
                </p>
              </>
            )}

            {/* address readout */}
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                <Wifi size={10} /> local port
              </div>
              <div className="mt-0.5 font-mono text-[0.82rem] font-semibold text-zinc-200">
                {state?.localPort ?? "—"}
              </div>
              {state?.address && state.status === "running" && (
                <>
                  <div className="mt-2 flex items-center gap-1.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                    <Globe2 size={10} /> public address
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[0.82rem] font-semibold text-emerald-300">
                    {state.address}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* actions */}
          <div className="border-t border-white/[0.06] p-3">
            {state?.status !== "running" && state?.status !== "starting" && state?.status !== "downloading" ? (
              <button
                type="button"
                onClick={() => run("start")}
                disabled={isBusy || loading}
                className="zk-btn zk-btn-primary w-full !justify-center"
              >
                {busy === "start" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-current" />}
                Start tunnel
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => run("stop")}
                  disabled={isBusy}
                  className="zk-btn zk-btn-ghost flex-1 !justify-center !border-rose-500/25 !text-rose-300"
                >
                  {busy === "stop" ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} className="fill-current" />}
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() => run("restart")}
                  disabled={isBusy}
                  className="zk-btn zk-btn-ghost flex-1 !justify-center"
                >
                  {busy === "restart" ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                  Restart
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setConfirmReset((v) => !v)}
              disabled={isBusy}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[0.66rem] text-zinc-600 transition hover:text-zinc-300"
            >
              <Trash2 size={11} />
              Reset agent identity
            </button>

            {confirmReset && (
              <div className="mt-1 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5">
                <p className="text-[0.66rem] leading-relaxed text-amber-200/90">
                  This deletes the agent secret. The tunnel will need to be claimed again with a new link.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => run("reset")}
                    className="flex-1 rounded-md bg-amber-500 px-2 py-1 text-[0.66rem] font-bold text-ink-950 transition hover:bg-amber-400"
                  >
                    Reset agent
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="flex-1 rounded-md bg-white/[0.06] px-2 py-1 text-[0.66rem] font-semibold text-zinc-300 transition hover:bg-white/[0.1]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* claim */}
        {state?.claimUrl && (
          <div className="relative overflow-hidden rounded-xl border border-brand-500/25 bg-brand-500/[0.05] p-4">
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-500/20 blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-brand-300">
                <Link2 size={12} />
                claim required
              </div>
              <p className="mt-1.5 text-[0.72rem] leading-relaxed text-zinc-400">
                Open this link once to attach the agent to your playit.gg account. After that the
                tunnel is permanent — no link is needed again.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/40 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[0.62rem] text-brand-200">
                  {state.claimUrl}
                </code>
                <button
                  type="button"
                  onClick={copyClaim}
                  className="flex-none rounded p-1 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                  title="Copy claim link"
                >
                  {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                </button>
              </div>
              <a
                href={state.claimUrl}
                target="_blank"
                rel="noreferrer"
                className="zk-btn zk-btn-primary zk-btn-sm mt-2.5 w-full !justify-center"
              >
                Open playit.gg claim page
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}

        {/* how it works, collapsed by default */}
        <details className="group rounded-xl border border-white/[0.07] zk-surface px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[0.68rem] font-semibold text-zinc-500 transition hover:text-zinc-300">
            <Info size={11} />
            How tunnels work
            <ArrowRight size={11} className="ml-auto transition group-open:rotate-90" />
          </summary>
          <ol className="mt-2.5 space-y-1.5 pl-4 text-[0.68rem] leading-relaxed text-zinc-500">
            <li className="list-decimal">
              The panel downloads the official playit agent and runs it next to this server.
            </li>
            <li className="list-decimal">
              First run prints a claim link. Open it and sign in to playit.gg to authorise the agent.
            </li>
            <li className="list-decimal">
              Claim once, then add a tunnel for this port in the playit.gg dashboard. The address stays
              the same across restarts.
            </li>
            <li className="list-decimal">
              Your server itself needs no configuration — playit connects to the local port.
            </li>
          </ol>
        </details>
      </div>

      {/* ═══════════════════════════════════ agent log ═══════════════════════ */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-white/[0.07] zk-surface">
        <div className="flex items-center gap-2 border-b border-white/[0.06] zk-surface px-3 py-2">
          <TerminalSquare size={13} className="text-brand-500" />
          <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-zinc-400">
            agent output
          </span>
          <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.58rem] text-zinc-600">
            {logs.length}
          </span>
          <span className="ml-auto flex items-center gap-1 font-mono text-[0.56rem] text-zinc-700">
            <Radio size={9} className={state?.status === "running" ? "text-emerald-400" : "text-zinc-700"} />
            {state?.status === "running" ? "streaming" : "idle"}
          </span>
        </div>

        <div
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="h-[420px] overflow-y-auto bg-black px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] xl:h-[560px]"
        >
          {fetchError && (
            <p className="mb-1 flex items-start gap-1.5 text-rose-400">
              <AlertTriangle size={11} className="mt-1 flex-none" />
              {fetchError}
            </p>
          )}
          {logs.length === 0 && !fetchError && (
            <div className="py-16 text-center text-zinc-700">
              <Globe2 size={22} className="mx-auto mb-2 opacity-40" />
              <p className="text-[0.72rem]">No agent output yet.</p>
              <p className="mt-0.5 text-[0.66rem] text-zinc-800">Start the tunnel to see what the agent reports.</p>
            </div>
          )}
          {logs.map((line, i) => {
            const tone = /error|fail|denied|refused/i.test(line)
              ? "text-rose-400"
              : /warn/i.test(line)
              ? "text-amber-300/90"
              : /claim/i.test(line)
              ? "text-brand-300"
              : /tunnel|connected|ready/i.test(line)
              ? "text-emerald-300"
              : "text-zinc-400";
            return (
              <div key={i} className={`min-w-0 break-words ${tone}`}>
                {line}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PlayitTunnel;

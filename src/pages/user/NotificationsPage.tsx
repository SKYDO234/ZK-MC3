import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Circle, Info, Server, ShieldCheck, AlertTriangle, CheckCircle2, Inbox } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Button, EmptyState, PageSkeleton, Tabs } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/format";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

const ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={14} />,
  error: <AlertTriangle size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Info size={14} />,
  server: <Server size={14} />,
  security: <ShieldCheck size={14} />,
};

const TONE: Record<string, string> = {
  success: "text-emerald-400 border-emerald-500/25 bg-emerald-500/[0.07]",
  error: "text-rose-400 border-rose-500/25 bg-rose-500/[0.07]",
  warning: "text-amber-400 border-amber-500/25 bg-amber-500/[0.07]",
  info: "text-sky-400 border-sky-500/25 bg-sky-500/[0.07]",
  server: "text-zinc-400 border-white/[0.09] bg-white/[0.03]",
  security: "text-violet-400 border-violet-500/25 bg-violet-500/[0.07]",
};

export const NotificationsPage: React.FC = () => {
  useDocumentTitle("Notifications · ZK-MC3-PANEL");
  const { data, loading, reload } = useApi<Notification[]>("/system/notifications");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  // Auto-refresh keeps the list current without a manual reload.
  useEffect(() => {
    const timer = window.setInterval(reload, 30000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const items = data || [];
  const unread = items.filter((n) => !n.read).length;

  const visible = useMemo(() => {
    if (filter === "unread") return items.filter((n) => !n.read);
    if (filter === "read") return items.filter((n) => n.read);
    return items;
  }, [items, filter]);

  const markAll = useCallback(async () => {
    setBusy(true);
    try {
      await api("/system/notifications/read", { method: "POST", body: {} });
      reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const markOne = async (id: string) => {
    await api("/system/notifications/read", { method: "POST", body: { id } }).catch(() => {});
    reload();
  };

  if (loading && !data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        icon={<Bell size={20} />}
        title="Notifications"
        subtitle="Activity across your servers, account and the panel."
        badge={
          unread > 0 ? (
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-rose-300">
              {unread} unread
            </span>
          ) : undefined
        }
        actions={
          <Button size="sm" icon={<CheckCheck size={13} />} loading={busy} onClick={markAll} disabled={unread === 0}>
            Mark all read
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: "all", label: "All", badge: items.length || undefined },
          { id: "unread", label: "Unread", badge: unread || undefined },
          { id: "read", label: "Read" },
        ]}
        active={filter}
        onChange={setFilter}
        className="mb-4"
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title={filter === "unread" ? "Nothing unread" : "No notifications"}
          message={
            filter === "unread"
              ? "You've read everything. New activity will appear here."
              : "Panel activity — server starts, backups, sign-ins — lands here."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.07] zk-surface">
          {visible.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 border-b border-white/[0.045] px-4 py-3.5 last:border-b-0 transition hover:bg-white/[0.015] ${
                !n.read ? "bg-white/[0.012]" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md border ${
                  TONE[n.type] || TONE.info
                }`}
              >
                {ICONS[n.type] || ICONS.info}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`truncate text-[0.8rem] ${n.read ? "font-medium text-zinc-400" : "font-semibold text-zinc-100"}`}>
                    {n.title}
                  </p>
                  {!n.read && <span className="h-1.5 w-1.5 flex-none rounded-full bg-rose-500" />}
                </div>
                <p className="mt-0.5 text-[0.74rem] leading-relaxed text-zinc-500">{n.message}</p>
                <div className="mt-1 flex items-center gap-2.5">
                  <span className="font-mono text-[0.6rem] text-zinc-700">{relativeTime(n.createdAt)}</span>
                  {n.link && (
                    <a href={n.link} className="text-[0.66rem] font-medium text-zinc-400 transition hover:text-zinc-200">
                      Open
                    </a>
                  )}
                  {!n.read && (
                    <button
                      onClick={() => markOne(n.id)}
                      className="text-[0.66rem] font-medium text-zinc-600 transition hover:text-zinc-300"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;

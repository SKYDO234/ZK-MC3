import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Menu,
  Search,
  Bell,
  ChevronDown,
  LogOut,
  UserCog,
  LayoutDashboard,
  CheckCheck,
  Command,
  Server as ServerIcon,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import { api } from "../lib/api";
import { initials, relativeTime } from "../lib/format";
import { StatusPill } from "./StatusPill";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

interface SearchResult {
  type: "server" | "page" | "user";
  label: string;
  hint: string;
  to: string;
}

export const Topbar: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { user, isAdmin, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [system, setSystem] = useState<{ loadPercent: number; memoryPercent: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await api<Notification[]>("/system/notifications"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    const loadStats = async () => {
      try {
        setSystem(await api("/system/stats"));
      } catch {
        /* ignore */
      }
    };
    loadStats();
    const timer = setInterval(loadStats, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 40);
    else {
      setQuery("");
      setResults([]);
    }
  }, [searchOpen]);

  useEffect(() => {
    const run = async () => {
      const q = query.trim().toLowerCase();
      if (!q) {
        setResults([]);
        return;
      }
      const pages: SearchResult[] = [
        { type: "page", label: "Dashboard", hint: "Overview", to: "/dashboard" },
        { type: "page", label: "My Servers", hint: "Server list", to: "/servers" },
        { type: "page", label: "API Keys", hint: "Developer access", to: "/api-keys" },
        { type: "page", label: "Account", hint: "Profile & security", to: "/account" },
      ];
      if (isAdmin) {
        pages.push(
          { type: "page", label: "Admin Overview", hint: "Administration", to: "/admin" },
          { type: "page", label: "Create Server", hint: "Provision a new instance", to: "/admin/create-server" },
          { type: "page", label: "Nodes", hint: "Infrastructure", to: "/admin/nodes" },
          { type: "page", label: "User Management", hint: "Accounts", to: "/admin/users" },
          { type: "page", label: "Panel Settings", hint: "Configuration", to: "/admin/settings" }
        );
      }
      let servers: SearchResult[] = [];
      try {
        const list = await api<any[]>("/servers");
        servers = list
          .filter((s) => s.name.toLowerCase().includes(q))
          .slice(0, 5)
          .map((s) => ({
            type: "server" as const,
            label: s.name,
            hint: `${s.software} ${s.version} · ${s.status}`,
            to: `/servers/${s.id}`,
          }));
      } catch {
        /* ignore */
      }
      setResults([...servers, ...pages.filter((p) => p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q))].slice(0, 8));
    };
    const timer = setTimeout(run, 160);
    return () => clearTimeout(timer);
  }, [query, isAdmin]);

  const unread = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    try {
      await api("/system/notifications/read", { method: "POST", body: {} });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      /* ignore */
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07070a]/80 backdrop-blur-2xl">
      <div className="flex h-[62px] items-center gap-3 px-4 sm:px-6">
        <button onClick={onMenuClick} className="zk-btn zk-btn-ghost zk-btn-sm px-2 lg:hidden">
          <Menu size={17} />
        </button>

        <button
          onClick={() => setSearchOpen(true)}
          className="group flex h-9 flex-1 max-w-md items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 text-left transition hover:border-white/15 hover:bg-white/[0.045]"
        >
          <Search size={15} className="text-zinc-500" />
          <span className="flex-1 truncate text-xs text-zinc-500">Search servers, pages, actions…</span>
          <span className="hidden items-center gap-0.5 sm:flex">
            <span className="zk-kbd">⌘</span>
            <span className="zk-kbd">K</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 md:flex">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-zinc-500">CPU</span>
              <span
                className={clsx(
                  "font-mono text-[0.7rem] font-semibold",
                  (system?.loadPercent || 0) > 75 ? "text-red-400" : "text-emerald-400"
                )}
              >
                {system?.loadPercent ?? 0}%
              </span>
            </div>
            <span className="h-3 w-px bg-white/10" />
            <div className="flex items-center gap-1.5">
              <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-zinc-500">RAM</span>
              <span
                className={clsx(
                  "font-mono text-[0.7rem] font-semibold",
                  (system?.memoryPercent || 0) > 85 ? "text-red-400" : "text-brand-400"
                )}
              >
                {system?.memoryPercent ?? 0}%
              </span>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setNotifOpen((v) => !v);
                setUserOpen(false);
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025] text-zinc-400 transition hover:border-brand-500/30 hover:text-brand-300"
            >
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[0.58rem] font-bold text-black">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="zk-card zk-fade-up absolute right-0 top-11 z-50 w-[min(92vw,360px)] overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <p className="text-sm font-semibold text-zinc-100">Notifications</p>
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-[0.68rem] font-medium text-brand-400 hover:text-brand-300"
                  >
                    <CheckCheck size={12} /> Mark all read
                  </button>
                </div>
                <div className="max-h-[340px] overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-4 py-8 text-center text-xs text-zinc-500">You're all caught up.</p>
                  )}
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={async () => {
                        await api("/system/notifications/read", { method: "POST", body: { id: n.id } }).catch(() => {});
                        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                        setNotifOpen(false);
                        if (n.link) navigate(n.link);
                      }}
                      className={clsx(
                        "flex w-full gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.03]",
                        !n.read && "bg-brand-500/[0.045]"
                      )}
                    >
                      <span
                        className={clsx(
                          "mt-1.5 h-1.5 w-1.5 flex-none rounded-full",
                          n.type === "success" && "bg-emerald-400",
                          n.type === "error" && "bg-red-400",
                          n.type === "warning" && "bg-amber-400",
                          n.type === "info" && "bg-sky-400"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[0.8rem] font-semibold text-zinc-200">{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[0.72rem] leading-snug text-zinc-500">{n.message}</p>
                        <p className="mt-1 text-[0.62rem] text-zinc-600">{relativeTime(n.createdAt)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setUserOpen((v) => !v);
                setNotifOpen(false);
              }}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] py-1 pl-1 pr-2 transition hover:border-brand-500/30"
            >
              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-[0.62rem] font-bold text-black/80">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(user?.name || user?.username || "")
                )}
              </span>
              <span className="hidden max-w-[110px] truncate text-[0.78rem] font-medium text-zinc-300 sm:block">
                {user?.username}
              </span>
              <ChevronDown size={13} className="text-zinc-500" />
            </button>

            {userOpen && (
              <div className="zk-card zk-fade-up absolute right-0 top-11 z-50 w-56 overflow-hidden p-1.5">
                <div className="px-3 py-2">
                  <p className="truncate text-[0.82rem] font-semibold text-zinc-100">{user?.name}</p>
                  <p className="truncate text-[0.68rem] text-zinc-500">{user?.email}</p>
                  <div className="mt-2">
                    <StatusPill status={user?.role === "user" ? "active" : "online"} />
                  </div>
                </div>
                <div className="my-1 h-px bg-white/[0.06]" />
                {[
                  { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={14} /> },
                  { to: "/servers", label: "My Servers", icon: <ServerIcon size={14} /> },
                  { to: "/account", label: "Account settings", icon: <UserCog size={14} /> },
                  ...(isAdmin
                    ? [{ to: "/admin", label: "Admin panel", icon: <ShieldCheck size={14} /> }]
                    : []),
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setUserOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8rem] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
                <div className="my-1 h-px bg-white/[0.06]" />
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8rem] text-red-400 transition hover:bg-red-500/10"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 p-4 pt-[10vh] backdrop-blur-sm"
          onClick={() => setSearchOpen(false)}
        >
          <div className="zk-card zk-fade-up w-full max-w-xl overflow-hidden p-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
              <Search size={16} className="text-zinc-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search servers, pages, actions…"
                className="h-12 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
              <span className="zk-kbd">ESC</span>
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {!query && (
                <p className="px-3 py-6 text-center text-xs text-zinc-600">
                  Start typing to search your servers and the panel.
                </p>
              )}
              {query && results.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-zinc-600">No results found.</p>
              )}
              {results.map((r) => (
                <button
                  key={`${r.type}-${r.to}`}
                  onClick={() => {
                    navigate(r.to);
                    setSearchOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/5"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-brand-400">
                    <ServerIcon size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.82rem] font-medium text-zinc-200">{r.label}</span>
                    <span className="block truncate text-[0.68rem] text-zinc-500">{r.hint}</span>
                  </span>
                  <span className="zk-kbd">↵</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-2 text-[0.62rem] text-zinc-600">
              <span className="flex items-center gap-1">
                <Command size={11} /> K to open
              </span>
              <span>·</span>
              <span>{settings.companyName} panel</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

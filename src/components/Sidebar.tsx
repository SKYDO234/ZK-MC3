import React from "react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import {
  LayoutDashboard,
  Server,
  KeyRound,
  UserCog,
  ShieldCheck,
  PlusSquare,
  Boxes,
  Users,
  Settings2,
  Cpu,
  LogOut,
  Bell,
  ArrowLeft,
  X,
} from "lucide-react";
import { BrandLogo } from "./Brand";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import { initials } from "../lib/format";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/* Account-level navigation, visible to everyone. */
const ACCOUNT_NAV: NavGroup = {
  label: "Account",
  items: [
    { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} />, end: true },
    { to: "/servers", label: "My Servers", icon: <Server size={16} /> },
    { to: "/account", label: "My Profile", icon: <UserCog size={16} /> },
    { to: "/notifications", label: "Notifications", icon: <Bell size={16} /> },
    { to: "/api-keys", label: "API Keys", icon: <KeyRound size={16} /> },
  ],
};

/* Administration, visible to admins and owners only. */
const ADMIN_NAV: NavGroup = {
  label: "Administration",
  items: [
    { to: "/admin", label: "Overview", icon: <ShieldCheck size={16} />, end: true },
    { to: "/admin/users", label: "Users", icon: <Users size={16} /> },
    { to: "/admin/nodes", label: "Nodes", icon: <Boxes size={16} /> },
    { to: "/admin/servers", label: "Servers", icon: <Server size={16} /> },
    { to: "/admin/settings", label: "Panel Settings", icon: <Settings2 size={16} /> },
    { to: "/admin/api-keys", label: "API Keys", icon: <KeyRound size={16} /> },
    { to: "/admin/system", label: "System", icon: <Cpu size={16} /> },
  ],
};

/* Shortcuts that create things — the reference lists these above navigation. */
const QUICK_NAV: NavGroup = {
  label: "Quick actions",
  items: [
    { to: "/admin/users?create=1", label: "New User", icon: <UserCog size={16} /> },
    { to: "/admin/create-server", label: "New Server", icon: <PlusSquare size={16} /> },
  ],
};

export const Sidebar: React.FC<{
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}> = ({ open, onClose, onLogout }) => {
  const { user, isAdmin } = useAuth();
  const { settings } = useSettings();

  const renderGroup = (group: NavGroup) => (
    <div className="zk-nav-group" key={group.label}>
      <p className="zk-nav-group-label">{group.label}</p>
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) => clsx("zk-nav-item", isActive && "zk-nav-item-active")}
          >
            {({ isActive }) => (
              <>
                <span className={clsx("zk-nav-icon flex-none", isActive ? "text-[#0a0a0a]" : "text-zinc-500")}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <span
                    className={clsx(
                      "rounded px-1 py-0.5 text-[0.55rem] font-bold",
                      isActive ? "bg-black/10 text-black/70" : "bg-white/[0.07] text-zinc-400"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/70 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-white/[0.07] bg-black transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* brand */}
        <div className="flex h-[58px] flex-none items-center justify-between border-b border-white/[0.07] px-4">
          <BrandLogo size={30} />
          <button onClick={onClose} className="zk-btn zk-btn-subtle zk-btn-sm -mr-1 px-1.5 lg:hidden">
            <X size={15} />
          </button>
        </div>

        <nav className="no-scrollbar flex-1 overflow-y-auto px-2.5 py-4">
          {renderGroup(ACCOUNT_NAV)}

          {isAdmin && (
            <>
              {renderGroup(ADMIN_NAV)}
              {renderGroup(QUICK_NAV)}
            </>
          )}

          <div className="zk-nav-group">
            <p className="zk-nav-group-label">Navigation</p>
            <NavLink to="/dashboard" onClick={onClose} className="zk-nav-item">
              <span className="zk-nav-icon flex-none text-zinc-500">
                <ArrowLeft size={16} />
              </span>
              <span className="flex-1 truncate">Back to Panel</span>
            </NavLink>
          </div>
        </nav>

        {/* account footer */}
        <div className="flex-none border-t border-white/[0.07] p-2.5">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
            <div className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-white/[0.09] text-[0.65rem] font-bold text-zinc-200">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(user?.name || user?.username || "")
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.78rem] font-semibold text-zinc-100">{user?.username}</p>
              <p className="truncate text-[0.62rem] capitalize text-zinc-500">{user?.role}</p>
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-zinc-600 transition hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut size={14} />
            </button>
          </div>
          <p className="mt-1.5 truncate px-1.5 text-[0.56rem] uppercase tracking-[0.12em] text-zinc-700">
            {settings.panelName}
          </p>
        </div>
      </aside>
    </>
  );
};

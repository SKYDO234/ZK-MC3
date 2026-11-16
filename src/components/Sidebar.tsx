import React from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  LogOut,
  ChevronRight,
  Sparkles,
  LifeBuoy,
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

const USER_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} />, end: true },
  { to: "/servers", label: "My Servers", icon: <Server size={17} /> },
  { to: "/api-keys", label: "API Keys", icon: <KeyRound size={17} /> },
  { to: "/account", label: "Account", icon: <UserCog size={17} /> },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Admin Overview", icon: <ShieldCheck size={17} />, end: true },
  { to: "/admin/create-server", label: "Create Server", icon: <PlusSquare size={17} /> },
  { to: "/admin/servers", label: "All Servers", icon: <Server size={17} /> },
  { to: "/admin/nodes", label: "Nodes", icon: <Boxes size={17} /> },
  { to: "/admin/users", label: "User Management", icon: <Users size={17} /> },
  { to: "/admin/api-keys", label: "API Keys", icon: <KeyRound size={17} /> },
  { to: "/admin/settings", label: "Panel Settings", icon: <Settings2 size={17} /> },
];

export const Sidebar: React.FC<{
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}> = ({ open, onClose, onLogout }) => {
  const { user, isAdmin } = useAuth();
  const { settings } = useSettings();
  const location = useLocation();

  const renderNav = (items: NavItem[]) =>
    items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onClose}
        className={({ isActive }) => clsx("zk-nav-item", isActive && "zk-nav-item-active")}
      >
        <span className="flex-none opacity-90">{item.icon}</span>
        <span className="flex-1 truncate">{item.label}</span>
        {location.pathname === item.to && <ChevronRight size={13} className="flex-none text-brand-400" />}
      </NavLink>
    ));

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/65 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col border-r border-white/[0.06] bg-[#08080a]/95 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 pb-4 pt-5">
          <BrandLogo size={38} />
          <button onClick={onClose} className="zk-btn zk-btn-subtle zk-btn-sm px-1.5 lg:hidden">
            <X size={16} />
          </button>
        </div>

        <div className="mx-4 mb-4 flex items-center gap-2 rounded-xl border border-brand-500/20 bg-gradient-to-r from-brand-500/12 to-transparent px-3 py-2">
          <Sparkles size={13} className="text-brand-400" />
          <p className="text-[0.68rem] font-medium leading-tight text-brand-100/80">
            {settings.panelTagline || "Powered by ZK-STUDIO"}
          </p>
        </div>

        <nav className="no-scrollbar flex-1 space-y-6 overflow-y-auto px-3 pb-4">
          <div>
            <p className="mb-2 px-2.5 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-zinc-500">
              User Panel
            </p>
            <div className="space-y-1">{renderNav(USER_NAV)}</div>
          </div>

          {isAdmin && (
            <div>
              <p className="mb-2 px-2.5 flex items-center gap-1.5 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Administration
                <span className="rounded bg-brand-500/20 px-1 text-[0.55rem] text-brand-300">ADMIN</span>
              </p>
              <div className="space-y-1">{renderNav(ADMIN_NAV)}</div>
            </div>
          )}
        </nav>

        <div className="border-t border-white/[0.06] p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.7rem] text-zinc-500">
            <LifeBuoy size={13} className="text-brand-400/80" />
            <span>
              Panel by <span className="font-semibold text-zinc-300">{settings.companyName}</span>
            </span>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
            <div className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-[0.7rem] font-bold text-black/80">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(user?.name || user?.username || "")
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8rem] font-semibold text-zinc-100">{user?.name || user?.username}</p>
              <p className="truncate text-[0.65rem] text-zinc-500 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={onLogout}
              title="Sign out"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-zinc-500 transition hover:bg-red-500/12 hover:text-red-400"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

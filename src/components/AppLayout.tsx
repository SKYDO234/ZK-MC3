import React, { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";

export const AppLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { logout, isAdmin } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="relative min-h-screen bg-black">
      <div className="zk-app-bg" />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={handleLogout} />

      <div className="lg:pl-[248px]">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        {settings.maintenanceMode && isAdmin && (
          <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-1.5 text-center text-[0.68rem] font-medium text-amber-300">
            Maintenance mode is active — only administrators can sign in.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">
          <Outlet />
        </main>

        {/* Footer, exactly as in the reference: one thin line, left + right. */}
        <footer className="mx-auto w-full max-w-[1400px] px-4 pb-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-[0.64rem] text-zinc-600">
            <p>
              © {new Date().getFullYear()} {settings.panelName} ·{" "}
              <span className="text-zinc-500">{settings.companyName}</span>
            </p>
            <nav className="flex items-center gap-4">
              <Link to="/dashboard" className="transition hover:text-zinc-400">
                Dashboard
              </Link>
              <Link to="/account" className="transition hover:text-zinc-400">
                Profile
              </Link>
              <Link to="/notifications" className="transition hover:text-zinc-400">
                Notifications
              </Link>
              <button onClick={handleLogout} className="transition hover:text-zinc-400">
                Logout
              </button>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
};

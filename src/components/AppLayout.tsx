import React, { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";

export const AppLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { logout, isAdmin } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="relative min-h-screen">
      <div className="zk-app-bg" />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={handleLogout} />

      <div className="lg:pl-[268px]">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        {settings.maintenanceMode && isAdmin && (
          <div className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-center text-[0.72rem] font-medium text-amber-200">
            Maintenance mode is active — only administrators can sign in.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-[1560px] px-4 pb-8 pt-2 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-4 text-[0.68rem] text-zinc-600">
            <p>
              © {new Date().getFullYear()} {settings.panelName} · A product of{" "}
              <span className="font-medium text-zinc-400">{settings.companyName}</span>
            </p>
            <p>
              CEO <span className="font-medium text-zinc-400">{settings.ceoName}</span> · v1.0.0
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

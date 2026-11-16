import React from "react";
import { Activity, Boxes, Cpu, HardDrive, ShieldCheck, Zap } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";

const HIGHLIGHTS = [
  { icon: <Zap size={16} />, title: "One-click deployments", text: "Paper, Purpur, Fabric, Velocity & more." },
  { icon: <Activity size={16} />, title: "Live console & metrics", text: "Stream logs and CPU/RAM in real time." },
  { icon: <ShieldCheck size={16} />, title: "Secure by design", text: "JWT sessions, API scopes, audit trail." },
];

export const AuthShell: React.FC<{
  children: React.ReactNode;
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ children, title, subtitle, footer, wide }) => {
  const { settings } = useSettings();

  return (
    <div className="relative flex min-h-screen">
      <div className="zk-app-bg" />

      {/* Left showcase panel (desktop) */}
      <div className="relative hidden w-[52%] flex-col justify-between overflow-hidden border-r border-white/[0.06] p-10 xl:p-14 lg:flex">
        <div className="zk-pixel-grid" />
        <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-brand-500/15 blur-[100px]" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <img
              src={settings.logoUrl || "/logo.png"}
              alt=""
              className="h-12 w-12 rounded-xl border border-brand-500/30 object-cover shadow-[0_16px_40px_-16px_rgba(255,122,24,0.9)]"
            />
            <div>
              <p className="font-display text-base font-extrabold tracking-tight text-zinc-50">
                {settings.panelName}
              </p>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-brand-400/80">
                by {settings.companyName}
              </p>
            </div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-500/25 bg-brand-500/10 px-3 py-1 text-[0.68rem] font-semibold text-brand-200">
            <span className="zk-live-dot" />
            {settings.panelTagline}
          </div>
          <h2 className="font-display text-[2.35rem] font-extrabold leading-[1.1] tracking-tight text-zinc-50">
            Host Minecraft
            <br />
            like an <span className="zk-brand-text">absolute pro.</span>
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-400">
            A complete game hosting control plane — servers, nodes, plugins, backups and console
            access in one beautifully dark, blazing-fast panel.
          </p>

          <div className="mt-8 space-y-3">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-brand-400">
                  {item.icon}
                </span>
                <div>
                  <p className="text-[0.82rem] font-semibold text-zinc-200">{item.title}</p>
                  <p className="text-[0.72rem] text-zinc-500">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-4 text-[0.68rem] text-zinc-600">
          <span className="flex items-center gap-1.5">
            <Boxes size={12} /> Multi-node ready
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu size={12} /> Live metrics
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive size={12} /> Automated backups
          </span>
        </div>
      </div>

      {/* Right form panel */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className={`w-full ${wide ? "max-w-[560px]" : "max-w-[420px]"}`}>
          <div className="mb-7 lg:hidden">
            <img
              src={settings.logoUrl || "/logo.png"}
              alt=""
              className="h-12 w-12 rounded-xl border border-brand-500/30 object-cover"
            />
          </div>
          <h1 className="font-display text-[1.6rem] font-extrabold tracking-tight text-zinc-50">{title}</h1>
          <p className="mt-1.5 text-[0.82rem] leading-relaxed text-zinc-500">{subtitle}</p>
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6">{footer}</div>}
          <p className="mt-10 text-center text-[0.66rem] text-zinc-600">
            © {new Date().getFullYear()} {settings.panelName} · {settings.companyName} · CEO{" "}
            {settings.ceoName}
          </p>
        </div>
      </div>
    </div>
  );
};

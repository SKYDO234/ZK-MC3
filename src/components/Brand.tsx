import React from "react";
import clsx from "clsx";
import { useSettings } from "../context/SettingsContext";

/** Compact logo mark used in the sidebar / topbar. */
export const BrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 38, className }) => {
  const { settings } = useSettings();
  return (
    <div
      className={clsx(
        "relative flex flex-none items-center justify-center overflow-hidden rounded-xl border border-brand-500/35 bg-gradient-to-br from-[#1b1207] to-[#0a0a0b] shadow-[0_0_24px_-8px_rgba(255,122,24,0.75)]",
        className
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={settings.logoUrl || "/logo.png"}
        alt={`${settings.panelName} logo`}
        className="h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
    </div>
  );
};

/** Full word mark: hexagon-ish logo tile + panel name. */
export const BrandLogo: React.FC<{
  size?: number;
  subtitle?: boolean;
  className?: string;
  compact?: boolean;
}> = ({ size = 40, subtitle = true, className, compact }) => {
  const { settings } = useSettings();
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <BrandMark size={size} />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-[0.95rem] font-extrabold tracking-tight text-zinc-50">
            {settings.panelName.split("-")[0]}
            <span className="zk-brand-text">-{settings.panelName.split("-").slice(1).join("-")}</span>
          </p>
          {subtitle && (
            <p className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              by {settings.companyName}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/** Big hero logo used on authentication pages. */
export const BrandHero: React.FC<{ className?: string }> = ({ className }) => {
  const { settings } = useSettings();
  return (
    <div className={clsx("flex flex-col items-center text-center", className)}>
      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-brand-500/25 blur-3xl" />
        <img
          src={settings.logoUrl || "/logo.png"}
          alt={`${settings.panelName} logo`}
          className="h-24 w-24 rounded-2xl border border-brand-500/30 object-cover shadow-[0_24px_60px_-24px_rgba(255,122,24,0.8)]"
        />
      </div>
      <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-[1.7rem]">
        {settings.panelName}
      </h1>
      <p className="mt-1 text-xs font-medium uppercase tracking-[0.22em] text-brand-400/90">
        {settings.panelTagline}
      </p>
    </div>
  );
};

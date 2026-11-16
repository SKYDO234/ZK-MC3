import React from "react";
import clsx from "clsx";

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; to?: string }[];
  className?: string;
}> = ({ title, subtitle, icon, actions, breadcrumb, className }) => (
  <div className={clsx("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
    <div className="flex items-start gap-3.5">
      {icon && (
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-brand-500/25 bg-gradient-to-br from-brand-500/18 to-transparent text-brand-400 shadow-[0_0_24px_-12px_rgba(255,122,24,0.9)]">
          {icon}
        </div>
      )}
      <div>
        {breadcrumb && (
          <p className="mb-1 flex items-center gap-1.5 text-[0.68rem] text-zinc-600">
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={crumb.label}>
                {i > 0 && <span>/</span>}
                <span className={i === breadcrumb.length - 1 ? "text-zinc-400" : ""}>{crumb.label}</span>
              </React.Fragment>
            ))}
          </p>
        )}
        <h1 className="font-display text-xl font-bold tracking-tight text-zinc-50 sm:text-[1.55rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[0.82rem] leading-relaxed text-zinc-500">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

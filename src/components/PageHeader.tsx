import React from "react";
import clsx from "clsx";

/**
 * Page header
 * ---------------------------------------------------------------------------
 * Reference language: a plain icon (no container, no glow), a bold title, one
 * dim line of context, and actions pushed to the right. Status chips and
 * buttons sit on the same baseline as the title.
 */
export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; to?: string }[];
  /** Small chip rendered next to the title, e.g. "OPERATIONAL". */
  badge?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon, actions, breadcrumb, badge, className }) => (
  <div className={clsx("mb-5 flex flex-wrap items-start justify-between gap-4", className)}>
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        {icon && <span className="flex-none text-zinc-400">{icon}</span>}
        <h1 className="truncate text-[1.28rem] font-bold tracking-tight text-zinc-50">{title}</h1>
        {badge}
      </div>
      {breadcrumb && (
        <p className="mt-1 flex items-center gap-1.5 text-[0.66rem] text-zinc-600">
          {breadcrumb.map((crumb, i) => (
            <React.Fragment key={crumb.label}>
              {i > 0 && <span className="text-zinc-700">/</span>}
              <span className={i === breadcrumb.length - 1 ? "text-zinc-500" : ""}>{crumb.label}</span>
            </React.Fragment>
          ))}
        </p>
      )}
      {subtitle && <p className="mt-1 max-w-2xl text-[0.78rem] leading-relaxed text-zinc-500">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

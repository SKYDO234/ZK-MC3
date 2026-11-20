import React from "react";
import clsx from "clsx";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";

/* ------------------------------------------------------------------ Card */
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padded?: boolean;
}> = ({ children, className, hover = false, padded = true }) => (
  <div className={clsx("zk-card", hover && "zk-card-hover", padded && "p-5", className)}>{children}</div>
);

export const CardHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon, action, className }) => (
  <div className={clsx("flex flex-wrap items-start justify-between gap-3", className)}>
    <div className="flex items-start gap-3">
      {icon && (
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-zinc-400">
          {icon}
        </div>
      )}
      <div>
        <h3 className="text-[0.88rem] font-semibold tracking-tight text-zinc-100">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[0.72rem] text-zinc-500">{subtitle}</p>}
      </div>
    </div>
    {action}
  </div>
);

/* ----------------------------------------------------------------- Button */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "success" | "subtle";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button: React.FC<ButtonProps> = ({
  variant = "ghost",
  size = "md",
  loading,
  icon,
  children,
  className,
  disabled,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={clsx(
      "zk-btn",
      variant === "primary" && "zk-btn-primary",
      variant === "ghost" && "zk-btn-ghost",
      variant === "danger" && "zk-btn-danger",
      variant === "success" && "zk-btn-success",
      variant === "subtle" && "border-transparent bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
      size === "sm" && "zk-btn-sm",
      className
    )}
  >
    {loading ? <Loader2 size={size === "sm" ? 13 : 15} className="zk-spin" /> : icon}
    {children}
  </button>
);

/* ------------------------------------------------------------------ Badge */
export const Badge: React.FC<{
  children: React.ReactNode;
  tone?: "online" | "offline" | "warn" | "danger" | "brand" | "info";
  className?: string;
  dot?: boolean;
}> = ({ children, tone = "offline", className, dot }) => (
  <span className={clsx("zk-badge", `zk-badge-${tone}`, className)}>
    {dot && (
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          tone === "online" && "bg-emerald-400",
          tone === "offline" && "bg-zinc-500",
          tone === "warn" && "bg-amber-400",
          tone === "danger" && "bg-red-400",
          tone === "brand" && "bg-brand-400",
          tone === "info" && "bg-sky-400"
        )}
      />
    )}
    {children}
  </span>
);

/* --------------------------------------------------------------- Progress */
export const Progress: React.FC<{ value: number; tone?: string; className?: string }> = ({
  value,
  tone,
  className,
}) => (
  <div className={clsx("zk-progress", className)}>
    <span
      style={{
        width: `${Math.max(0, Math.min(100, value))}%`,
        ...(tone ? { background: tone, boxShadow: `0 0 14px -2px ${tone}` } : {}),
      }}
    />
  </div>
);

/* -------------------------------------------------------- Resource meter */
export const ResourceMeter: React.FC<{
  label: string;
  used: number;
  total: number;
  unit?: string;
  formatter?: (n: number) => string;
  icon?: React.ReactNode;
}> = ({ label, used, total, formatter, icon }) => {
  const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone = percent > 88 ? "#ef4444" : percent > 70 ? "#f59e0b" : undefined;
  const fmt = formatter || ((n: number) => `${n}`);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-zinc-400">
          {icon}
          {label}
        </span>
        <span className="font-mono text-[0.7rem] text-zinc-500">
          {fmt(used)} <span className="text-zinc-600">/ {fmt(total)}</span>
        </span>
      </div>
      <Progress value={percent} tone={tone} />
    </div>
  );
};

/* ---------------------------------------------------------------- StatCard */
/*
 * Accent rule along the top, tiny uppercase label, monospaced value. The tone
 * is carried by the rule and the number, so a row of these reads as a single
 * instrument strip rather than four unrelated boxes.
 */
export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  trend?: { value: string; positive?: boolean };
  accent?: boolean;
  tone?: "neutral" | "brand" | "green" | "red" | "blue" | "amber";
  className?: string;
  footer?: React.ReactNode;
}> = ({ label, value, hint, icon, trend, accent, tone, className, footer }) => {
  const palette: Record<string, { rule: string; value: string; icon: string }> = {
    neutral: { rule: "rgba(255,255,255,0.16)", value: "#fafafa", icon: "text-zinc-500" },
    brand: { rule: "#ff7a18", value: "#ffab52", icon: "text-brand-500" },
    green: { rule: "#22c55e", value: "#4ade80", icon: "text-emerald-500" },
    red: { rule: "#ef4444", value: "#f87171", icon: "text-rose-500" },
    blue: { rule: "#3b82f6", value: "#60a5fa", icon: "text-blue-500" },
    amber: { rule: "#f59e0b", value: "#fbbf24", icon: "text-amber-500" },
  };
  const skin = palette[tone || (accent ? "brand" : "neutral")];
  return (
    <div
      className={clsx("zk-stat", className)}
      style={{ ["--stat-accent" as any]: skin.rule }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="zk-stat-label">{label}</p>
          <p className="zk-stat-value" style={{ color: skin.value }}>
            {value}
          </p>
        </div>
        {icon && <span className={clsx("mt-0.5 flex-none", skin.icon)}>{icon}</span>}
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1.5 text-[0.66rem]">
          <span className={trend.positive ? "text-emerald-400" : "text-rose-400"}>{trend.value}</span>
          <span className="text-zinc-600">vs last month</span>
        </div>
      )}
      {hint && <p className="zk-stat-hint">{hint}</p>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
};

/* ------------------------------------------------------------------ Empty */
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
}> = ({ icon, title, message, action }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.07] bg-[#0a0a0c] px-6 py-16 text-center">
    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.02] text-zinc-500">
      {icon}
    </div>
    <h3 className="text-[0.85rem] font-semibold text-zinc-200">{title}</h3>
    {message && <p className="mt-1.5 max-w-sm text-[0.75rem] leading-relaxed text-zinc-500">{message}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

/* ------------------------------------------------------------------ Modal */
export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  icon?: React.ReactNode;
}> = ({ open, onClose, title, subtitle, children, footer, width = "max-w-lg", icon }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:items-center">
      <div className={clsx("zk-fade-up my-8 w-full rounded-xl border border-white/[0.09] bg-[#0a0a0c]", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] p-4">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/12 text-brand-400">
                {icon}
              </div>
            )}
            <div>
              <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
              {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="zk-btn zk-btn-subtle zk-btn-sm px-2" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-white/[0.06] p-4">{footer}</div>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Field */
export const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  className?: string;
  required?: boolean;
}> = ({ label, children, hint, error, className, required }) => (
  <div className={className}>
    <label className="zk-label">
      {label}
      {required && <span className="ml-1 text-brand-400">*</span>}
    </label>
    {children}
    {hint && !error && <p className="mt-1.5 text-[0.7rem] text-zinc-500">{hint}</p>}
    {error && <p className="mt-1.5 text-[0.7rem] text-red-400">{error}</p>}
  </div>
);

/* ------------------------------------------------------------------ Tabs */
export const Tabs: React.FC<{
  tabs: { id: string; label: string; icon?: React.ReactNode; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}> = ({ tabs, active, onChange, className }) => (
  <div className={clsx("no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-white/[0.07] bg-[#08080a] p-1", className)}>
    {tabs.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onChange(tab.id)}
        className={clsx(
          "flex flex-none items-center gap-1.5 rounded-md px-3 py-1.5 text-[0.77rem] font-medium transition",
          active === tab.id
            ? "bg-white/[0.09] text-zinc-100"
            : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
        )}
      >
        {tab.icon}
        {tab.label}
        {tab.badge ? (
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[0.62rem] font-bold text-zinc-300">
            {tab.badge}
          </span>
        ) : null}
      </button>
    ))}
  </div>
);

/* ------------------------------------------------------------- SearchInput */
export const SearchInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, placeholder = "Search...", className }) => (
  <div className={clsx("relative", className)}>
    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
    <input
      className="zk-input pl-9"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
);

/* ---------------------------------------------------------------- Skeleton */
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={clsx("zk-skeleton", className)} />
);

export const PageSkeleton: React.FC = () => (
  <div className="space-y-5">
    <Skeleton className="h-8 w-64" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
    <Skeleton className="h-72" />
  </div>
);

/* -------------------------------------------------------------- Pagination */
export const Pagination: React.FC<{
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}> = ({ page, pages, total, onChange }) => {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-white/[0.06] px-1 pt-3 text-xs text-zinc-500">
      <span>
        Page {page} of {pages} · {total} results
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} icon={<ChevronLeft size={13} />}>
          Prev
        </Button>
        <Button size="sm" onClick={() => onChange(Math.min(pages, page + 1))} disabled={page >= pages}>
          Next <ChevronRight size={13} />
        </Button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ SectionTitle */
export const SectionTitle: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({
  title,
  subtitle,
  action,
}) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 className="font-display text-lg font-bold tracking-tight text-zinc-100">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
    </div>
    {action}
  </div>
);

/* ----------------------------------------------------------------- Switch */
export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex items-center gap-2.5"
    aria-pressed={checked}
  >
    <span
      className={clsx(
        "relative h-[22px] w-[40px] flex-none rounded-full border transition",
        checked ? "border-white/70 bg-white/80" : "border-white/10 bg-white/[0.06]"
      )}
    >
      <span
        className={clsx(
          "absolute top-[2px] h-[16px] w-[16px] rounded-full transition-all",
          checked ? "left-[20px] bg-[#0a0a0a]" : "left-[2px] bg-zinc-500"
        )}
      />
    </span>
    {label && <span className="text-xs text-zinc-400">{label}</span>}
  </button>
);

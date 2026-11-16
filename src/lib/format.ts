export const formatMb = (mb: number) => {
  if (!mb || mb < 0) return "0 MB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
};

export const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const formatUptime = (seconds: number) => {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
};

export const relativeTime = (iso?: string | null) => {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

export const formatDate = (iso?: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export const formatDateTime = (iso?: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatMoney = (amount: number, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount || 0);
  } catch {
    return `$${(amount || 0).toFixed(2)}`;
  }
};

export const initials = (name: string) =>
  (name || "?")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

export const pct = (value: number, total: number) => {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
};

export const statusTone = (status: string) => {
  switch ((status || "").toLowerCase()) {
    case "online":
      return { badge: "zk-badge-online", dot: "bg-emerald-400", label: "Online" };
    case "offline":
    case "stopped":
      return { badge: "zk-badge-offline", dot: "bg-zinc-500", label: "Offline" };
    case "starting":
    case "installing":
      return { badge: "zk-badge-warn", dot: "bg-amber-400", label: status === "installing" ? "Installing" : "Starting" };
    case "stopping":
      return { badge: "zk-badge-warn", dot: "bg-amber-400", label: "Stopping" };
    case "suspended":
      return { badge: "zk-badge-danger", dot: "bg-red-400", label: "Suspended" };
    case "error":
      return { badge: "zk-badge-danger", dot: "bg-red-400", label: "Error" };
    case "active":
      return { badge: "zk-badge-online", dot: "bg-emerald-400", label: "Active" };
    default:
      return { badge: "zk-badge-offline", dot: "bg-zinc-500", label: status || "Unknown" };
  }
};

export const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
      return true;
    } catch {
      return false;
    }
  }
};

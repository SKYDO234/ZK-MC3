import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Search, Sparkles } from "lucide-react";

/**
 * Version picker grouped by Minecraft release line, matching the JTG panel's
 * dropdown: collapsible categories (26.x, 1.21.x, 1.20.x … legacy), a search box
 * and a "latest" badge on the newest line.
 */

export interface CategorizedVersionDropdownProps {
  value: string;
  onChange: (value: string) => void;
  versions: string[];
  software?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  loading?: boolean;
}

interface VersionCategory {
  id: string;
  label: string;
  badge?: string;
  versions: string[];
}

const CATEGORY_ORDER: Array<{ id: string; prefix: string; label: string; badge?: string }> = [
  { id: "26", prefix: "26.", label: "26.x", badge: "Latest line" },
  { id: "121", prefix: "1.21", label: "1.21.x" },
  { id: "120", prefix: "1.20", label: "1.20.x" },
  { id: "119", prefix: "1.19", label: "1.19.x" },
  { id: "118", prefix: "1.18", label: "1.18.x" },
  { id: "117", prefix: "1.17", label: "1.17.x" },
  { id: "116", prefix: "1.16", label: "1.16.x" },
  { id: "115", prefix: "1.15", label: "1.15.x" },
  { id: "114", prefix: "1.14", label: "1.14.x" },
  { id: "113", prefix: "1.13", label: "1.13.x" },
  { id: "112", prefix: "1.12", label: "1.12.x" },
];

const groupVersions = (versions: string[], software: string): VersionCategory[] => {
  const runtime = ["NODEJS", "PYTHON"].includes((software || "").toUpperCase());
  if (runtime) {
    return versions.length
      ? [{ id: "runtime", label: "Available runtimes", versions: [...versions] }]
      : [];
  }

  // A VM image has exactly one build. Grouping it under a Minecraft release line
  // would be nonsense, so it gets its own label and no "latest" stripping.
  const vmSoftware = ["UBUNTU2204", "UBUNTU2404", "UBUNTU2604", "DEBIAN12", "DEBIAN13"].includes(
    (software || "").toUpperCase()
  );
  if (vmSoftware) {
    return [{ id: "vm", label: "Cloud image", versions: versions.length ? [...versions] : ["latest"] }];
  }

  // BungeeCord and Waterfall publish a rolling build instead of version numbers,
  // so "latest" is a real, selectable choice for them — not a placeholder to drop.
  const proxy = ["BUNGEECORD", "WATERFALL"].includes((software || "").toUpperCase());
  const clean = proxy ? [...versions] : versions.filter((v) => v !== "latest");
  if (proxy && !clean.length) clean.push("latest");
  const buckets = new Map<string, string[]>();
  const legacy: string[] = [];

  for (const version of clean) {
    const match = CATEGORY_ORDER.find((c) => version.startsWith(c.prefix));
    if (match) {
      buckets.set(match.id, [...(buckets.get(match.id) || []), version]);
    } else {
      legacy.push(version);
    }
  }

  const result: VersionCategory[] = [];
  for (const category of CATEGORY_ORDER) {
    const list = buckets.get(category.id);
    if (list?.length) {
      result.push({
        id: category.id,
        label: `${category.label} (${list.length})`,
        badge: category.badge,
        versions: list,
      });
    }
  }
  if (legacy.length) {
    result.push({ id: "legacy", label: `Legacy (${legacy.length})`, versions: legacy });
  }
  return result;
};

export const CategorizedVersionDropdown: React.FC<CategorizedVersionDropdownProps> = ({
  value,
  onChange,
  versions = [],
  software = "PAPER",
  disabled = false,
  className = "",
  placeholder = "Select a version…",
  loading = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Open the newest populated category by default.
  useEffect(() => {
    if (open && expanded === null) {
      const first = groupVersions(versions, software)[0];
      if (first) setExpanded(first.id);
    }
  }, [open, expanded, versions, software]);

  const categories = useMemo(() => {
    const grouped = groupVersions(versions, software);
    const needle = query.trim().toLowerCase();
    if (!needle) return grouped;
    return grouped
      .map((c) => ({ ...c, versions: c.versions.filter((v) => v.toLowerCase().includes(needle)) }))
      .filter((c) => c.versions.length > 0);
  }, [versions, software, query]);

  const total = categories.reduce((sum, c) => sum + c.versions.length, 0);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        className="zk-input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={value ? "text-zinc-100" : "text-zinc-500"}>
          {loading ? "Loading versions…" : value || placeholder}
        </span>
        <ChevronDown size={14} className={`flex-none text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d0f] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
            <Search size={13} className="flex-none text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search versions…"
              className="w-full bg-transparent text-[0.78rem] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {categories.map((category) => {
              const isOpen = expanded === category.id || Boolean(query.trim());
              return (
                <div key={category.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen && !query.trim() ? null : category.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04]"
                  >
                    {isOpen ? (
                      <ChevronDown size={13} className="flex-none text-zinc-500" />
                    ) : (
                      <ChevronRight size={13} className="flex-none text-zinc-500" />
                    )}
                    {isOpen ? (
                      <FolderOpen size={13} className="flex-none text-brand-400" />
                    ) : (
                      <Folder size={13} className="flex-none text-zinc-500" />
                    )}
                    <span className="flex-1 text-[0.76rem] font-medium text-zinc-300">{category.label}</span>
                    {category.badge && (
                      <span className="flex items-center gap-1 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[0.56rem] font-bold uppercase tracking-wide text-brand-300">
                        <Sparkles size={9} /> {category.badge}
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div className="mb-1 ml-6 space-y-0.5">
                      {category.versions.map((version) => (
                        <button
                          key={version}
                          type="button"
                          onClick={() => {
                            onChange(version);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[0.75rem] transition ${
                            value === version
                              ? "bg-brand-500/15 text-brand-200"
                              : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                          }`}
                        >
                          <span>{version}</span>
                          {value === version && <Check size={12} className="text-brand-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && total === 0 && (
              <p className="px-3 py-6 text-center text-[0.72rem] text-zinc-500">No matching versions.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CategorizedVersionDropdown;

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Box,
  Check,
  CheckCircle2,
  Download,
  FolderDown,
  Layers,
  Loader2,
  Puzzle,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Button, Field } from "./ui";

/**
 * Modrinth plugin / mod manager — JTG-parity behaviour.
 * ---------------------------------------------------------------------------
 *   • Discover tab: search Modrinth filtered to this server's project type and
 *     game version; one click installs the best compatible build.
 *   • Installed tab: everything currently in plugins/ or mods/, removable inline.
 *   • Version picker: every published build with release/beta/alpha channel,
 *     compatibility badge, and an explicit install.
 *
 * Proxy servers have no plugin API, so they get the same explanatory panel the
 * JTG panel shows instead of a broken search.
 */

interface CatalogHit {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  iconUrl: string | null;
  categories: string[];
  pageUrl: string;
}

interface ProjectVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  downloads: number;
  datePublished: string;
  gameVersions: string[];
  loaders: string[];
  compatible?: boolean;
  file: { url: string; filename: string; size: number } | null;
}

interface InstalledItem {
  filename: string;
  size: number;
  modified: number;
}

interface ManagerMeta {
  software: string;
  version: string;
  proxy: boolean;
  runtime: boolean;
  supportsPlugins: boolean;
  supportsMods: boolean;
  loader: string;
  loaders: string[];
  java: string;
}

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

const formatCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

const relative = (iso: string) => {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const days = Math.floor((Date.now() - time) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const ChannelBadge: React.FC<{ type: string }> = ({ type }) => {
  const tone =
    type === "release"
      ? "bg-emerald-500/15 text-emerald-300"
      : type === "beta"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-rose-500/15 text-rose-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide ${tone}`}>
      {type}
    </span>
  );
};

export const ModrinthManager: React.FC<{ serverId: string; software: string; version: string }> = ({
  serverId,
  software,
  version,
}) => {
  const { success, error, confirm } = useToast();
  const [meta, setMeta] = useState<ManagerMeta | null>(null);
  const [tab, setTab] = useState<"discover" | "installed">("discover");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState("");
  const [installed, setInstalled] = useState<InstalledItem[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [picker, setPicker] = useState<CatalogHit | null>(null);

  const upper = (software || "").toUpperCase();
  const fallbackModded = ["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes(upper);
  const target: "plugins" | "mods" = meta ? (meta.supportsMods ? "mods" : "plugins") : fallbackModded ? "mods" : "plugins";
  const proxy = meta?.proxy ?? ["VELOCITY", "BUNGEECORD", "WATERFALL"].includes(upper);

  useEffect(() => {
    api<ManagerMeta>(`/servers/${serverId}/modrinth/meta`)
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [serverId]);

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const data = await api<{ items: InstalledItem[] }>(`/servers/${serverId}/modrinth/installed`, {
        query: { target },
      });
      setInstalled(data.items || []);
    } catch {
      setInstalled([]);
    } finally {
      setLoadingInstalled(false);
    }
  }, [serverId, target]);

  useEffect(() => {
    if (!proxy) loadInstalled();
  }, [loadInstalled, proxy]);

  const search = useCallback(
    async (q: string) => {
      if (proxy) return;
      setSearching(true);
      try {
        const data = await api<{ hits: CatalogHit[] }>(`/servers/${serverId}/modrinth/search`, {
          query: { q, target, version, limit: 20 },
        });
        setHits(data.hits || []);
      } catch (err: any) {
        setHits([]);
        error("Search failed", err.message);
      } finally {
        setSearching(false);
      }
    },
    [serverId, target, version, proxy, error]
  );

  useEffect(() => {
    if (proxy) return;
    search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, target, version]);

  const install = async (hit: CatalogHit, versionId?: string) => {
    setInstalling(versionId || hit.id);
    try {
      const result = await api<{ message: string; fileName: string }>(`/servers/${serverId}/modrinth/install`, {
        method: "POST",
        body: {
          projectId: hit.id,
          projectSlug: hit.slug,
          projectName: hit.title,
          versionId,
          target,
        },
      });
      success("Installed", result.message);
      setPicker(null);
      loadInstalled();
    } catch (err: any) {
      error("Installation failed", err.message);
    } finally {
      setInstalling("");
    }
  };

  const remove = async (item: InstalledItem) => {
    const ok = await confirm({
      title: `Remove ${item.filename}?`,
      message: `This deletes the jar from ${target}/. Restart the server to apply.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/servers/${serverId}/modrinth/installed/${encodeURIComponent(item.filename)}`, {
        method: "DELETE",
        query: { target },
      });
      success("Removed", `${item.filename} is no longer in ${target}/.`);
      setInstalled((prev) => prev.filter((i) => i.filename !== item.filename));
    } catch (err: any) {
      error("Remove failed", err.message);
    }
  };

  const noun = target === "mods" ? "mod" : "plugin";

  if (proxy) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300">
        <div className="flex items-start gap-3">
          <AlertCircle size={22} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <h3 className="text-base font-bold text-amber-200">Plugin manager unavailable for proxy servers</h3>
            <p className="mt-1 text-sm leading-relaxed text-amber-300/90">
              This server runs <strong>{upper}</strong>. Proxy networks do not use Bukkit/Spigot plugins or
              Fabric/Forge mods, so there is nothing for Modrinth to match against.
            </p>
            <p className="mt-3 text-xs text-amber-400">
              Upload proxy-specific jars directly to the <code>plugins</code> folder with the{" "}
              <strong>File Manager</strong>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* header + tabs */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-50">
            {target === "mods" ? <Box size={18} className="text-brand-400" /> : <Puzzle size={18} className="text-brand-400" />}
            {target === "mods" ? "Mod Manager" : "Plugin Manager"}
          </h2>
          <p className="mt-0.5 text-[0.72rem] text-zinc-500">
            Search and install {noun}s powered by <strong className="text-zinc-400">Modrinth</strong>, matched to{" "}
            {software} {version}.
          </p>
        </div>

        <div className="flex items-center rounded-xl border border-white/[0.07] bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setTab("discover")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.7rem] font-semibold transition ${
              tab === "discover" ? "bg-brand-500 text-ink-950" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
            }`}
          >
            <Search size={12} /> Discover & Install
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("installed");
              loadInstalled();
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.7rem] font-semibold transition ${
              tab === "installed" ? "bg-brand-500 text-ink-950" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
            }`}
          >
            <FolderDown size={12} /> Installed ({installed.length})
          </button>
        </div>
      </div>

      {/* context banner */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[0.66rem] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Layers size={11} className="text-brand-400" />
          Loader <strong className="text-zinc-300">{meta?.loader || "—"}</strong>
        </span>
        <span>
          Game version <strong className="text-zinc-300">{version}</strong>
        </span>
        <span>
          Folder <strong className="text-zinc-300">{target}/</strong>
        </span>
        {meta?.java && (
          <span>
            Runtime <strong className="text-zinc-300">Java {meta.java}</strong>
          </span>
        )}
      </div>

      {tab === "discover" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(query);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={target === "mods" ? "Search e.g. Sodium, Lithium, Create" : "Search e.g. EssentialsX, LuckPerms, WorldEdit"}
                className="zk-input pl-8"
              />
            </div>
            <Button type="submit" variant="primary" loading={searching}>
              Search
            </Button>
          </form>

          <div className="space-y-2">
            {searching && hits.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-[0.72rem] text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Searching Modrinth…
              </div>
            )}

            {hits.map((hit) => (
              <div
                key={hit.id}
                className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:flex-row sm:items-center"
              >
                {hit.iconUrl ? (
                  <img src={hit.iconUrl} alt="" className="h-10 w-10 flex-none rounded-lg object-cover" />
                ) : (
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-white/5">
                    {target === "mods" ? <Box size={16} className="text-zinc-500" /> : <Puzzle size={16} className="text-zinc-500" />}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[0.82rem] font-semibold text-zinc-100">{hit.title}</p>
                    <span className="flex items-center gap-1 text-[0.6rem] text-zinc-600">
                      <Download size={9} /> {formatCount(hit.downloads)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[0.68rem] leading-relaxed text-zinc-500">{hit.description}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {hit.categories.slice(0, 4).map((c) => (
                      <span key={c} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[0.56rem] text-zinc-500">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-none gap-1.5">
                  <Button size="sm" variant="subtle" onClick={() => setPicker(hit)}>
                    Versions
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={installing === hit.id}
                    onClick={() => install(hit)}
                  >
                    Install
                  </Button>
                </div>
              </div>
            ))}

            {!searching && hits.length === 0 && (
              <p className="py-10 text-center text-[0.72rem] text-zinc-500">
                No {noun}s matched. Results are limited to builds for {software} {version}.
              </p>
            )}
          </div>
        </>
      )}

      {tab === "installed" && (
        <div className="space-y-2">
          {loadingInstalled && (
            <div className="flex items-center justify-center gap-2 py-10 text-[0.72rem] text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Reading {target}/…
            </div>
          )}
          {!loadingInstalled && installed.length === 0 && (
            <p className="py-10 text-center text-[0.72rem] text-zinc-500">
              Nothing installed yet. Switch to Discover to add your first {noun}.
            </p>
          )}
          {installed.map((item) => (
            <div
              key={item.filename}
              className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <CheckCircle2 size={14} className="flex-none text-emerald-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-[0.72rem] text-zinc-300">{item.filename}</span>
              <span className="flex-none text-[0.62rem] text-zinc-600">{formatSize(item.size)}</span>
              <button
                type="button"
                onClick={() => remove(item)}
                className="flex-none rounded p-1 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-400"
                title="Remove"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {picker && (
        <VersionPicker
          serverId={serverId}
          hit={picker}
          target={target}
          software={software}
          version={version}
          installing={installing}
          onClose={() => setPicker(null)}
          onInstall={(versionId) => install(picker, versionId)}
        />
      )}
    </div>
  );
};

/* ---------------------------------------------------------- version picker */

const VersionPicker: React.FC<{
  serverId: string;
  hit: CatalogHit;
  target: "plugins" | "mods";
  software: string;
  version: string;
  installing: string;
  onClose: () => void;
  onInstall: (versionId: string) => void;
}> = ({ serverId, hit, target, software, version, installing, onClose, onInstall }) => {
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [channel, setChannel] = useState<"all" | "release" | "beta">("release");
  const [compatibleOnly, setCompatibleOnly] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ versions: ProjectVersion[] }>(`/servers/${serverId}/modrinth/versions/${encodeURIComponent(hit.slug || hit.id)}`, {
      query: { target },
    })
      .then((data) => {
        if (alive) setVersions(data.versions || []);
      })
      .catch((err) => {
        if (alive) setFailure(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serverId, hit.slug, hit.id, target]);

  const shown = useMemo(() => {
    let list = versions;
    if (compatibleOnly) list = list.filter((v) => v.compatible);
    if (channel !== "all") list = list.filter((v) => v.versionType === channel || (channel === "release" && v.versionType === "alpha") === false);
    if (channel === "beta") list = list.filter((v) => v.versionType !== "alpha");
    return list;
  }, [versions, channel, compatibleOnly]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a0a0c]">
        <div className="flex items-start gap-3 border-b border-white/[0.06] p-4">
          {hit.iconUrl ? (
            <img src={hit.iconUrl} alt="" className="h-11 w-11 flex-none rounded-lg object-cover" />
          ) : (
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-white/5">
              <Puzzle size={18} className="text-zinc-500" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold text-zinc-50">{hit.title}</h3>
            <p className="mt-0.5 line-clamp-2 text-[0.68rem] text-zinc-500">{hit.description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <label className="flex items-center gap-1.5 text-[0.66rem] text-zinc-400">
            <input type="checkbox" checked={compatibleOnly} onChange={(e) => setCompatibleOnly(e.target.checked)} />
            Only {software} {version}
          </label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as "all" | "release" | "beta")}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[0.66rem] text-zinc-300 outline-none"
          >
            <option value="release">Releases only</option>
            <option value="beta">Include betas</option>
            <option value="all">All channels</option>
          </select>
          <span className="ml-auto text-[0.62rem] text-zinc-600">{shown.length} build(s)</span>
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[0.72rem] text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading builds…
            </div>
          )}
          {failure && <p className="py-10 text-center text-[0.72rem] text-rose-400">{failure}</p>}
          {!loading && !failure && shown.length === 0 && (
            <p className="py-10 text-center text-[0.72rem] text-zinc-500">
              No builds match this filter. Try allowing betas or turning off the version filter.
            </p>
          )}

          <div className="space-y-1.5">
            {shown.map((v) => (
              <div
                key={v.id}
                className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[0.74rem] font-semibold text-zinc-200">{v.versionNumber}</span>
                    <ChannelBadge type={v.versionType} />
                    {v.compatible && (
                      <span className="flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-emerald-300">
                        <Check size={8} /> match
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6rem] text-zinc-600">
                    <span className="flex items-center gap-1">
                      <Tag size={9} /> {v.gameVersions.slice(0, 4).join(", ")}
                    </span>
                    <span>{v.loaders.slice(0, 3).join(", ")}</span>
                    <span>{relative(v.datePublished)}</span>
                    <span>{formatSize(v.file?.size || 0)}</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={v.compatible ? "primary" : "subtle"}
                  loading={installing === v.id}
                  onClick={() => onInstall(v.id)}
                >
                  Install
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModrinthManager;

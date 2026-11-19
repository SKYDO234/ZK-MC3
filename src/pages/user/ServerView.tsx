import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Terminal,
  FolderTree,
  Settings,
  Archive,
  Play,
  Square,
  RotateCw,
  Power,
  Cpu,
  MemoryStick,
  HardDrive,
  Send,
  Trash2,
  Download,
  Upload,
  FileText,
  Folder,
  ChevronRight,
  ArrowLeft,
  RefreshCcw,
  Save,
  X,
  Plus,
  Plug,
  Puzzle,
  Clock,
  Activity,
  Loader2,
  AlertTriangle,
  Wrench,
  Users,
  UserPlus,
  UserMinus,
  Shield,
  Ban,
  Globe2,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
  Card,
  CardHeader,
  Button,
  Badge,
  Tabs,
  PageSkeleton,
  Progress,
  EmptyState,
  Modal,
  Field,
  Switch,
} from "../../components/ui";
import { StatusPill } from "../../components/StatusPill";
import { useApi, useServerSocket, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { useSettings } from "../../context/SettingsContext";
import { api, apiDownload, uploadFile } from "../../lib/api";
import { formatMb, formatUptime, relativeTime, pct, formatBytes, formatDateTime } from "../../lib/format";
import { ServerConsole } from "./ServerConsole";
import { ModrinthManager } from "../../components/ModrinthManager";
import { PlayitTunnel } from "./PlayitTunnel";

/* ------------------------------------------------------------------ Console */
const ConsoleTab: React.FC<{ server: any; onStatus: (s: string) => void; onRefresh: () => void }> = (props) => (
  <ServerConsole server={props.server} onStatus={props.onStatus} onRefresh={props.onRefresh} />
);

/* ------------------------------------------------------------- FileManager */
const FilesTab: React.FC<{ server: any }> = ({ server }) => {
  const { success, error, confirm } = useToast();
  const [path, setPath] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ path: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (target = path) => {
      setLoading(true);
      try {
        const data = await api<{ path: string; items: any[] }>(`/servers/${server.id}/files`, { query: { path: target } });
        setItems(data.items || []);
        setPath(data.path || "");
      } catch (err: any) {
        error("Unable to open folder", err.message);
      } finally {
        setLoading(false);
      }
    },
    [path, server.id, error]
  );

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  const openFile = async (item: any) => {
    if (item.isDirectory) {
      load(item.path);
      return;
    }
    try {
      const data = await api<{ content: string }>(`/servers/${server.id}/files/read`, { query: { path: item.path } });
      setEditor({ path: item.path, content: data.content });
    } catch (err: any) {
      error("Cannot open file", err.message);
    }
  };

  const saveFile = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await api(`/servers/${server.id}/files/save`, { method: "POST", body: editor });
      success("File saved", editor.path);
      setEditor(null);
      load();
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(`/servers/${server.id}/files/create`, file, { path });
      }
      success("Upload complete", `${files.length} file(s) uploaded`);
      load();
    } catch (err: any) {
      error("Upload failed", err.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (item: any) => {
    const ok = await confirm({
      title: `Delete ${item.isDirectory ? "folder" : "file"} "${item.name}"?`,
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/servers/${server.id}/files`, { method: "DELETE", query: { path: item.path } });
      success("Deleted", item.name);
      load();
    } catch (err: any) {
      error("Delete failed", err.message);
    }
  };

  const createFolder = async () => {
    const name = window.prompt("New folder name");
    if (!name) return;
    try {
      await api(`/servers/${server.id}/files/mkdir`, { method: "POST", body: { path: path ? `${path}/${name}` : name } });
      success("Folder created", name);
      load();
    } catch (err: any) {
      error("Could not create folder", err.message);
    }
  };

  const segments = path ? path.split("/") : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2 text-[0.76rem]">
          <button onClick={() => load("")} className="font-medium text-brand-400 hover:text-brand-300">
            /root
          </button>
          {segments.map((seg, i) => (
            <React.Fragment key={i}>
              <ChevronRight size={12} className="text-zinc-600" />
              <button
                onClick={() => load(segments.slice(0, i + 1).join("/"))}
                className="text-zinc-400 hover:text-zinc-100"
              >
                {seg}
              </button>
            </React.Fragment>
          ))}
        </div>
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
        <Button size="sm" icon={<Upload size={12} />} loading={uploading} onClick={() => fileInput.current?.click()}>
          Upload
        </Button>
        <Button size="sm" icon={<Plus size={12} />} onClick={createFolder}>
          Folder
        </Button>
        <Button size="sm" icon={<RefreshCcw size={12} />} onClick={() => load()}>
          Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.07]">
        <table className="zk-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="py-10 text-center">
                  <Loader2 className="zk-spin mx-auto text-brand-400" size={18} />
                </td>
              </tr>
            )}
            {!loading && path && (
              <tr>
                <td colSpan={4}>
                  <button
                    onClick={() => load(segments.slice(0, -1).join("/"))}
                    className="flex items-center gap-2 text-[0.8rem] text-zinc-400 hover:text-zinc-100"
                  >
                    <ArrowLeft size={13} /> ..
                  </button>
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-xs text-zinc-500">
                  This folder is empty.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr key={item.path}>
                  <td>
                    <button onClick={() => openFile(item)} className="flex items-center gap-2 text-left hover:text-brand-300">
                      {item.isDirectory ? (
                        <Folder size={14} className="text-brand-400" />
                      ) : (
                        <FileText size={14} className="text-zinc-500" />
                      )}
                      <span className="text-[0.8rem] text-zinc-200">{item.name}</span>
                    </button>
                  </td>
                  <td className="font-mono text-[0.7rem] text-zinc-500">
                    {item.isDirectory ? "—" : formatBytes(item.size)}
                  </td>
                  <td className="text-[0.7rem] text-zinc-500">{formatDateTime(item.modified)}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {!item.isDirectory && (
                        <button
                          title="Download"
                          onClick={() => apiDownload(`/servers/${server.id}/files/read?path=${encodeURIComponent(item.path)}`, item.name)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                        >
                          <Download size={12} />
                        </button>
                      )}
                      <button
                        title="Delete"
                        onClick={() => remove(item)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.path || ""}
        subtitle="Editing file in server directory"
        width="max-w-3xl"
        icon={<FileText size={16} />}
        footer={
          <>
            <Button onClick={() => setEditor(null)}>Cancel</Button>
            <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={saveFile}>
              Save changes
            </Button>
          </>
        }
      >
        <textarea
          className="zk-textarea min-h-[48vh] font-mono text-[0.78rem]"
          value={editor?.content || ""}
          onChange={(e) => setEditor((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
          spellCheck={false}
        />
      </Modal>
    </div>
  );
};

/* ----------------------------------------------------------------- Players */
const PlayersTab: React.FC<{ server: any }> = ({ server }) => {
  const { success, error } = useToast();
  const { data, loading, reload } = useApi<any>(`/servers/${server.id}/players`);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [reason, setReason] = useState("");
  const online = server.status === "online";

  const run = async (action: string, player: string) => {
    setBusy(`${action}:${player}`);
    try {
      await api(`/servers/${server.id}/players/${action}`, { method: "POST", body: { player, reason } });
      success("Command sent", `${action.replace(/_/g, " ")} → ${player}`);
      setName("");
      setReason("");
      setTimeout(reload, 900);
    } catch (err: any) {
      error("Command failed", err.message);
    } finally {
      setBusy("");
    }
  };

  if (loading) return <PageSkeleton />;

  const whitelist: any[] = data?.whitelist || [];
  const ops: any[] = data?.ops || [];
  const banned: any[] = data?.banned || [];
  const isOp = (n: string) => ops.some((o) => o.name?.toLowerCase() === n.toLowerCase());
  const isListed = (n: string) => whitelist.some((w) => w.name?.toLowerCase() === n.toLowerCase());
  const isBanned = (n: string) => banned.some((b) => b.name?.toLowerCase() === n.toLowerCase());

  return (
    <div className="space-y-4">
      {!online && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-[0.74rem] leading-relaxed text-amber-200/80">
          <AlertTriangle size={14} className="mt-0.5 flex-none text-amber-400" />
          Player lists are read from disk. Start the server to change them — commands need a live console.
        </div>
      )}

      <Card>
        <CardHeader
          title="Manage a player"
          subtitle="Whitelist, promote to operator, kick or ban by username"
          icon={<Users size={16} />}
          action={<Badge tone={data?.whitelistEnabled ? "online" : "offline"}>{data?.whitelistEnabled ? "Whitelist on" : "Whitelist off"}</Badge>}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Player name">
            <input
              className="zk-input"
              placeholder="Notch"
              value={name}
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Reason (ban / kick)">
            <input className="zk-input" placeholder="Optional" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              icon={<UserPlus size={13} />}
              loading={busy.startsWith("whitelist_add")}
              disabled={!online || !name.trim()}
              onClick={() => run("whitelist_add", name.trim())}
            >
              Whitelist
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<Shield size={12} />} disabled={!online || !name.trim()} loading={busy.startsWith("op:")} onClick={() => run("op", name.trim())}>Make operator</Button>
          <Button size="sm" variant="ghost" icon={<UserMinus size={12} />} disabled={!online || !name.trim()} loading={busy.startsWith("deop:")} onClick={() => run("deop", name.trim())}>Remove operator</Button>
          <Button size="sm" variant="ghost" icon={<Ban size={12} />} disabled={!online || !name.trim()} loading={busy.startsWith("ban:")} onClick={() => run("ban", name.trim())}>Ban</Button>
          <Button size="sm" variant="ghost" disabled={!online || !name.trim()} loading={busy.startsWith("pardon:")} onClick={() => run("pardon", name.trim())}>Pardon</Button>
          <Button size="sm" variant="ghost" disabled={!online || !name.trim()} loading={busy.startsWith("kick:")} onClick={() => run("kick", name.trim())}>Kick</Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Whitelist" subtitle={`${whitelist.length} ${whitelist.length === 1 ? "player" : "players"}`} icon={<UserPlus size={15} />} />
          {whitelist.length === 0 ? (
            <p className="mt-4 text-[0.76rem] text-zinc-500">Nobody is whitelisted yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.05]">
              {whitelist.map((p) => (
                <li key={p.uuid || p.name} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2 text-[0.8rem] text-zinc-200">
                    <span className="zk-avatar-dot" /> {p.name}
                    {isOp(p.name) && <Badge tone="brand">OP</Badge>}
                  </span>
                  <button
                    className="zk-btn zk-btn-ghost zk-btn-sm"
                    disabled={!online}
                    onClick={() => run("whitelist_remove", p.name)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Operators" subtitle={`${ops.length} ${ops.length === 1 ? "operator" : "operators"}`} icon={<Shield size={15} />} />
          {ops.length === 0 ? (
            <p className="mt-4 text-[0.76rem] text-zinc-500">No operators configured.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.05]">
              {ops.map((p) => (
                <li key={p.uuid || p.name} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-[0.8rem] text-zinc-200">{p.name}</span>
                  <Badge tone="info">level {p.level ?? 4}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {banned.length > 0 && (
        <Card>
          <CardHeader title="Banned players" subtitle={`${banned.length} banned`} icon={<Ban size={15} />} />
          <ul className="mt-3 divide-y divide-white/[0.05]">
            {banned.map((p) => (
              <li key={p.uuid || p.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-[0.8rem] text-zinc-200">{p.name}</span>
                <span className="text-[0.7rem] text-zinc-500">{p.reason || "No reason given"}</span>
                <button className="zk-btn zk-btn-ghost zk-btn-sm" disabled={!online} onClick={() => run("pardon", p.name)}>
                  Pardon
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------- Backups */
const BackupsTab: React.FC<{ server: any }> = ({ server }) => {
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>(`/servers/${server.id}/backups`);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");

  const create = async () => {
    setCreating(true);
    try {
      await api(`/servers/${server.id}/backups`, { method: "POST", body: { label } });
      success("Backup created", "A new archive was written to storage.");
      setLabel("");
      reload();
    } catch (err: any) {
      error("Backup failed", err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Create a backup"
          subtitle="Captures the entire server directory into a downloadable ZIP archive"
          icon={<Archive size={16} />}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="zk-input flex-1 min-w-[200px]"
            placeholder="Optional label (e.g. before-plugin-update)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button variant="primary" icon={<Archive size={14} />} loading={creating} onClick={create}>
            Create backup
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader
            title="Backup history"
            subtitle={`${data?.length || 0} archive(s) stored`}
            icon={<Clock size={16} />}
          />
        </div>
        {loading ? (
          <div className="p-10 text-center"><Loader2 className="zk-spin mx-auto text-brand-400" size={18} /></div>
        ) : (data || []).length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<Archive size={22} />} title="No backups yet" message="Create your first snapshot to protect your world and configuration." />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>Archive</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((backup) => (
                  <tr key={backup.fileName}>
                    <td className="font-mono text-[0.72rem] text-zinc-300">{backup.fileName}</td>
                    <td className="font-mono text-[0.72rem]">{formatBytes(backup.size)}</td>
                    <td className="text-[0.72rem] text-zinc-500">{formatDateTime(backup.createdAt)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          icon={<Download size={12} />}
                          onClick={() => apiDownload(`/servers/${server.id}/backups/${backup.fileName}/download`, backup.fileName)}
                        >
                          Download
                        </Button>
                        <Button
                          size="sm"
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Restore this backup?",
                              message: "Files in the archive overwrite existing server files with the same name.",
                              confirmLabel: "Restore",
                              danger: true,
                            });
                            if (!ok) return;
                            try {
                              await api(`/servers/${server.id}/backups/${backup.fileName}/restore`, { method: "POST" });
                              success("Backup restored");
                            } catch (err: any) {
                              error("Restore failed", err.message);
                            }
                          }}
                        >
                          Restore
                        </Button>
                        <button
                          onClick={async () => {
                            const ok = await confirm({ title: "Delete backup?", message: backup.fileName, danger: true, confirmLabel: "Delete" });
                            if (!ok) return;
                            await api(`/servers/${server.id}/backups/${backup.fileName}`, { method: "DELETE" }).catch(() => {});
                            reload();
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

/* --------------------------------------------------------------- Properties */
const SettingsTab: React.FC<{ server: any; onSaved: () => void }> = ({ server, onSaved }) => {
  const { success, error } = useToast();
  const { data, reload } = useApi<{ content: string }>(`/servers/${server.id}/properties`);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: server.name,
    description: server.description || "",
    autoRestart: Boolean(server.autoRestart),
  });

  useEffect(() => {
    if (data?.content !== undefined) setContent(data.content);
  }, [data]);

  const saveProperties = async () => {
    setSaving(true);
    try {
      await api(`/servers/${server.id}/properties`, { method: "PUT", body: { content } });
      success("server.properties saved", "Restart the server for changes to take effect.");
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveMeta = async () => {
    setSaving(true);
    try {
      await api(`/servers/${server.id}`, { method: "PATCH", body: form });
      success("Server settings updated");
      onSaved();
    } catch (err: any) {
      error("Update failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Server details" subtitle="Rename, describe and automate your instance" icon={<Settings size={16} />} />
        <div className="mt-4 space-y-3.5">
          <Field label="Server name" required>
            <input className="zk-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea
              className="zk-textarea min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this server for?"
            />
          </Field>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
            <div>
              <p className="text-[0.8rem] font-medium text-zinc-200">Auto-restart on crash</p>
              <p className="text-[0.68rem] text-zinc-500">Automatically boot the server again if the process exits unexpectedly.</p>
            </div>
            <Switch checked={form.autoRestart} onChange={(v) => setForm((f) => ({ ...f, autoRestart: v }))} />
          </div>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={saveMeta}>
            Save details
          </Button>
        </div>
        <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4 text-[0.72rem]">
          {[
            ["Server ID", server.id],
            ["Software", `${server.software} ${server.version}`],
            ["Java version", server.javaVersion || "auto"],
            ["Created", formatDateTime(server.createdAt)],
            ["Last backup", server.lastBackupAt ? relativeTime(server.lastBackupAt) : "never"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-zinc-500">{label}</span>
              <span className="truncate font-mono text-zinc-300">{value}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="server.properties"
          subtitle="Raw Minecraft configuration file — restart to apply"
          icon={<FileText size={16} />}
          action={
            <Button size="sm" icon={<Save size={12} />} loading={saving} onClick={saveProperties}>
              Save
            </Button>
          }
        />
        <textarea
          className="zk-textarea mt-4 min-h-[330px] font-mono text-[0.72rem]"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          placeholder="# This file appears after installation completes"
        />
      </Card>
    </div>
  );
};

/* --------------------------------------------------------------- Plugins */

/**
 * The plugin/mod manager lives in its own component so the JTG-style discover /
 * installed / version-picker flow stays readable. Proxy servers are handled
 * inside the component with an explanatory panel.
 */
const PluginsTab: React.FC<{ server: any }> = ({ server }) => (
  <ModrinthManager serverId={server.id} software={server.software} version={server.version} />
);

/* ----------------------------------------------------------------- Main page */
export const ServerView: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error, confirm } = useToast();
  const { data: server, loading, reload } = useApi<any>(id ? `/servers/${id}` : null);
  const { data: stats, reload: reloadStats } = useApi<any>(id ? `/servers/${id}/stats` : null);
  const { data: health } = useApi<any>("/system/health");
  const { settings } = useSettings();
  // Playit is an operator opt-in; when it is off the tab disappears entirely.
  const playitEnabled = Boolean(settings.enablePlayit);
  const [tab, setTab] = useState("console");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  useDocumentTitle(server ? `${server.name} · ZK-MC3-PANEL` : "Server · ZK-MC3-PANEL");

  // Hooks must run before the early returns below. If tunnels get switched off
  // while the Tunnel tab is open, fall back to the console rather than a blank pane.
  useEffect(() => {
    if (!playitEnabled && tab === "tunnel") setTab("console");
  }, [playitEnabled, tab]);

  useEffect(() => {
    if (status) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const timer = setInterval(() => {
      reloadStats();
    }, 4000);
    return () => clearInterval(timer);
  }, [reloadStats]);

  const act = async (action: "start" | "stop" | "restart" | "kill") => {
    setBusy(action);
    try {
      await api(`/servers/${id}/${action}`, { method: "POST" });
      success(`Server ${action}ed`, "Power action dispatched successfully.");
      setTimeout(() => {
        reload();
        reloadStats();
      }, 1200);
    } catch (err: any) {
      error("Power action failed", err.message);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${server.name}"?`,
      message: "All files, worlds and backups will be permanently removed.",
      danger: true,
      confirmLabel: "Delete permanently",
    });
    if (!ok) return;
    try {
      await api(`/servers/${id}`, { method: "DELETE" });
      success("Server deleted");
      navigate("/servers");
    } catch (err: any) {
      error("Delete failed", err.message);
    }
  };

  if (loading && !server) return <PageSkeleton />;
  if (!server) {
    return (
      <EmptyState
        icon={<X size={22} />}
        title="Server not found"
        message="It may have been deleted, or you no longer have access."
        action={<Button onClick={() => navigate("/servers")}>Back to servers</Button>}
      />
    );
  }

  const tabs = [
    { id: "console", label: "Console", icon: <Terminal size={14} /> },
    { id: "files", label: "File Manager", icon: <FolderTree size={14} /> },
    { id: "plugins", label: "Plugins & Mods", icon: <Puzzle size={14} /> },
    { id: "players", label: "Players", icon: <Users size={14} /> },
    ...(playitEnabled ? [{ id: "tunnel", label: "Tunnel", icon: <Globe2 size={14} /> }] : []),
    { id: "backups", label: "Backups", icon: <Archive size={14} /> },
    { id: "settings", label: "Settings", icon: <Settings size={14} /> },
  ];

  const cpu = stats?.cpu ?? 0;
  const ramUsed = stats?.ram ?? 0;
  const diskUsed = stats?.disk ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Terminal size={20} />}
        breadcrumb={[{ label: "Servers", to: "/servers" }, { label: server.name }]}
        title={server.name}
        subtitle={`${server.software} ${server.version} · port ${server.port} · node ${server.nodeId}`}
        actions={
          <>
            <StatusPill status={server.status} />
            {server.status === "online" ? (
              <Button size="sm" icon={<Square size={13} />} loading={busy === "stop"} onClick={() => act("stop")}>
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="success"
                icon={<Play size={13} />}
                loading={busy === "start"}
                onClick={() => act("start")}
                disabled={server.status === "installing" || server.status === "suspended"}
              >
                Start
              </Button>
            )}
            <Button size="sm" icon={<RotateCw size={13} />} loading={busy === "restart"} onClick={() => act("restart")} disabled={server.status !== "online"}>
              Restart
            </Button>
            <Button size="sm" variant="danger" icon={<Power size={13} />} loading={busy === "kill"} onClick={() => act("kill")}>
              Kill
            </Button>
            <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} onClick={remove}>
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="!p-3.5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
            <Cpu size={13} className="text-brand-400" /> CPU usage
          </div>
          <p className="mt-1.5 font-display text-lg font-bold text-zinc-50">{cpu.toFixed(1)}%</p>
          <Progress className="mt-2" value={Math.min(100, cpu)} />
        </Card>
        <Card className="!p-3.5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
            <MemoryStick size={13} className="text-brand-400" /> Memory
          </div>
          <p className="mt-1.5 font-display text-lg font-bold text-zinc-50">
            {formatMb(ramUsed)} <span className="text-xs font-medium text-zinc-600">/ {formatMb(server.ram)}</span>
          </p>
          <Progress className="mt-2" value={pct(ramUsed, server.ram)} />
        </Card>
        <Card className="!p-3.5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
            <HardDrive size={13} className="text-brand-400" /> Disk
          </div>
          <p className="mt-1.5 font-display text-lg font-bold text-zinc-50">
            {formatMb(diskUsed)} <span className="text-xs font-medium text-zinc-600">/ {formatMb(server.disk)}</span>
          </p>
          <Progress className="mt-2" value={pct(diskUsed, server.disk)} />
        </Card>
        <Card className="!p-3.5">
          <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
            <Activity size={13} className="text-brand-400" /> Uptime
          </div>
          <p className="mt-1.5 font-display text-lg font-bold text-zinc-50">{formatUptime(stats?.uptimeSeconds || 0)}</p>
          <p className="mt-2 truncate font-mono text-[0.62rem] text-zinc-600">
            PID {stats?.pid || "—"} · {server.ip === "0.0.0.0" ? "0.0.0.0" : server.ip}:{server.port}
          </p>
        </Card>
      </div>

      {health && !health.java?.installed && server.status === "error" && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3">
          <Wrench size={16} className="mt-0.5 flex-none text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.82rem] font-semibold text-amber-100">Java runtime not detected on this node</p>
            <p className="mt-0.5 text-[0.72rem] leading-relaxed text-amber-200/70">
              Minecraft servers require a JDK. Run <code className="zk-kbd">sudo bash install.sh</code> on the host or install OpenJDK 21,
              then restart the server. Node.js and Python runtimes do not need Java.
            </p>
          </div>
          <Link to="/account" className="zk-btn zk-btn-ghost zk-btn-sm">Learn more</Link>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="zk-fade-up" key={tab}>
        {tab === "console" && <ConsoleTab server={server} onStatus={setStatus} onRefresh={reload} />}
        {tab === "files" && <FilesTab server={server} />}
        {tab === "plugins" && <PluginsTab server={server} />}
        {tab === "players" && <PlayersTab server={server} />}
        {tab === "tunnel" && <PlayitTunnel serverId={server.id} enabled={playitEnabled} />}
        {tab === "backups" && <BackupsTab server={server} />}
        {tab === "settings" && <SettingsTab server={server} onSaved={reload} />}
      </div>
    </div>
  );
};

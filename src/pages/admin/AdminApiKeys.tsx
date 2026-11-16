import React, { useMemo, useState } from "react";
import {
  KeyRound,
  Plus,
  Copy,
  Trash2,
  ShieldOff,
  ShieldCheck,
  Activity,
  Check,
  AlertTriangle,
  Users,
  Clock,
  Search,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
  Card,
  CardHeader,
  Button,
  Badge,
  Modal,
  Field,
  PageSkeleton,
  StatCard,
  SearchInput,
  EmptyState,
  Switch,
} from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { copyToClipboard, formatDate, relativeTime } from "../../lib/format";

const SCOPES: Record<string, string> = {
  "servers.read": "Read servers",
  "servers.write": "Manage servers",
  "servers.power": "Power actions",
  "files.read": "Read files",
  "files.write": "Write files",
  "backups.read": "Read backups",
  "backups.write": "Manage backups",
  "users.read": "Read users",
  "users.write": "Manage users",
  "nodes.read": "Read nodes",
  "nodes.write": "Manage nodes",
  "settings.read": "Read settings",
  "settings.write": "Manage settings",
  "*": "Full administrator access",
};

export const AdminApiKeys: React.FC = () => {
  useDocumentTitle("API Keys · Admin · ZK-MC3-PANEL");
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/api-keys");
  const { data: users } = useApi<any[]>("/users/directory");

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    scopes: ["servers.read", "servers.power"],
    userId: "",
    never: true,
    expiresInDays: 30,
  });

  const keys = data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter(
      (k) => k.name.toLowerCase().includes(q) || (k.username || "").toLowerCase().includes(q) || k.prefix.includes(q)
    );
  }, [keys, search]);

  const create = async () => {
    if (form.name.trim().length < 3) return error("Key name too short");
    if (!form.scopes.length) return error("Select at least one scope");
    setSaving(true);
    try {
      const result = await api<{ key: string }>("/api-keys", {
        method: "POST",
        body: {
          name: form.name,
          scopes: form.scopes,
          userId: form.userId || undefined,
          expiresInDays: form.never ? 0 : form.expiresInDays,
        },
      });
      setCreatedKey(result.key);
      setCreateOpen(false);
      reload();
    } catch (err: any) {
      error("Could not create key", err.message);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (key: any) => {
    const ok = await confirm({
      title: `Revoke "${key.name}"?`,
      message: "All requests using this key will fail immediately.",
      danger: true,
      confirmLabel: "Revoke",
    });
    if (!ok) return;
    try {
      await api(`/api-keys/${key.id}/revoke`, { method: "POST" });
      success("Key revoked");
      reload();
    } catch (err: any) {
      error("Revoke failed", err.message);
    }
  };

  const remove = async (key: any) => {
    const ok = await confirm({ title: `Delete "${key.name}"?`, message: "This cannot be undone.", danger: true, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await api(`/api-keys/${key.id}`, { method: "DELETE" });
      success("Key deleted");
      reload();
    } catch (err: any) {
      error("Delete failed", err.message);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<KeyRound size={20} />}
        title="API Key Management"
        subtitle="Issue scoped credentials for integrations, automation and internal tooling."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            Generate key
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total keys" value={keys.length} icon={<KeyRound size={16} />} accent />
        <StatCard label="Active keys" value={keys.filter((k) => !k.revoked).length} icon={<ShieldCheck size={16} />} />
        <StatCard label="Revoked" value={keys.filter((k) => k.revoked).length} icon={<ShieldOff size={16} />} />
        <StatCard label="Owners" value={new Set(keys.map((k) => k.userId)).size} icon={<Users size={16} />} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, owner or prefix…" className="min-w-[220px] flex-1" />
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<KeyRound size={22} />}
              title="No API keys"
              message="Generate a scoped key to integrate external dashboards, CI pipelines or Discord bots."
              action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>Generate key</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((key) => {
                  const expired = key.expiresAt && new Date(key.expiresAt) < new Date();
                  return (
                    <tr key={key.id}>
                      <td className="font-medium text-zinc-100">{key.name}</td>
                      <td className="text-[0.72rem] text-zinc-400">{key.username || "—"}</td>
                      <td className="font-mono text-[0.7rem] text-brand-300">{key.prefix}…</td>
                      <td>
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {(key.scopes || []).slice(0, 2).map((s: string) => (
                            <Badge key={s} tone="brand">{s}</Badge>
                          ))}
                          {(key.scopes || []).length > 2 && <Badge tone="info">+{key.scopes.length - 2}</Badge>}
                        </div>
                      </td>
                      <td className="text-[0.7rem] text-zinc-500">{formatDate(key.createdAt)}</td>
                      <td className="text-[0.7rem] text-zinc-500">{key.lastUsedAt ? relativeTime(key.lastUsedAt) : "never"}</td>
                      <td className="text-[0.7rem] text-zinc-500">{key.expiresAt ? formatDate(key.expiresAt) : "Never"}</td>
                      <td>
                        {key.revoked ? (
                          <Badge tone="danger" dot>Revoked</Badge>
                        ) : expired ? (
                          <Badge tone="warn" dot>Expired</Badge>
                        ) : (
                          <Badge tone="online" dot>Active</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {!key.revoked && (
                            <button
                              onClick={() => revoke(key)}
                              title="Revoke"
                              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-amber-500/15 hover:text-amber-300"
                            >
                              <ShieldOff size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => remove(key)}
                            title="Delete"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="API security posture" subtitle="Recommendations for production" icon={<ShieldCheck size={16} />} />
          <ul className="mt-4 space-y-2 text-[0.74rem] text-zinc-400">
            {[
              "Rotate keys every 90 days and revoke unused credentials.",
              "Grant the narrowest scope set required by each integration.",
              "Never embed keys in client-side JavaScript bundles.",
              "Monitor last-used timestamps for unexpected access.",
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2">
                <Check size={13} className="mt-0.5 flex-none text-emerald-400" />
                {tip}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Rate limits" subtitle="Enforced per API key" icon={<Activity size={16} />} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["Requests / minute", "120"],
              ["Keys per user", "10"],
              ["Default expiry", "Never"],
              ["Audit retention", "600 events"],
            ].map(([label, value]) => (
              <div key={label} className="zk-inset p-3">
                <p className="text-[0.62rem] uppercase tracking-wider text-zinc-600">{label}</p>
                <p className="mt-0.5 font-mono text-[0.8rem] font-semibold text-zinc-200">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[0.68rem] text-zinc-600">
            Adjust these values from Panel Settings → API.
          </p>
        </Card>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Generate API key"
        subtitle="Choose the owner and least-privilege scopes"
        icon={<KeyRound size={16} />}
        width="max-w-xl"
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={create}>Generate</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Key name" required>
            <input className="zk-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Grafana metrics exporter" />
          </Field>
          <Field label="Owner" hint="The key inherits this account's permissions">
            <select className="zk-select" value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}>
              <option value="">Myself (administrator)</option>
              {(users || []).map((u: any) => (
                <option key={u.id} value={u.id}>{u.username} · {u.role}</option>
              ))}
            </select>
          </Field>
          <div>
            <label className="zk-label">Scopes</label>
            <div className="grid max-h-[200px] gap-1.5 overflow-y-auto rounded-xl border border-white/[0.07] p-2 sm:grid-cols-2">
              {Object.entries(SCOPES).map(([scope, label]) => {
                const checked = form.scopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[0.72rem] transition ${
                      checked ? "border-brand-500/35 bg-brand-500/10 text-brand-200" : "border-white/[0.06] text-zinc-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="zk-checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          scopes: e.target.checked ? [...f.scopes, scope] : f.scopes.filter((s) => s !== scope),
                        }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block truncate font-mono text-[0.6rem] text-zinc-600">{scope}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
            <div>
              <p className="text-[0.8rem] font-medium text-zinc-200">Never expire</p>
              <p className="text-[0.66rem] text-zinc-500">Disable to set a fixed lifetime</p>
            </div>
            <Switch checked={form.never} onChange={(v) => setForm((f) => ({ ...f, never: v }))} />
          </div>
          {!form.never && (
            <Field label="Expires in (days)">
              <input type="number" className="zk-input" value={form.expiresInDays} onChange={(e) => setForm((f) => ({ ...f, expiresInDays: Number(e.target.value) }))} />
            </Field>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(createdKey)}
        onClose={() => { setCreatedKey(null); setCopied(false); }}
        title="API key generated"
        subtitle="Copy it now — it will not be shown again"
        icon={<ShieldCheck size={16} />}
        width="max-w-xl"
        footer={<Button variant="primary" onClick={() => { setCreatedKey(null); setCopied(false); }}>Done</Button>}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.08] p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[0.74rem] text-brand-200">{createdKey}</code>
            <Button
              size="sm"
              variant="primary"
              icon={copied ? <Check size={12} /> : <Copy size={12} />}
              onClick={async () => {
                const ok = await copyToClipboard(createdKey || "");
                setCopied(ok);
                if (ok) success("Copied");
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[0.7rem] text-amber-200/80">
            <AlertTriangle size={13} className="mt-0.5 flex-none" />
            Store it in your secret manager — only a SHA-256 hash is retained by the panel.
          </div>
          <div className="flex items-center gap-2 text-[0.68rem] text-zinc-500">
            <Clock size={12} /> Recorded in the audit log with your account and IP.
          </div>
        </div>
      </Modal>
    </div>
  );
};

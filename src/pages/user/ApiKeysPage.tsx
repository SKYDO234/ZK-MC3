import React, { useMemo, useState } from "react";
import {
  KeyRound,
  Plus,
  Copy,
  Trash2,
  ShieldOff,
  Eye,
  EyeOff,
  ShieldCheck,
  Clock,
  Activity,
  Terminal,
  Check,
  AlertTriangle,
  Code2,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
  Card,
  CardHeader,
  Button,
  Badge,
  EmptyState,
  PageSkeleton,
  Modal,
  Field,
  StatCard,
  Switch,
} from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { copyToClipboard, formatDate, relativeTime } from "../../lib/format";

const SCOPE_LABELS: Record<string, string> = {
  "servers.read": "Read servers",
  "servers.write": "Manage servers",
  "servers.power": "Power actions",
  "files.read": "Read files",
  "files.write": "Write files",
  "backups.read": "Read backups",
  "backups.write": "Create/restore backups",
  "users.read": "Read users",
  "users.write": "Manage users",
  "nodes.read": "Read nodes",
  "nodes.write": "Manage nodes",
  "settings.read": "Read settings",
  "settings.write": "Manage settings",
  "*": "Full access (admin)",
};

export const ApiKeysPage: React.FC = () => {
  useDocumentTitle("API Keys · ZK-MC3-PANEL");
  const { isAdmin } = useAuth();
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/api-keys");
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: ["servers.read"] as string[], expiresInDays: 0, never: true });
  const [saving, setSaving] = useState(false);

  const keys = data || [];
  const active = keys.filter((k) => !k.revoked && (!k.expiresAt || new Date(k.expiresAt) > new Date()));

  const availableScopes = useMemo(
    () => Object.keys(SCOPE_LABELS).filter((s) => (isAdmin ? true : !["users.write", "nodes.write", "settings.write", "*"].includes(s))),
    [isAdmin]
  );

  const create = async () => {
    if (form.name.trim().length < 3) return error("Name too short", "Use at least 3 characters.");
    if (!form.scopes.length) return error("Select at least one scope");
    setSaving(true);
    try {
      const result = await api<{ key: string }>("/api-keys", {
        method: "POST",
        body: {
          name: form.name,
          scopes: form.scopes,
          expiresInDays: form.never ? 0 : form.expiresInDays,
        },
      });
      setCreatedKey(result.key);
      setCreateOpen(false);
      reload();
      success("API key generated", "Copy it now — it will never be shown again.");
    } catch (err: any) {
      error("Could not create key", err.message);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (key: any) => {
    const ok = await confirm({
      title: `Revoke "${key.name}"?`,
      message: "Any integration using this key will immediately lose access.",
      confirmLabel: "Revoke key",
      danger: true,
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
    const ok = await confirm({ title: `Delete "${key.name}"?`, message: "This permanently removes the key from the panel.", danger: true, confirmLabel: "Delete" });
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
        title="API Keys"
        subtitle="Generate scoped keys to automate deployments, run CI jobs and integrate with your tooling."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>
            Generate key
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total keys" value={keys.length} icon={<KeyRound size={16} />} accent />
        <StatCard label="Active" value={active.length} icon={<ShieldCheck size={16} />} hint="Not revoked or expired" />
        <StatCard label="Requests" value={keys.reduce((a, k) => a + (k.requests || 0), 0)} icon={<Activity size={16} />} hint="Total authenticated calls" />
      </div>

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Your API keys"
            subtitle="Keys are hashed with SHA-256 — the raw value is only displayed once"
            icon={<KeyRound size={16} />}
          />
        </div>

        {keys.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<KeyRound size={22} />}
              title="No API keys yet"
              message="Create a key to access the ZK-MC3 REST API from scripts, bots or external dashboards."
              action={
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                  Generate your first key
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const expired = key.expiresAt && new Date(key.expiresAt) < new Date();
                  return (
                    <tr key={key.id}>
                      <td>
                        <p className="font-medium text-zinc-100">{key.name}</p>
                        <p className="text-[0.66rem] text-zinc-600">{key.username || "you"}</p>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <code className="rounded bg-black/40 px-2 py-1 font-mono text-[0.68rem] text-brand-300">
                            {revealed[key.id] ? key.maskedKey.replace(/•+/g, "x7Kq2mZ9") : key.maskedKey}
                          </code>
                          <button
                            onClick={() => setRevealed((prev) => ({ ...prev, [key.id]: !prev[key.id] }))}
                            className="text-zinc-500 hover:text-zinc-200"
                            title="Toggle view"
                          >
                            {revealed[key.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="flex max-w-[230px] flex-wrap gap-1">
                          {(key.scopes || []).slice(0, 2).map((scope: string) => (
                            <Badge key={scope} tone="brand">
                              {scope}
                            </Badge>
                          ))}
                          {(key.scopes || []).length > 2 && (
                            <Badge tone="info">+{key.scopes.length - 2}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="text-[0.72rem] text-zinc-500">{formatDate(key.createdAt)}</td>
                      <td className="text-[0.72rem] text-zinc-500">{key.lastUsedAt ? relativeTime(key.lastUsedAt) : "never"}</td>
                      <td className="text-[0.72rem] text-zinc-500">{key.expiresAt ? formatDate(key.expiresAt) : "No expiry"}</td>
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

      <Card>
        <CardHeader title="Quick start" subtitle="Authenticate with a Bearer token in any HTTP client" icon={<Code2 size={16} />} />
        <pre className="zk-console mt-4 overflow-x-auto">
{`curl -H "Authorization: Bearer zk_your_api_key" \\
     ${window.location.origin}/api/servers

# Power on a server
curl -X POST -H "Authorization: Bearer zk_your_api_key" \\
     ${window.location.origin}/api/servers/<server-id>/start`}
        </pre>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[0.7rem] text-amber-200/80">
          <AlertTriangle size={13} className="mt-0.5 flex-none" />
          Treat API keys like passwords. Never commit them to source control or expose them in client-side code.
        </div>
      </Card>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Generate a new API key"
        subtitle="Choose only the scopes your integration actually needs"
        icon={<KeyRound size={16} />}
        width="max-w-xl"
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={create}>
              Generate key
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Key name" required hint="Something recognizable like 'CI deploy' or 'Grafana metrics'">
            <input
              className="zk-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My integration"
            />
          </Field>

          <div>
            <label className="zk-label">Scopes / permissions</label>
            <div className="grid max-h-[220px] gap-1.5 overflow-y-auto rounded-xl border border-white/[0.07] p-2 sm:grid-cols-2">
              {availableScopes.map((scope) => {
                const checked = form.scopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[0.72rem] transition ${
                      checked
                        ? "border-brand-500/35 bg-brand-500/10 text-brand-200"
                        : "border-white/[0.06] text-zinc-400 hover:border-white/15"
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
                      <span className="block truncate font-medium">{SCOPE_LABELS[scope]}</span>
                      <span className="block truncate font-mono text-[0.62rem] text-zinc-600">{scope}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
            <div>
              <p className="text-[0.8rem] font-medium text-zinc-200">Never expire</p>
              <p className="text-[0.68rem] text-zinc-500">Recommended for long-running automations</p>
            </div>
            <Switch checked={form.never} onChange={(v) => setForm((f) => ({ ...f, never: v, expiresInDays: v ? 0 : 30 }))} />
          </div>

          {!form.never && (
            <Field label="Expires in (days)">
              <input
                type="number"
                min={1}
                max={3650}
                className="zk-input"
                value={form.expiresInDays}
                onChange={(e) => setForm((f) => ({ ...f, expiresInDays: Number(e.target.value) }))}
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Reveal modal */}
      <Modal
        open={Boolean(createdKey)}
        onClose={() => {
          setCreatedKey(null);
          setCopied(false);
        }}
        title="Your new API key"
        subtitle="Copy this now — it cannot be shown again"
        icon={<ShieldCheck size={16} />}
        width="max-w-xl"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setCreatedKey(null);
              setCopied(false);
            }}
          >
            I've saved my key
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.08] p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[0.76rem] text-brand-200">{createdKey}</code>
            <Button
              size="sm"
              variant="primary"
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={async () => {
                const ok = await copyToClipboard(createdKey || "");
                setCopied(ok);
                if (ok) success("Copied to clipboard");
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[0.7rem] leading-relaxed text-amber-200/80">
            <AlertTriangle size={13} className="mt-0.5 flex-none" />
            Store this value in your secret manager. For security we only keep a SHA-256 hash on the server.
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-black/30 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-wider text-zinc-500">
              <Terminal size={11} /> Test it
            </p>
            <code className="block break-all font-mono text-[0.68rem] text-zinc-400">
              curl -H "Authorization: Bearer {createdKey?.slice(0, 12)}…" {window.location.origin}/api/servers
            </code>
          </div>
        </div>
      </Modal>
    </div>
  );
};

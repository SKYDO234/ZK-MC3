import React, { useMemo, useState } from "react";
import {
  Users,
  UserPlus,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Pencil,
  Mail,
  Coins,
  Send,
  Ban,
  CheckCircle2,
  KeyRound,
  Server,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import {
  Card,
  CardHeader,
  Button,
  Badge,
  Field,
  Modal,
  PageSkeleton,
  StatCard,
  SearchInput,
  Pagination,
  EmptyState,
} from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { formatDate, formatMoney, initials, relativeTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";

const PAGE_SIZE = 8;

export const UserManagement: React.FC = () => {
  useDocumentTitle("User Management · ZK-MC3-PANEL");
  const { user: me, isOwner } = useAuth();
  const { success, error, confirm } = useToast();
  const { data, loading, reload } = useApi<any[]>("/users");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "user",
    status: "active",
    balance: 0,
  });

  const [notifyTarget, setNotifyTarget] = useState<any>(null);
  const [notifyForm, setNotifyForm] = useState({ title: "", message: "", type: "info" });

  const users = data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matches =
        !q ||
        u.name?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q);
      const roleOk = roleFilter === "all" || u.role === roleFilter;
      return matches && roleOk;
    });
  }, [users, search, roleFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", username: "", email: "", password: "", role: "user", status: "active", balance: 0 });
    setModalOpen(true);
  };

  const openEdit = (u: any) => {
    setEditing(u);
    setForm({
      name: u.name,
      username: u.username,
      email: u.email,
      password: "",
      role: u.role,
      status: u.status,
      balance: u.balance || 0,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.username || !form.email) return error("Name, username and email are required");
    if (!editing && !form.password) return error("A password is required for new users");
    setSaving(true);
    try {
      if (editing) {
        await api(`/users/${editing.id}`, {
          method: "PATCH",
          body: { ...form, ...(form.password ? { password: form.password } : {}) },
        });
        success("User updated");
      } else {
        await api("/users", { method: "POST", body: form });
        success("User created");
      }
      setModalOpen(false);
      reload();
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: any) => {
    const ok = await confirm({
      title: `Delete "${u.username}"?`,
      message: "Their account will be permanently deleted. Servers must be reassigned first.",
      danger: true,
      confirmLabel: "Delete user",
    });
    if (!ok) return;
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      success("User deleted");
      reload();
    } catch (err: any) {
      error("Delete failed", err.message);
    }
  };

  const toggleSuspend = async (u: any) => {
    try {
      await api(`/users/${u.id}`, {
        method: "PATCH",
        body: { status: u.status === "active" ? "suspended" : "active" },
      });
      success(u.status === "active" ? "User suspended" : "User reactivated");
      reload();
    } catch (err: any) {
      error("Action failed", err.message);
    }
  };

  const sendNotification = async () => {
    if (!notifyForm.title || !notifyForm.message) return error("Title and message are required");
    try {
      await api(`/users/${notifyTarget.id}/notify`, { method: "POST", body: notifyForm });
      success("Notification sent", `Delivered to ${notifyTarget.username}`);
      setNotifyTarget(null);
      setNotifyForm({ title: "", message: "", type: "info" });
    } catch (err: any) {
      error("Send failed", err.message);
    }
  };

  if (loading) return <PageSkeleton />;

  const stats = {
    total: users.length,
    admins: users.filter((u) => u.role === "admin" || u.role === "owner").length,
    suspended: users.filter((u) => u.status === "suspended").length,
    revenue: users.reduce((a, u) => a + (u.balance || 0), 0),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users size={20} />}
        title="User Management"
        subtitle="Create, edit, suspend and communicate with accounts on this panel."
        actions={
          <Button variant="primary" icon={<UserPlus size={14} />} onClick={openCreate}>
            Add user
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total accounts" value={stats.total} icon={<Users size={16} />} accent />
        <StatCard label="Staff accounts" value={stats.admins} icon={<ShieldCheck size={16} />} hint="Admins & owners" />
        <StatCard label="Suspended" value={stats.suspended} icon={<Ban size={16} />} />
        <StatCard label="Total client balance" value={formatMoney(stats.revenue)} icon={<Coins size={16} />} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, username or email…" className="min-w-[220px] flex-1" />
          <select className="zk-select w-auto min-w-[130px]" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<Users size={22} />} title="No users found" message="Try a different search or invite your first client." action={<Button variant="primary" icon={<UserPlus size={14} />} onClick={openCreate}>Add user</Button>} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="zk-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Servers</th>
                  <th>Balance</th>
                  <th>Last login</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-[0.62rem] font-bold text-black/80">
                          {u.avatar ? <img src={u.avatar} alt="" className="h-full w-full object-cover" /> : initials(u.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium text-zinc-100">
                            {u.name}
                            {u.id === me?.id && <span className="text-[0.6rem] text-brand-400">(you)</span>}
                          </p>
                          <p className="truncate text-[0.66rem] text-zinc-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={u.role === "owner" ? "brand" : u.role === "admin" ? "info" : "offline"}>
                        {u.role}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={u.status === "active" ? "online" : "danger"} dot>
                        {u.status}
                      </Badge>
                    </td>
                    <td>
                      <span className="flex items-center gap-1 text-[0.74rem] text-zinc-400">
                        <Server size={11} /> {u.serverCount ?? 0}
                      </span>
                    </td>
                    <td className="font-mono text-[0.72rem]">{formatMoney(u.balance || 0)}</td>
                    <td className="text-[0.7rem] text-zinc-500">
                      {u.lastLogin ? relativeTime(u.lastLogin) : "never"}
                      <p className="text-[0.62rem] text-zinc-600">joined {formatDate(u.createdAt)}</p>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setNotifyTarget(u)}
                          title="Send notification"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-sky-500/15 hover:text-sky-300"
                        >
                          <Send size={12} />
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-brand-500/15 hover:text-brand-300"
                        >
                          <Pencil size={12} />
                        </button>
                        {u.id !== me?.id && (
                          <>
                            <button
                              onClick={() => toggleSuspend(u)}
                              title={u.status === "active" ? "Suspend" : "Reactivate"}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-amber-500/15 hover:text-amber-300"
                            >
                              {u.status === "active" ? <ShieldOff size={12} /> : <CheckCircle2 size={12} />}
                            </button>
                            {(isOwner || u.role !== "owner") && (
                              <button
                                onClick={() => remove(u)}
                                title="Delete"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-3">
          <Pagination page={page} pages={pages} total={filtered.length} onChange={setPage} />
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.username}` : "Create a new user"}
        subtitle={editing ? "Update account details, role and status" : "The account can sign in immediately"}
        icon={<UserPlus size={16} />}
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {editing ? "Save changes" : "Create user"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <input className="zk-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Username" required>
            <input className="zk-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          </Field>
          <Field label="Email address" required>
            <input className="zk-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field
            label={editing ? "New password (optional)" : "Password"}
            required={!editing}
            hint={editing ? "Leave blank to keep the current password" : "Minimum 8 characters with letters and numbers"}
          >
            <div className="relative">
              <input
                className="zk-input pr-9"
                type="text"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editing ? "••••••••" : ""}
              />
              <KeyRound size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            </div>
          </Field>
          <Field label="Role">
            <select className="zk-select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="user">User</option>
              <option value="admin">Administrator</option>
              {isOwner && <option value="owner">Owner</option>}
            </select>
          </Field>
          <Field label="Status">
            <select className="zk-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
          <Field label="Account balance" hint="Shown to the client in billing areas">
            <input type="number" className="zk-input" value={form.balance} onChange={(e) => setForm((f) => ({ ...f, balance: Number(e.target.value) }))} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(notifyTarget)}
        onClose={() => setNotifyTarget(null)}
        title={`Notify ${notifyTarget?.username || ""}`}
        subtitle="Sends an in-panel notification instantly"
        icon={<Mail size={16} />}
        footer={
          <>
            <Button onClick={() => setNotifyTarget(null)}>Cancel</Button>
            <Button variant="primary" icon={<Send size={13} />} onClick={sendNotification}>
              Send notification
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" required>
            <input className="zk-input" value={notifyForm.title} onChange={(e) => setNotifyForm((f) => ({ ...f, title: e.target.value }))} placeholder="Scheduled maintenance" />
          </Field>
          <Field label="Message" required>
            <textarea className="zk-textarea min-h-[110px]" value={notifyForm.message} onChange={(e) => setNotifyForm((f) => ({ ...f, message: e.target.value }))} placeholder="We'll be performing node maintenance tonight at 02:00 UTC." />
          </Field>
          <Field label="Type">
            <select className="zk-select" value={notifyForm.type} onChange={(e) => setNotifyForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  );
};

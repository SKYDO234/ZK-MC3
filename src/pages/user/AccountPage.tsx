import React, { useEffect, useState } from "react";
import {
  UserCog,
  Shield,
  Monitor,
  Bell,
  KeyRound,
  LogOut,
  Camera,
  Trash2,
  Save,
  Check,
  Laptop,
  Smartphone,
  Globe,
  Moon,
  Sun,
  Palette,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, Button, Badge, Field, Tabs, Switch, PageSkeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useSettings } from "../../context/SettingsContext";
import { api } from "../../lib/api";
import { formatDateTime, initials, relativeTime } from "../../lib/format";

export const AccountPage: React.FC = () => {
  useDocumentTitle("Account · ZK-MC3-PANEL");
  const { user, refresh, updateUser, adoptToken } = useAuth();
  const { success, error, confirm } = useToast();
  const { settings } = useSettings();
  const minPasswordLength = settings?.passwordMinLength || 5;
  const [tab, setTab] = useState("profile");

  const [profile, setProfile] = useState({ name: "", email: "", avatar: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [prefs, setPrefs] = useState({
    emailNotifications: true,
    crashAlerts: true,
    productUpdates: false,
    loginAlerts: true,
  });
  const [saving, setSaving] = useState("");
  const { data: sessions, reload: reloadSessions } = useApi<any[]>("/auth/sessions");

  useEffect(() => {
    if (user) {
      setProfile({ name: user.name, email: user.email, avatar: user.avatar || "" });
      setPrefs({
        emailNotifications: user.preferences?.emailNotifications ?? true,
        crashAlerts: user.preferences?.crashAlerts ?? true,
        productUpdates: user.preferences?.productUpdates ?? false,
        loginAlerts: user.preferences?.loginAlerts ?? true,
      });
    }
  }, [user]);

  if (!user) return <PageSkeleton />;

  const saveProfile = async () => {
    setSaving("profile");
    try {
      await api("/auth/profile", { method: "PATCH", body: profile });
      await refresh();
      success("Profile updated");
    } catch (err: any) {
      error("Update failed", err.message);
    } finally {
      setSaving("");
    }
  };

  const updatePassword = async () => {
    if (!passwords.currentPassword) return error("Current password required", "Enter the password you are signed in with.");
    if (passwords.newPassword !== passwords.confirm) return error("Passwords do not match");
    if (passwords.newPassword.length < minPasswordLength)
      return error("Password too short", `Use at least ${minPasswordLength} characters.`);
    setSaving("password");
    try {
      const result = await api<{ token: string }>("/auth/password", {
        method: "PATCH",
        body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword },
      });
      // Changing the password invalidates the old token, so keep the new one and
      // refresh the session state — otherwise the next request signs us out.
      await adoptToken(result.token);
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      success("Password updated", "All other devices were signed out.");
    } catch (err: any) {
      error("Password change failed", err.message);
    } finally {
      setSaving("");
    }
  };

  const savePrefs = async () => {
    setSaving("prefs");
    try {
      const updated = await api<any>("/auth/preferences", { method: "PATCH", body: prefs });
      updateUser({ preferences: updated.preferences });
      success("Preferences saved");
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving("");
    }
  };

  const sessionsList = sessions || [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<UserCog size={20} />}
        title="Account Settings"
        subtitle="Manage your profile, password, active sessions and notification preferences."
      />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-black/80">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(user.name)
                )}
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-[#121216] text-brand-400">
                <Camera size={12} />
              </span>
            </div>
            <p className="mt-3 text-[0.92rem] font-semibold text-zinc-100">{user.name}</p>
            <p className="text-[0.72rem] text-zinc-500">@{user.username}</p>
            <div className="mt-2">
              <Badge tone={user.role === "owner" ? "brand" : user.role === "admin" ? "info" : "offline"}>
                {user.role.toUpperCase()}
              </Badge>
            </div>
          </div>

          <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4 text-[0.72rem]">
            {[
              ["Email", user.email],
              ["Joined", formatDateTime(user.createdAt)],
              ["Last login", user.lastLogin ? relativeTime(user.lastLogin) : "—"],
              ["Last IP", user.lastIp || "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-zinc-500">{label}</span>
                <span className="truncate text-zinc-300">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3">
            <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-amber-200">
              <Shield size={12} /> Security tip
            </p>
            <p className="mt-1 text-[0.66rem] leading-relaxed text-amber-200/70">
              Use a unique password and review your active sessions regularly.
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          <Tabs
            tabs={[
              { id: "profile", label: "Profile", icon: <UserCog size={13} /> },
              { id: "security", label: "Password & Security", icon: <Shield size={13} /> },
              { id: "sessions", label: "Login Sessions", icon: <Monitor size={13} />, badge: sessionsList.length },
              { id: "preferences", label: "Preferences", icon: <Bell size={13} /> },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "profile" && (
            <Card>
              <CardHeader title="Profile information" subtitle="This is how you appear across the panel" icon={<UserCog size={16} />} />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required>
                  <input className="zk-input" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
                </Field>
                <Field label="Username" hint="Contact an administrator to change your username">
                  <input className="zk-input opacity-60" value={user.username} disabled />
                </Field>
                <Field label="Email address" required>
                  <input className="zk-input" type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
                </Field>
                <Field label="Avatar URL" hint="Paste a link to an image (optional)">
                  <input className="zk-input" value={profile.avatar} onChange={(e) => setProfile((p) => ({ ...p, avatar: e.target.value }))} placeholder="https://…" />
                </Field>
              </div>
              <div className="mt-5 flex justify-end">
                <Button variant="primary" icon={<Save size={14} />} loading={saving === "profile"} onClick={saveProfile}>
                  Save profile
                </Button>
              </div>
            </Card>
          )}

          {tab === "security" && (
            <Card>
              <CardHeader title="Change password" subtitle="Passwords are hashed with bcrypt (10 rounds)" icon={<KeyRound size={16} />} />
              <div className="mt-5 space-y-4 max-w-md">
                <Field label="Current password" required>
                  <input
                    className="zk-input"
                    type="password"
                    value={passwords.currentPassword}
                    onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
                  />
                </Field>
                <Field label="New password" required hint={`At least ${minPasswordLength} characters; longer passwords also need a letter and a number`}>
                  <input
                    className="zk-input"
                    type="password"
                    value={passwords.newPassword}
                    onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
                  />
                </Field>
                <Field label="Confirm new password" required>
                  <input
                    className="zk-input"
                    type="password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                  />
                </Field>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <Shield size={15} className="text-brand-400" />
                  <p className="text-[0.7rem] text-zinc-400">
                    Changing your password signs out every other device automatically.
                  </p>
                </div>
                <Button variant="primary" icon={<Save size={14} />} loading={saving === "password"} onClick={updatePassword}>
                  Update password
                </Button>
              </div>

              <div className="mt-6 border-t border-white/[0.06] pt-5">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[0.82rem] font-medium text-zinc-200">Two-factor authentication</p>
                    <p className="text-[0.68rem] text-zinc-500">
                      {user.twoFactor ? "Enabled on this account" : "Add an extra layer of security to your account (admin-enabled)."}
                    </p>
                  </div>
                  <Badge tone={user.twoFactor ? "online" : "offline"} dot>
                    {user.twoFactor ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            </Card>
          )}

          {tab === "sessions" && (
            <Card padded={false}>
              <div className="p-5 pb-0">
                <CardHeader
                  title="Active sessions"
                  subtitle="Devices currently signed into your account"
                  icon={<Monitor size={16} />}
                  action={
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<LogOut size={12} />}
                      onClick={async () => {
                        const ok = await confirm({ title: "Sign out of all sessions?", message: "You will need to sign in again on every device.", danger: true, confirmLabel: "Sign out all" });
                        if (!ok) return;
                        await api("/auth/sessions", { method: "DELETE" });
                        reloadSessions();
                        success("Signed out of all sessions");
                      }}
                    >
                      Sign out all
                    </Button>
                  }
                />
              </div>
              <div className="mt-3 divide-y divide-white/[0.05]">
                {sessionsList.length === 0 && (
                  <p className="px-5 py-8 text-center text-xs text-zinc-500">No sessions recorded.</p>
                )}
                {sessionsList.map((session) => {
                  const isMobile = /mobile|android|iphone/i.test(session.userAgent || "");
                  return (
                    <div key={session.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-brand-400">
                        {isMobile ? <Smartphone size={15} /> : <Laptop size={15} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8rem] font-medium text-zinc-200">
                          {session.userAgent?.slice(0, 70) || "Unknown device"}
                        </p>
                        <p className="flex items-center gap-2 text-[0.66rem] text-zinc-500">
                          <Globe size={10} /> {session.ip}
                          <span>·</span>
                          {relativeTime(session.lastSeen)}
                        </p>
                      </div>
                      {session.current ? (
                        <Badge tone="online" dot>Current</Badge>
                      ) : (
                        <button
                          onClick={async () => {
                            await api(`/auth/sessions/${session.id}`, { method: "DELETE" });
                            reloadSessions();
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/15 hover:text-red-300"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {tab === "preferences" && (
            <Card>
              <CardHeader title="Notification preferences" subtitle="Choose what you want to hear about" icon={<Bell size={16} />} />
              <div className="mt-5 space-y-2.5">
                {[
                  { key: "emailNotifications", label: "Account emails", desc: "Billing, security and account updates." },
                  { key: "crashAlerts", label: "Server crash alerts", desc: "Get notified when a server process exits unexpectedly." },
                  { key: "loginAlerts", label: "New login alerts", desc: "Alert me when my account is accessed from a new device." },
                  { key: "productUpdates", label: "Product updates", desc: "Occasional news about new ZK-MC3-PANEL features." },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
                  >
                    <div>
                      <p className="text-[0.82rem] font-medium text-zinc-200">{item.label}</p>
                      <p className="text-[0.68rem] text-zinc-500">{item.desc}</p>
                    </div>
                    <Switch
                      checked={(prefs as any)[item.key]}
                      onChange={(v) => setPrefs((p) => ({ ...p, [item.key]: v }))}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="flex items-center gap-2 text-[0.8rem] font-medium text-zinc-200">
                  <Palette size={14} className="text-brand-400" /> Appearance
                </p>
                <div className="mt-2 flex gap-2">
                  <span className="flex items-center gap-1.5 rounded-lg border border-brand-500/35 bg-brand-500/10 px-3 py-1.5 text-[0.72rem] text-brand-200">
                    <Moon size={12} /> Dark (ZK-MC3)
                  </span>
                  <span className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-3 py-1.5 text-[0.72rem] text-zinc-500 opacity-60">
                    <Sun size={12} /> Light (coming soon)
                  </span>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <Button variant="primary" icon={<Check size={14} />} loading={saving === "prefs"} onClick={savePrefs}>
                  Save preferences
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

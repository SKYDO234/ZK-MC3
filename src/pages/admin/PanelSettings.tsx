import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Settings2,
  Palette,
  Shield,
  Mail,
  KeyRound,
  Bell,
  SlidersHorizontal,
  CreditCard,
  Server,
  Save,
  Upload,
  Building2,
  Globe,
  Image as ImageIcon,
  Check,
  AlertTriangle,
  Database,
  Megaphone,
  Wrench,
  Puzzle,
  ExternalLink,
  Info,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, Button, Field, Tabs, Switch, Badge, PageSkeleton, Modal } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { useSettings } from "../../context/SettingsContext";
import { api, uploadFile } from "../../lib/api";

const TABS = [
  { id: "branding", label: "Branding", icon: <Palette size={13} /> },
  { id: "auth", label: "Authentication", icon: <Shield size={13} /> },
  { id: "email", label: "Email / SMTP", icon: <Mail size={13} /> },
  { id: "api", label: "API", icon: <KeyRound size={13} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={13} /> },
  { id: "features", label: "Features", icon: <Puzzle size={13} /> },
  { id: "limits", label: "Resource Limits", icon: <SlidersHorizontal size={13} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={13} /> },
  { id: "system", label: "System", icon: <Server size={13} /> },
];

export const PanelSettings: React.FC = () => {
  useDocumentTitle("Panel Settings · ZK-MC3-PANEL");
  const { data, loading, reload } = useApi<any>("/admin/settings");
  const { success, error } = useToast();
  const { refresh: refreshPublic } = useSettings();
  // Honour ?tab=… so links from elsewhere in the panel land on the right section
  // instead of dumping the operator at the top of Branding.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState(
    requestedTab && TABS.some((t) => t.id === requestedTab) ? requestedTab : "branding"
  );
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  // The persisted value, so the Features tab can distinguish saved from unsaved.
  const [savedPlayit, setSavedPlayit] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcast, setBroadcast] = useState({ title: "", message: "", type: "info", audience: "all" });
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) setForm(data);
    if (data) setSavedPlayit(Boolean(data.enablePlayit));
  }, [data]);

  const set = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));

  const save = async (patch?: Record<string, any>) => {
    setSaving(true);
    try {
      const payload = patch || form;
      const updated = await api("/admin/settings", { method: "PUT", body: payload });
      setForm(updated);
      setSavedPlayit(Boolean(updated.enablePlayit));
      await refreshPublic();
      success("Settings saved", "Changes are live across the panel.");
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file?: File | null) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const result = await uploadFile("/admin/settings/logo", file);
      set("logoUrl", (result as any).logoUrl);
      set("faviconUrl", (result as any).logoUrl);
      await refreshPublic();
      success("Logo updated");
    } catch (err: any) {
      error("Upload failed", err.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const sendBroadcast = async () => {
    if (!broadcast.title || !broadcast.message) return error("Title and message are required");
    try {
      await api("/admin/notify", { method: "POST", body: broadcast });
      success("Announcement sent");
      setBroadcastOpen(false);
      setBroadcast({ title: "", message: "", type: "info", audience: "all" });
    } catch (err: any) {
      error("Send failed", err.message);
    }
  };

  if (loading || !form.panelName) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Settings2 size={20} />}
        title="Panel Settings"
        subtitle="Configure branding, security, integrations and platform-wide limits."
        actions={
          <>
            <Link to="/admin/themes" className="zk-btn zk-btn-ghost zk-btn-sm">
              <Palette size={13} /> Themes &amp; Fonts
            </Link>
            <Button size="sm" icon={<Megaphone size={13} />} onClick={() => setBroadcastOpen(true)}>
              Broadcast
            </Button>
            <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving} onClick={() => save()}>
              Save changes
            </Button>
          </>
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="zk-fade-up" key={tab}>
        {tab === "branding" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="space-y-5">
              <Card>
                <CardHeader title="Identity" subtitle="Panel name and company attribution" icon={<Building2 size={16} />} />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label="Panel name" required>
                    <input className="zk-input" value={form.panelName} onChange={(e) => set("panelName", e.target.value)} />
                  </Field>
                  <Field label="Tagline">
                    <input className="zk-input" value={form.panelTagline} onChange={(e) => set("panelTagline", e.target.value)} />
                  </Field>
                  <Field label="Company / studio">
                    <input className="zk-input" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
                  </Field>
                  <Field label="CEO">
                    <input className="zk-input" value={form.ceoName} onChange={(e) => set("ceoName", e.target.value)} />
                  </Field>
                  <Field label="Website" className="sm:col-span-2">
                    <input className="zk-input" value={form.companyUrl} onChange={(e) => set("companyUrl", e.target.value)} />
                  </Field>
                </div>
              </Card>

              <Card>
                <CardHeader title="Brand colours" subtitle="Applied instantly across the interface" icon={<Palette size={16} />} />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label="Primary accent">
                    <div className="flex gap-2">
                      <input
                        type="color"
                        className="h-[38px] w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                        value={form.primaryColor}
                        onChange={(e) => set("primaryColor", e.target.value)}
                      />
                      <input className="zk-input font-mono" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
                    </div>
                  </Field>
                  <Field label="Secondary accent">
                    <div className="flex gap-2">
                      <input
                        type="color"
                        className="h-[38px] w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                        value={form.accentColor}
                        onChange={(e) => set("accentColor", e.target.value)}
                      />
                      <input className="zk-input font-mono" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
                    </div>
                  </Field>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["#ff7a18", "#f97316", "#ef4444", "#eab308", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899"].map((color) => (
                    <button
                      key={color}
                      onClick={() => set("primaryColor", color)}
                      className={`h-8 w-8 rounded-lg border-2 transition ${
                        form.primaryColor === color ? "border-white" : "border-transparent"
                      }`}
                      style={{ background: color }}
                      title={color}
                    />
                  ))}
                </div>
              </Card>
            </div>

            <div className="space-y-5">
              <Card>
                <CardHeader title="Logo & favicon" subtitle="PNG, JPG, SVG or WEBP up to 8 MB" icon={<ImageIcon size={16} />} />
                <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-white/10 bg-black/25 p-5">
                  <img src={form.logoUrl || "/logo.png"} alt="logo" className="h-24 w-24 rounded-xl border border-brand-500/30 object-cover" />
                  <p className="mt-3 text-[0.68rem] text-zinc-500">Current panel logo</p>
                  <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
                  <Button size="sm" className="mt-3" icon={<Upload size={12} />} loading={uploadingLogo} onClick={() => logoInput.current?.click()}>
                    Upload new logo
                  </Button>
                </div>
                <Field label="Or paste an image URL" className="mt-4">
                  <input className="zk-input" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
                </Field>
                
              </Card>

              <Card>
                <CardHeader title="Live preview" subtitle="Sidebar mark" icon={<Globe size={16} />} />
                <div className="mt-4 rounded-xl border border-white/[0.07] zk-surface p-4">
                  <div className="flex items-center gap-2.5">
                    <img src={form.logoUrl || "/logo.png"} alt="" className="h-9 w-9 rounded-lg border border-brand-500/30 object-cover" />
                    <div>
                      <p className="font-display text-[0.82rem] font-bold text-zinc-100">{form.panelName}</p>
                      <p className="text-[0.58rem] uppercase tracking-[0.16em] text-brand-400/80">by {form.companyName}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-brand-500/25 px-3 py-2" style={{ background: `${form.primaryColor}18` }}>
                    <p className="text-[0.7rem] font-medium" style={{ color: form.primaryColor }}>
                      Dashboard
                    </p>
                  </div>
                  <button
                    className="mt-2 w-full rounded-lg py-1.5 text-[0.7rem] font-semibold text-black/85"
                    style={{ background: `linear-gradient(135deg, ${form.accentColor}, ${form.primaryColor})` }}
                  >
                    Primary action
                  </button>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === "auth" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Registration & sessions" subtitle="Control who can create an account" icon={<Shield size={16} />} />
              <div className="mt-5 space-y-2.5">
                {[
                  { key: "enableRegistration", label: "Allow public registration", desc: "Show the sign-up form on the login screen." },
                  { key: "requireEmailVerification", label: "Require email verification", desc: "Block sign-in until an email is confirmed." },
                  { key: "enableTwoFactor", label: "Offer two-factor authentication", desc: "Adds an optional TOTP layer for accounts." },
                  { key: "allowRememberMe", label: "Allow 'remember me'", desc: "Extend session lifetimes to 30 days." },
                  { key: "loginAlert", label: "Login alerts", desc: "Notify users about sign-ins from new devices." },
                  {
                    key: "requireInitialPasswordChange",
                    label: "Require initial password change",
                    desc: "Block the panel until the seeded admin/admin credential is replaced. Off by default so you can sign in and rotate it whenever you like.",
                  },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                    <div>
                      <p className="text-[0.82rem] font-medium text-zinc-200">{item.label}</p>
                      <p className="text-[0.68rem] text-zinc-500">{item.desc}</p>
                    </div>
                    <Switch checked={Boolean(form[item.key])} onChange={(v) => set(item.key, v)} />
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Security policy" subtitle="Password and session hardening" icon={<KeyRound size={16} />} />
              <div className="mt-5 space-y-4">
                <Field label="Minimum password length" hint="Applies to new registrations and password resets">
                  <input
                    type="number"
                    min={4}
                    max={32}
                    className="zk-input"
                    value={form.passwordMinLength}
                    onChange={(e) => set("passwordMinLength", Number(e.target.value))}
                  />
                </Field>
                <Field label="Session lifetime (hours)" hint="Users must sign in again after this period">
                  <input
                    type="number"
                    min={1}
                    max={720}
                    className="zk-input"
                    value={form.sessionTimeoutHours}
                    onChange={(e) => set("sessionTimeoutHours", Number(e.target.value))}
                  />
                </Field>
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[0.82rem] font-medium text-zinc-200">Force HTTPS</p>
                    <p className="text-[0.68rem] text-zinc-500">Redirect all plain HTTP traffic</p>
                  </div>
                  <Switch checked={form.forceHttps} onChange={(v) => set("forceHttps", v)} />
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-amber-200">
                    <AlertTriangle size={12} /> Security reminder
                  </p>
                  <p className="mt-1 text-[0.68rem] leading-relaxed text-amber-200/70">
                    Keep JWT_SECRET private and unique. Rotate API keys regularly and review the audit log.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === "email" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <Card>
              <CardHeader title="SMTP configuration" subtitle="Transactional email for notifications and recovery" icon={<Mail size={16} />} />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="SMTP host" className="sm:col-span-2">
                  <input className="zk-input" value={form.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.mailgun.org" />
                </Field>
                <Field label="Port">
                  <input type="number" className="zk-input" value={form.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))} />
                </Field>
                <Field label="Encryption">
                  <select className="zk-select" value={form.smtpSecure ? "ssl" : "tls"} onChange={(e) => set("smtpSecure", e.target.value === "ssl")}>
                    <option value="tls">STARTTLS (587)</option>
                    <option value="ssl">SSL / TLS (465)</option>
                  </select>
                </Field>
                <Field label="Username">
                  <input className="zk-input" value={form.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Password">
                  <input className="zk-input" type="password" value={form.smtpPass} onChange={(e) => set("smtpPass", e.target.value)} autoComplete="new-password" />
                </Field>
                <Field label="From address" className="sm:col-span-2">
                  <input className="zk-input" value={form.smtpFrom} onChange={(e) => set("smtpFrom", e.target.value)} />
                </Field>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div>
                  <p className="text-[0.82rem] font-medium text-zinc-200">Enable outgoing email</p>
                  <p className="text-[0.68rem] text-zinc-500">Sends account and alert emails through SMTP</p>
                </div>
                <Switch checked={form.smtpEnabled} onChange={(v) => set("smtpEnabled", v)} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Delivery checklist" icon={<Check size={16} />} />
              <ul className="mt-4 space-y-2 text-[0.72rem] text-zinc-400">
                {[
                  "Use a dedicated sending domain with SPF + DKIM.",
                  "443/587 must be reachable from the node.",
                  "Test with a real mailbox before going live.",
                  "Keep credentials out of version control.",
                ].map((tip) => (
                  <li key={tip} className="flex items-start gap-2">
                    <Check size={12} className="mt-0.5 flex-none text-emerald-400" /> {tip}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {tab === "api" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="API access" subtitle="Control external programmatic access" icon={<KeyRound size={16} />} />
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[0.82rem] font-medium text-zinc-200">Enable REST API</p>
                    <p className="text-[0.68rem] text-zinc-500">Allow API key authentication for /api routes</p>
                  </div>
                  <Switch checked={form.apiEnabled} onChange={(v) => set("apiEnabled", v)} />
                </div>
                <Field label="Rate limit (requests / minute / key)">
                  <input type="number" className="zk-input" value={form.apiRateLimit} onChange={(e) => set("apiRateLimit", Number(e.target.value))} />
                </Field>
                <Field label="Maximum keys per user">
                  <input type="number" className="zk-input" value={form.apiKeyMaxPerUser} onChange={(e) => set("apiKeyMaxPerUser", Number(e.target.value))} />
                </Field>
                <Field label="Default key expiry (days, 0 = never)">
                  <input type="number" className="zk-input" value={form.apiKeyDefaultExpiryDays} onChange={(e) => set("apiKeyDefaultExpiryDays", Number(e.target.value))} />
                </Field>
              </div>
            </Card>
            <Card>
              <CardHeader title="Endpoint reference" subtitle="Authenticate with a Bearer token" icon={<Database size={16} />} />
              <pre className="zk-console mt-4 overflow-x-auto text-[0.7rem]">
{`GET    /api/servers              List servers
POST   /api/servers              Create a server
GET    /api/servers/:id/stats    Live resource usage
POST   /api/servers/:id/start    Start instance
POST   /api/servers/:id/stop     Stop instance
GET    /api/servers/:id/backups  List backups
GET    /api/nodes                Node inventory
GET    /api/admin/dashboard      Admin metrics`}
              </pre>
            </Card>
          </div>
        )}

        {tab === "notifications" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Panel notifications" subtitle="Which platform events trigger alerts" icon={<Bell size={16} />} />
              <div className="mt-5 space-y-2.5">
                {[
                  { key: "notifyOnCrash", label: "Server crashes", desc: "When a process exits unexpectedly." },
                  { key: "notifyOnLogin", label: "New sign-ins", desc: "Security logins from new devices." },
                  { key: "notifyOnBackup", label: "Backup events", desc: "Completed or failed backup jobs." },
                  { key: "notifyOnLowResources", label: "Low resources", desc: "Disk or memory above 85%." },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                    <div>
                      <p className="text-[0.82rem] font-medium text-zinc-200">{item.label}</p>
                      <p className="text-[0.68rem] text-zinc-500">{item.desc}</p>
                    </div>
                    <Switch checked={Boolean(form[item.key])} onChange={(v) => set(item.key, v)} />
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Announcements" subtitle="Send a message to every user instantly" icon={<Megaphone size={16} />} />
              <div className="mt-4 space-y-3">
                <Field label="Title">
                  <input className="zk-input" value={broadcast.title} onChange={(e) => setBroadcast((b) => ({ ...b, title: e.target.value }))} placeholder="Scheduled maintenance" />
                </Field>
                <Field label="Message">
                  <textarea
                    className="zk-textarea min-h-[110px]"
                    value={broadcast.message}
                    onChange={(e) => setBroadcast((b) => ({ ...b, message: e.target.value }))}
                    placeholder="Nodes EU-1 and ASIA-1 will be rebooted tonight at 02:00 UTC."
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Audience">
                    <select className="zk-select" value={broadcast.audience} onChange={(e) => setBroadcast((b) => ({ ...b, audience: e.target.value }))}>
                      <option value="all">All users</option>
                      <option value="admins">Admins only</option>
                    </select>
                  </Field>
                  <Field label="Type">
                    <select className="zk-select" value={broadcast.type} onChange={(e) => setBroadcast((b) => ({ ...b, type: e.target.value }))}>
                      <option value="info">Info</option>
                      <option value="success">Success</option>
                      <option value="warning">Warning</option>
                      <option value="error">Error</option>
                    </select>
                  </Field>
                </div>
                <Button variant="primary" icon={<Megaphone size={13} />} onClick={sendBroadcast} className="w-full">
                  Send announcement
                </Button>
              </div>
            </Card>
          </div>
        )}

        {tab === "features" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Playit.gg tunnels"
                subtitle="Expose a server's port to the internet without port-forwarding"
                icon={<Puzzle size={16} />}
              />
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[0.82rem] font-medium text-zinc-200">Enable tunnels</p>
                    <p className="text-[0.68rem] text-zinc-500">
                      Adds a Tunnel tab to every server, with start / stop / restart and a claim link.
                    </p>
                  </div>
                  <Switch checked={Boolean(form.enablePlayit)} onChange={(v) => set("enablePlayit", v)} />
                </div>

                {/* State of the switch you have actually saved — not the unsaved form. */}
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/25 px-4 py-2.5">
                  <span
                    className={`h-1.5 w-1.5 flex-none rounded-full ${savedPlayit ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <p className="text-[0.7rem] text-zinc-400">
                    Currently <span className={savedPlayit ? "text-emerald-300" : "text-zinc-300"}>
                      {savedPlayit ? "enabled" : "disabled"}
                    </span>{" "}
                    for the whole panel.
                  </p>
                  {!savedPlayit && Boolean(form.enablePlayit) && (
                    <span className="ml-auto rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-300">
                      unsaved
                    </span>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="How the Tunnel tab works" subtitle="Applies to every server once enabled" icon={<Globe size={16} />} />
              <ol className="mt-4 space-y-2.5 text-[0.72rem] leading-relaxed text-zinc-400">
                <li className="flex gap-2">
                  <span className="font-mono text-brand-400">1.</span>
                  <span>
                    Open a server → <span className="text-zinc-200">Tunnel</span> tab. The tab only appears while
                    tunnels are enabled above.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-brand-400">2.</span>
                  <span>
                    Press <span className="text-zinc-200">Start tunnel</span>. The panel downloads the official
                    playit agent on the node and runs it beside the server.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-brand-400">3.</span>
                  <span>
                    Open the <span className="text-zinc-200">claim link</span> once to bind the agent to your
                    playit.gg account. After that the address survives restarts.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-brand-400">4.</span>
                  <span>Clients connect to the public address shown on that page — no port-forwarding.</span>
                </li>
              </ol>
              <div className="mt-4 flex items-start gap-1.5 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5">
                <Info size={11} className="mt-0.5 flex-none text-zinc-500" />
                <p className="text-[0.66rem] leading-relaxed text-zinc-500">
                  Tunnels need a running node with outbound internet access. If a start fails, the Tunnel tab shows
                  the agent's own error output rather than a generic message.
                </p>
              </div>
              <a
                href="https://playit.gg"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[0.68rem] text-brand-400 hover:text-brand-300"
              >
                playit.gg <ExternalLink size={10} />
              </a>
            </Card>
          </div>
        )}

        {tab === "limits" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Per-user limits" subtitle="Enforced when servers are created" icon={<SlidersHorizontal size={16} />} />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Max servers per user">
                  <input type="number" className="zk-input" value={form.maxServersPerUser} onChange={(e) => set("maxServersPerUser", Number(e.target.value))} />
                </Field>
                <Field label="Max RAM per server (MB)">
                  <input type="number" className="zk-input" value={form.maxRamPerServer} onChange={(e) => set("maxRamPerServer", Number(e.target.value))} />
                </Field>
                <Field label="Max CPU cores per server">
                  <input type="number" className="zk-input" value={form.maxCpuPerServer} onChange={(e) => set("maxCpuPerServer", Number(e.target.value))} />
                </Field>
                <Field label="Max disk per server (MB)">
                  <input type="number" className="zk-input" value={form.maxDiskPerServer} onChange={(e) => set("maxDiskPerServer", Number(e.target.value))} />
                </Field>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div>
                  <p className="text-[0.82rem] font-medium text-zinc-200">Self-service server creation</p>
                  <p className="text-[0.68rem] text-zinc-500">Let clients deploy servers within limits</p>
                </div>
                <Switch checked={form.allowUserServerCreation} onChange={(v) => set("allowUserServerCreation", v)} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Defaults" subtitle="Applied to newly created instances" icon={<Server size={16} />} />
              <div className="mt-5 space-y-4">
                <Field label="Default runtime">
                  <select className="zk-select" value={form.defaultRuntime} onChange={(e) => set("defaultRuntime", e.target.value)}>
                    <option value="local">Local process (this machine)</option>
                    <option value="daemon">Remote node (zkdaemon)</option>
                  </select>
                </Field>
                <Field label="Default software">
                  <select className="zk-select" value={form.defaultSoftware} onChange={(e) => set("defaultSoftware", e.target.value)}>
                    {["PAPER", "PURPUR", "VANILLA", "FABRIC", "VELOCITY", "NODEJS", "PYTHON"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Default version">
                  <input className="zk-input font-mono" value={form.defaultVersion} onChange={(e) => set("defaultVersion", e.target.value)} />
                </Field>
                <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
                  <p className="text-[0.66rem] uppercase tracking-wider text-zinc-600">Effective footprint</p>
                  <p className="mt-1 text-[0.74rem] text-zinc-400">
                    Each user may run up to <span className="font-semibold text-brand-300">{form.maxServersPerUser}</span> servers,
                    totalling up to{" "}
                    <span className="font-semibold text-brand-300">
                      {(form.maxServersPerUser * form.maxRamPerServer / 1024).toFixed(0)} GB
                    </span>{" "}
                    of RAM.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === "billing" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Billing engine" subtitle="Cost model used for revenue reporting" icon={<CreditCard size={16} />} />
              <div className="mt-5 space-y-2.5">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[0.82rem] font-medium text-zinc-200">Enable billing</p>
                    <p className="text-[0.68rem] text-zinc-500">Show pricing and balance information</p>
                  </div>
                  <Switch checked={form.billingEnabled} onChange={(v) => set("billingEnabled", v)} />
                </div>
                <Field label="Currency">
                  <select className="zk-select" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    {["USD", "EUR", "GBP", "INR", "BDT", "SGD", "AUD"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Per GB RAM">
                    <input type="number" step="0.1" className="zk-input" value={form.pricePerGbRam} onChange={(e) => set("pricePerGbRam", Number(e.target.value))} />
                  </Field>
                  <Field label="Per CPU core">
                    <input type="number" step="0.1" className="zk-input" value={form.pricePerCpuCore} onChange={(e) => set("pricePerCpuCore", Number(e.target.value))} />
                  </Field>
                  <Field label="Per GB disk">
                    <input type="number" step="0.1" className="zk-input" value={form.pricePerGbDisk} onChange={(e) => set("pricePerGbDisk", Number(e.target.value))} />
                  </Field>
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Pricing example" subtitle="4 GB RAM · 4 cores · 20 GB disk" icon={<CreditCard size={16} />} />
              <div className="mt-5 space-y-2">
                {[
                  ["Memory", `4 GB × ${form.pricePerGbRam}`, 4 * form.pricePerGbRam],
                  ["CPU", `4 cores × ${form.pricePerCpuCore}`, 4 * form.pricePerCpuCore],
                  ["Disk", `20 GB × ${form.pricePerGbDisk}`, 20 * form.pricePerGbDisk],
                ].map(([label, calc, value]) => (
                  <div key={label as string} className="flex items-center justify-between border-b border-white/[0.05] pb-2 text-[0.76rem]">
                    <span className="text-zinc-500">{label}</span>
                    <span className="font-mono text-zinc-400">{calc}</span>
                    <span className="font-mono font-semibold text-zinc-200">{Number(value).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 text-[0.86rem]">
                  <span className="font-semibold text-zinc-200">Monthly total</span>
                  <span className="font-display font-bold text-brand-400">
                    {form.currency} {(4 * form.pricePerGbRam + 4 * form.pricePerCpuCore + 20 * form.pricePerGbDisk).toFixed(2)}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === "system" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Maintenance mode" subtitle="Temporarily restrict access to administrators" icon={<Wrench size={16} />} />
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                  <div>
                    <p className="text-[0.82rem] font-medium text-zinc-200">Enable maintenance mode</p>
                    <p className="text-[0.68rem] text-zinc-500">Clients see a maintenance banner</p>
                  </div>
                  <Switch checked={form.maintenanceMode} onChange={(v) => set("maintenanceMode", v)} />
                </div>
                <Field label="Maintenance message">
                  <textarea
                    className="zk-textarea min-h-[90px]"
                    value={form.maintenanceMessage}
                    onChange={(e) => set("maintenanceMessage", e.target.value)}
                  />
                </Field>
                <Button
                  variant="primary"
                  icon={<Save size={14} />}
                  loading={saving}
                  onClick={() => save({ maintenanceMode: form.maintenanceMode, maintenanceMessage: form.maintenanceMessage })}
                >
                  Apply maintenance settings
                </Button>
              </div>
            </Card>

            <Card>
              <CardHeader title="Data & backup export" subtitle="Download a JSON snapshot of the panel database" icon={<Database size={16} />} />
              <div className="mt-4 space-y-3">
                <p className="text-[0.74rem] leading-relaxed text-zinc-500">
                  Exports users (without password hashes), servers, nodes, settings, API key metadata and the audit log.
                  Store the file securely — it contains infrastructure details.
                </p>
                <Button
                  icon={<Database size={14} />}
                  onClick={async () => {
                    try {
                      const payload = await api("/admin/export");
                      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `zk-mc3-export-${new Date().toISOString().slice(0, 10)}.json`;
                      link.click();
                      URL.revokeObjectURL(url);
                      success("Export downloaded");
                    } catch (err: any) {
                      error("Export failed", err.message);
                    }
                  }}
                >
                  Download JSON export
                </Button>
                <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3 text-[0.7rem] text-zinc-500">
                  <p className="flex items-center gap-1.5 font-medium text-zinc-300">
                    <Badge tone="brand">Tip</Badge> Data lives in{" "}
                    <code className="font-mono text-zinc-400">.data/</code>
                  </p>
                  <p className="mt-1.5">Back up that folder (plus <code className="font-mono">backups/</code>) for full disaster recovery.</p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] zk-surface px-4 py-3 backdrop-blur-xl">
        <p className="text-[0.72rem] text-zinc-500">
          Changes apply immediately across the panel. Some security settings require existing sessions to re-authenticate.
        </p>
        <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={() => save()}>
          Save all settings
        </Button>
      </div>

      <Modal
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        title="Send announcement"
        subtitle="Delivers an in-panel notification to the selected audience"
        icon={<Megaphone size={16} />}
        footer={
          <>
            <Button onClick={() => setBroadcastOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={sendBroadcast}>Send now</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" required>
            <input className="zk-input" value={broadcast.title} onChange={(e) => setBroadcast((b) => ({ ...b, title: e.target.value }))} />
          </Field>
          <Field label="Message" required>
            <textarea className="zk-textarea min-h-[110px]" value={broadcast.message} onChange={(e) => setBroadcast((b) => ({ ...b, message: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Audience">
              <select className="zk-select" value={broadcast.audience} onChange={(e) => setBroadcast((b) => ({ ...b, audience: e.target.value }))}>
                <option value="all">All users</option>
                <option value="admins">Admins only</option>
              </select>
            </Field>
            <Field label="Type">
              <select className="zk-select" value={broadcast.type} onChange={(e) => setBroadcast((b) => ({ ...b, type: e.target.value }))}>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
};

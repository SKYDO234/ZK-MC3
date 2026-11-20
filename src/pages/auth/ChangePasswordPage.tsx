import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2, ShieldCheck, Lock } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";

const strength = (value: string) => {
  let score = 0;
  if (value.length >= 5) score += 1;
  if (value.length >= 10) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
};

const STRENGTH_LABEL = ["Too short", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"];

export const ChangePasswordPage: React.FC = () => {
  const { user, adoptToken } = useAuth();
  const { settings } = useSettings();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [saving, setSaving] = useState(false);

  const minLength = settings?.passwordMinLength || 5;
  const score = useMemo(() => strength(next), [next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirmValue) {
      error("Passwords do not match", "Re-type the new password exactly.");
      return;
    }
    if (next.length < minLength) {
      error("Password too short", `Use at least ${minLength} characters.`);
      return;
    }
    if (next === current || next === "admin") {
      error("Choose a different password", "The default credential is public — pick something unique.");
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ token: string }>("/auth/password", {
        method: "PATCH",
        body: { currentPassword: current, newPassword: next },
      });
      // The old token is invalid the moment the password changes; adopt the new
      // one before navigating, or the dashboard request 401s and bounces to /login.
      await adoptToken(result.token);
      success("Password updated", "Your panel is now secured with your own credential.");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      error("Could not update the password", err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="zk-app-bg" />
      <div className="relative w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/[0.07] text-amber-400">
            <Lock size={24} />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-zinc-50">Secure your panel</h1>
          <p className="mt-1 max-w-sm text-[0.8rem] leading-relaxed text-zinc-500">
            This account still uses the published default credential
            {user?.username ? ` (${user.username})` : ""}. Set your own password to continue — this happens once.
          </p>
        </div>

        <form onSubmit={submit} className="zk-card space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
              Current password
            </label>
            <input
              type="password"
              className="zk-input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="The password you just signed in with"
              autoComplete="current-password"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
              New password
            </label>
            <input
              type="password"
              className="zk-input"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={`At least ${minLength} characters`}
              autoComplete="new-password"
              required
            />
            <div className="mt-2 flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    next ? (i < score ? STRENGTH_COLOR[score] : "bg-white/10") : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <p className="mt-1 text-[0.62rem] text-zinc-600">
              {next ? STRENGTH_LABEL[score] : "Mix letters, numbers and a symbol for a strong password."}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
              Confirm new password
            </label>
            <input
              type="password"
              className="zk-input"
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              placeholder="Repeat the new password"
              autoComplete="new-password"
              required
            />
            {confirmValue && confirmValue !== next && (
              <p className="mt-1 text-[0.62rem] text-red-400">Passwords do not match yet.</p>
            )}
          </div>

          <button type="submit" disabled={saving} className="zk-btn zk-btn-primary w-full justify-center">
            {saving ? <Loader2 size={14} className="zk-spin" /> : <KeyRound size={14} />}
            Update password &amp; continue
          </button>

          <p className="flex items-center gap-1.5 text-[0.62rem] text-zinc-600">
            <ShieldCheck size={11} className="text-emerald-500" />
            You will stay signed in on this device. Other sessions keep their own tokens.
          </p>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordPage;

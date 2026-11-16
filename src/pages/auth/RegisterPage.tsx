import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, UserPlus, AlertCircle, Check, X } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/api";

const requirements = (password: string, min: number) => [
  { label: `At least ${min} characters`, ok: password.length >= min },
  { label: "Contains a letter", ok: /[A-Za-z]/.test(password) },
  { label: "Contains a number", ok: /[0-9]/.test(password) },
  { label: "Contains a symbol (optional)", ok: /[^A-Za-z0-9]/.test(password), optional: true },
];

export const RegisterPage: React.FC = () => {
  const { register, user } = useAuth();
  const { settings } = useSettings();
  const { success } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    confirm: "",
    terms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const checks = useMemo(() => requirements(form.password, settings.passwordMinLength), [form.password, settings.passwordMinLength]);
  const strength = checks.filter((c) => c.ok && !c.optional).length;

  React.useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Please enter your full name.");
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(form.username))
      return setError("Username must be 3-24 characters using letters, numbers, dots or dashes.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return setError("Please enter a valid email address.");
    if (strength < 3) return setError("Your password does not meet the security requirements.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (!form.terms) return setError("You must agree to the terms of service to continue.");

    setLoading(true);
    try {
      const created = await register({
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      success("Account created", `Welcome aboard, ${created.username}!`);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!settings.enableRegistration) {
    return (
      <AuthShell title="Registration closed" subtitle="New account signups are currently disabled by the administrator.">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-[0.82rem] leading-relaxed text-amber-200">
          You cannot create an account right now. Contact {settings.companyName} support if you believe this is a
          mistake.
        </div>
        <Link to="/login" className="zk-btn zk-btn-primary mt-5 w-full">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Launch your first Minecraft server in minutes — no credit card required."
      wide
      footer={
        <p className="text-center text-[0.8rem] text-zinc-500">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-400 transition hover:text-brand-300">
            Sign in instead
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.78rem] text-red-200">
            <AlertCircle size={15} className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="zk-label">Full name</label>
            <input
              className="zk-input"
              placeholder="MD Ziyan Hossain"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div>
            <label className="zk-label">Username</label>
            <input
              className="zk-input"
              placeholder="ziyanmc"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="zk-label">Email address</label>
          <input
            className="zk-input"
            type="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="zk-label">Password</label>
            <div className="relative">
              <input
                className="zk-input pr-10"
                type={showPassword ? "text" : "password"}
                placeholder="Create a strong password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="zk-label">Confirm password</label>
            <input
              className="zk-input"
              type={showPassword ? "text" : "password"}
              placeholder="Repeat your password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            />
          </div>
        </div>

        {form.password && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
                Password strength
              </span>
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${
                      i < strength
                        ? strength <= 1
                          ? "bg-red-400"
                          : strength === 2
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                        : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {checks.map((check) => (
                <span
                  key={check.label}
                  className={`flex items-center gap-1.5 text-[0.68rem] ${
                    check.ok ? "text-emerald-400" : "text-zinc-500"
                  }`}
                >
                  {check.ok ? <Check size={11} /> : <X size={11} />}
                  {check.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <label className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            type="checkbox"
            className="zk-checkbox mt-0.5"
            checked={form.terms}
            onChange={(e) => setForm((f) => ({ ...f, terms: e.target.checked }))}
          />
          <span className="text-[0.76rem] leading-relaxed text-zinc-400">
            I agree to the{" "}
            <span className="font-medium text-brand-400">Terms of Service</span> and{" "}
            <span className="font-medium text-brand-400">Privacy Policy</span> of {settings.companyName}.
          </span>
        </label>

        <button type="submit" className="zk-btn zk-btn-primary w-full py-2.5" disabled={loading}>
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black/80" />
          ) : (
            <UserPlus size={16} />
          )}
          {loading ? "Creating account…" : "Create my account"}
        </button>
      </form>
    </AuthShell>
  );
};

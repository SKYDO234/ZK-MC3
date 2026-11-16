import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn, AlertCircle, ShieldCheck, User, KeyRound } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/api";

export const LoginPage: React.FC = () => {
  const { login, user } = useAuth();
  const { settings } = useSettings();
  const { success } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || (user ? (user.role === "admin" || user.role === "owner" ? "/admin" : "/dashboard") : "/dashboard");

  const [form, setForm] = useState({ login: "", password: "", remember: true });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.login || !form.password) {
      setError("Please enter your username/email and password.");
      return;
    }
    setLoading(true);
    try {
      const logged = await login(form.login.trim(), form.password, form.remember);
      success("Welcome back", `Signed in as ${logged.username}`);
      navigate(logged.role === "admin" || logged.role === "owner" ? "/admin" : "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (who: "owner" | "client") => {
    setForm({
      login: who === "owner" ? "admin" : "demo",
      password: who === "owner" ? "admin" : "demo12345",
      remember: true,
    });
    setError("");
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your hosting panel to manage servers, nodes and deployments."
      footer={
        settings.enableRegistration ? (
          <p className="text-center text-[0.8rem] text-zinc-500">
            Don't have an account?{" "}
            <Link to="/register" className="font-semibold text-brand-400 transition hover:text-brand-300">
              Create one now
            </Link>
          </p>
        ) : null
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.78rem] text-red-200">
            <AlertCircle size={15} className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="zk-label">Username or email</label>
          <div className="relative">
            <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              className="zk-input pl-10"
              placeholder="admin or you@example.com"
              value={form.login}
              onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
              autoComplete="username"
              autoFocus
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="zk-label">Password</label>
            <Link to="/forgot-password" className="mb-1 text-[0.72rem] font-medium text-brand-400 hover:text-brand-300">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <KeyRound size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              className="zk-input px-10"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition hover:text-zinc-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {settings.allowRememberMe && (
          <label className="flex cursor-pointer select-none items-center gap-2.5">
            <input
              type="checkbox"
              className="zk-checkbox"
              checked={form.remember}
              onChange={(e) => setForm((f) => ({ ...f, remember: e.target.checked }))}
            />
            <span className="text-[0.78rem] text-zinc-400">Keep me signed in for 30 days</span>
          </label>
        )}

        <button type="submit" className="zk-btn zk-btn-primary w-full py-2.5" disabled={loading}>
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black/80" />
          ) : (
            <LogIn size={16} />
          )}
          {loading ? "Signing in…" : "Sign in to panel"}
        </button>
      </form>

      {settings.showDemoCredentials && (
        <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-zinc-500">
            <ShieldCheck size={12} className="text-brand-400" /> Demo logins
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fillDemo("owner")}
              className="zk-btn zk-btn-ghost zk-btn-sm flex-1"
            >
              Owner · admin
            </button>
            <button
              type="button"
              onClick={() => fillDemo("client")}
              className="zk-btn zk-btn-ghost zk-btn-sm flex-1"
            >
              Client · demo
            </button>
          </div>
          <p className="mt-2 text-[0.64rem] leading-relaxed text-zinc-600">
            Default seed password is <span className="font-mono text-zinc-500">admin</span> — change it
            from Account settings after your first sign-in.
          </p>
        </div>
      )}
    </AuthShell>
  );
};

import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn, AlertCircle, User, KeyRound } from "lucide-react";
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

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your account to continue."
      footer={
        settings.enableRegistration ? (
          <p className="text-center text-[0.74rem] text-zinc-500">
            Don't have an account?{" "}
            <Link to="/register" className="font-semibold text-zinc-200 transition hover:text-white">
              Create one
            </Link>
          </p>
        ) : null
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-[0.74rem] text-red-300">
            <AlertCircle size={15} className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="zk-label">Username</label>
          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              className="zk-input pl-9"
              placeholder="Enter your username"
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
            <Link to="/forgot-password" className="mb-1 text-[0.7rem] font-medium text-zinc-500 hover:text-zinc-300">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              className="zk-input px-9"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition hover:text-zinc-300"
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

        <button type="submit" className="zk-btn zk-btn-primary w-full" disabled={loading}>
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black/80" />
          ) : (
            <LogIn size={16} />
          )}
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>

    </AuthShell>
  );
};

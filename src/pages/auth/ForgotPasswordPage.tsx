import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { useSettings } from "../../context/SettingsContext";

export const ForgotPasswordPage: React.FC = () => {
  const { settings } = useSettings();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email tied to your panel account and we'll send recovery instructions."
      footer={
        <p className="text-center text-[0.8rem] text-zinc-500">
          <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-brand-400 hover:text-brand-300">
            <ArrowLeft size={13} /> Back to sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-5">
          <CheckCircle2 size={22} className="text-emerald-400" />
          <p className="mt-3 text-sm font-semibold text-emerald-100">Request received</p>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-emerald-200/70">
            If an account exists for <span className="font-medium">{email}</span>, a panel administrator will
            contact you with recovery instructions. For instant help, ask an admin to reset your password from{" "}
            <span className="font-medium">Admin → User Management</span>.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email) setSent(true);
          }}
          className="space-y-4"
        >
          <div>
            <label className="zk-label">Email address</label>
            <div className="relative">
              <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                className="zk-input pl-10"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <button type="submit" className="zk-btn zk-btn-primary w-full py-2.5">
            <Mail size={16} /> Send recovery request
          </button>
          <p className="text-center text-[0.68rem] leading-relaxed text-zinc-600">
            Need help right away? Contact {settings.companyName} support — CEO {settings.ceoName}.
          </p>
        </form>
      )}
    </AuthShell>
  );
};

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (type: ToastType, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  confirm: (options: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-emerald-400" />,
  error: <XCircle size={18} className="text-red-400" />,
  info: <Info size={18} className="text-sky-400" />,
  warning: <AlertTriangle size={18} className="text-amber-400" />,
};

const BORDER: Record<ToastType, string> = {
  success: "border-emerald-500/30",
  error: "border-red-500/30",
  info: "border-sky-500/30",
  warning: "border-amber-500/30",
};

interface ConfirmState {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (type: ToastType, title: string, message?: string) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
      setTimeout(() => remove(id), 4600);
    },
    [remove]
  );

  const confirm = useCallback(
    (options: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setConfirmState({ ...options, resolve })),
    []
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (t, m) => toast("success", t, m),
      error: (t, m) => toast("error", t, m),
      info: (t, m) => toast("info", t, m),
      warning: (t, m) => toast("warning", t, m),
      confirm,
    }),
    [toast, confirm]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="fixed bottom-5 right-5 z-[120] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`zk-fade-up flex items-start gap-3 rounded-xl border ${BORDER[t.type]} bg-[#121216]/95 p-3.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl`}
          >
            <div className="mt-0.5">{ICONS[t.type]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">{t.title}</p>
              {t.message && <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{t.message}</p>}
            </div>
            <button onClick={() => remove(t.id)} className="text-zinc-500 transition hover:text-zinc-200">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="zk-card w-full max-w-md p-6 zk-fade-up">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${
                  confirmState.danger ? "bg-red-500/15 text-red-400" : "bg-brand-500/15 text-brand-400"
                }`}
              >
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-zinc-100">{confirmState.title}</h3>
                {confirmState.message && (
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{confirmState.message}</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="zk-btn zk-btn-ghost"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
              >
                Cancel
              </button>
              <button
                className={`zk-btn ${confirmState.danger ? "zk-btn-danger" : "zk-btn-primary"}`}
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
              >
                {confirmState.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
};

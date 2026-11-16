import React from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SettingsProvider } from "./context/SettingsContext";
import { ToastProvider } from "./context/ToastContext";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { UserDashboard } from "./pages/user/UserDashboard";
import { ServerList } from "./pages/user/ServerList";
import { ServerView } from "./pages/user/ServerView";
import { ApiKeysPage } from "./pages/user/ApiKeysPage";
import { AccountPage } from "./pages/user/AccountPage";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { CreateServer } from "./pages/admin/CreateServer";
import { AdminServers } from "./pages/admin/AdminServers";
import { NodesPage } from "./pages/admin/NodesPage";
import { UserManagement } from "./pages/admin/UserManagement";
import { AdminApiKeys } from "./pages/admin/AdminApiKeys";
import { PanelSettings } from "./pages/admin/PanelSettings";
import { Loader2, ShieldAlert, ServerCrash } from "lucide-react";

const FullScreenLoader: React.FC = () => (
  <div className="relative flex min-h-screen items-center justify-center">
    <div className="zk-app-bg" />
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <img src="/logo.png" alt="" className="h-14 w-14 rounded-xl border border-brand-500/30 object-cover" />
        <span className="absolute inset-0 rounded-xl ring-2 ring-brand-500/40 animate-ping" />
      </div>
      <div className="flex items-center gap-2 text-[0.78rem] text-zinc-500">
        <Loader2 size={14} className="zk-spin text-brand-400" /> Loading panel…
      </div>
    </div>
  </div>
);

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
};

const RequireAdmin: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin" && user.role !== "owner") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 text-red-400">
          <ShieldAlert size={24} />
        </div>
        <h2 className="font-display text-lg font-bold text-zinc-100">Administrator access required</h2>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">
          Your account does not have permission to view this area. Contact the panel owner for access.
        </p>
      </div>
    );
  }
  return <>{children}</>;
};

const NotFound: React.FC = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-brand-400">
      <ServerCrash size={24} />
    </div>
    <h2 className="font-display text-lg font-bold text-zinc-100">404 — Page not found</h2>
    <p className="mt-1 text-sm text-zinc-500">The page you're looking for has been moved or deleted.</p>
    <a href="/dashboard" className="zk-btn zk-btn-primary mt-5">
      Back to dashboard
    </a>
  </div>
);

export const AppRoutes: React.FC = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/" element={<Navigate to="/dashboard" replace />} />

    <Route
      element={
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      }
    >
      <Route path="/dashboard" element={<UserDashboard />} />
      <Route path="/servers" element={<ServerList />} />
      <Route path="/servers/:id" element={<ServerView />} />
      <Route path="/api-keys" element={<ApiKeysPage />} />
      <Route path="/account" element={<AccountPage />} />

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/create-server"
        element={
          <RequireAdmin>
            <CreateServer />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/servers"
        element={
          <RequireAdmin>
            <AdminServers />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/nodes"
        element={
          <RequireAdmin>
            <NodesPage />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAdmin>
            <UserManagement />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/api-keys"
        element={
          <RequireAdmin>
            <AdminApiKeys />
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <RequireAdmin>
            <PanelSettings />
          </RequireAdmin>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
);

export const App: React.FC = () => (
  <BrowserRouter>
    <SettingsProvider>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </SettingsProvider>
  </BrowserRouter>
);

export default App;

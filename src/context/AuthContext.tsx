import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "../lib/api";

export interface PanelUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: "owner" | "admin" | "user";
  status: string;
  avatar: string;
  balance: number;
  credits: number;
  createdAt: string;
  lastLogin: string | null;
  lastIp: string | null;
  twoFactor: boolean;
  preferences: {
    theme: string;
    emailNotifications: boolean;
    crashAlerts: boolean;
    productUpdates: boolean;
    loginAlerts: boolean;
  };
}

interface AuthContextValue {
  user: PanelUser | null;
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  login: (login: string, password: string, remember?: boolean) => Promise<PanelUser>;
  register: (payload: { name: string; username: string; email: string; password: string }) => Promise<PanelUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (patch: Partial<PanelUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<PanelUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<PanelUser>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("zk:unauthorized", onUnauthorized);
    return () => window.removeEventListener("zk:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (loginValue: string, password: string, remember = false) => {
    const data = await api<{ token: string; user: PanelUser }>("/auth/login", {
      method: "POST",
      body: { login: loginValue, password, remember },
    });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (payload: { name: string; username: string; email: string; password: string }) => {
      const data = await api<{ token: string; user: PanelUser }>("/auth/register", {
        method: "POST",
        body: payload,
      });
      setToken(data.token);
      setUser(data.user);
      return data.user;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken("");
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<PanelUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAdmin: user?.role === "admin" || user?.role === "owner",
      isOwner: user?.role === "owner",
      login,
      register,
      logout,
      refresh,
      updateUser,
    }),
    [user, loading, login, register, logout, refresh, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};

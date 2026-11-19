import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export interface PublicSettings {
  panelName: string;
  panelTagline: string;
  companyName: string;
  companyUrl: string;
  ceoName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  theme: string;
  enableRegistration: boolean;
  allowRememberMe: boolean;
  passwordMinLength: number;
  /** Operator opt-in: force the rotation screen for seeded credentials. */
  requireInitialPasswordChange?: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  billingEnabled: boolean;
  currency: string;
  allowUserServerCreation: boolean;
}

const FALLBACK: PublicSettings = {
  panelName: "ZK-MC3-PANEL",
  panelTagline: "Minecraft Hosting Panel",
  companyName: "ZK-STUDIO",
  companyUrl: "https://github.com/SKYDO234/ZK-MC3",
  ceoName: "MD Ziyan Hossain",
  logoUrl: "/logo-icon.png",
  faviconUrl: "/favicon.png",
  primaryColor: "#ff7a18",
  accentColor: "#ffb020",
  theme: "dark",
  enableRegistration: true,
  allowRememberMe: true,
  passwordMinLength: 5,
  requireInitialPasswordChange: false,
  maintenanceMode: false,
  maintenanceMessage: "",
  billingEnabled: true,
  currency: "USD",
  allowUserServerCreation: false,
};

interface SettingsContextValue {
  settings: PublicSettings;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: FALLBACK,
  loading: true,
  refresh: async () => {},
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<PublicSettings>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<PublicSettings>("/settings");
      setSettings({ ...FALLBACK, ...data });
    } catch {
      setSettings(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    document.title = `${settings.panelName} · ${settings.panelTagline}`;
    const root = document.documentElement;
    root.style.setProperty("--brand", settings.primaryColor);
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (icon && settings.faviconUrl) icon.href = settings.faviconUrl;
  }, [settings]);

  const value = useMemo(() => ({ settings, loading, refresh }), [settings, loading, refresh]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);

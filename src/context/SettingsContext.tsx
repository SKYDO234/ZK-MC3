import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Appearance, APPEARANCE_DEFAULTS, applyAppearance } from "../lib/appearance";

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
  /** Playit.gg tunnels — gates the per-server Tunnel tab. */
  enablePlayit?: boolean;
}

/** Identity fields plus the appearance keys written by Themes & Fonts. */
export interface PublicSettingsWithAppearance extends PublicSettings, Appearance {}

const FALLBACK: PublicSettingsWithAppearance = {
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
  enablePlayit: false,
  ...APPEARANCE_DEFAULTS,
};

interface SettingsContextValue {
  settings: PublicSettingsWithAppearance;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: FALLBACK,
  loading: true,
  refresh: async () => {},
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<PublicSettingsWithAppearance>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Partial<PublicSettingsWithAppearance>>("/settings");
      // A missing/empty body (304, 204, a proxy eating the response) must not be
      // treated as "settings are all defaults". Overwriting here is what made a
      // saved theme and panel name appear to revert: the fetch succeeded, the
      // body was empty, and every appearance key snapped back to the fallback.
      if (!data || typeof data !== "object" || Object.keys(data).length === 0) return;
      setSettings({ ...FALLBACK, ...data });
    } catch {
      // A failed refresh keeps the last known-good settings on screen. Blanking
      // to FALLBACK would throw away a working theme because the network blipped.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Settings are panel-wide and changeable by any admin, so an open tab has to
  // notice. Without this, a rename or theme change made in one browser never
  // reached another — the save said "every user now sees the new look" while
  // everyone else kept the previous look until a hard reload.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, 30_000);
    // Returning to a tab is when a stale theme is most obvious.
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  useEffect(() => {
    document.title = `${settings.panelName} · ${settings.panelTagline}`;
    applyAppearance(settings, settings.primaryColor);
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (icon && settings.faviconUrl) icon.href = settings.faviconUrl;
  }, [settings]);

  const value = useMemo(() => ({ settings, loading, refresh }), [settings, loading, refresh]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);

import { readJSON, writeJSON } from "./db";

export interface PanelSettings {
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
  language: string;

  enableRegistration: boolean;
  requireEmailVerification: boolean;
  enableTwoFactor: boolean;
  allowRememberMe: boolean;
  sessionTimeoutHours: number;
  passwordMinLength: number;

  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  smtpEnabled: boolean;

  apiEnabled: boolean;
  apiRateLimit: number;
  apiKeyMaxPerUser: number;
  apiKeyDefaultExpiryDays: number;

  notifyOnCrash: boolean;
  notifyOnLogin: boolean;
  notifyOnBackup: boolean;
  notifyOnLowResources: boolean;
  notifyEmail: string;

  /** Show the forced password-rotation screen for seeded default credentials. */
  requireInitialPasswordChange: boolean;

  maxServersPerUser: number;
  maxRamPerServer: number;
  maxCpuPerServer: number;
  maxDiskPerServer: number;
  defaultRuntime: string;
  defaultSoftware: string;
  defaultVersion: string;
  allowUserServerCreation: boolean;

  /* ---------------------------------------------------------------------
   * Appearance — the Themes & Fonts page writes these. They are served to
   * every client through /api/settings so one save restyles the whole panel.
   * ------------------------------------------------------------------- */
  uiStyle: string;
  sidebarStyle: string;
  cardStyle: string;
  topbarStyle: string;
  cornerRadius: string;
  sidebarWidth: string;
  cardBorderGlow: string;
  glassBlur: number;
  fontScale: string;
  animSpeed: string;
  uiMotion: string;
  /** Custom accent pair. Empty strings keep the brand palette from Branding. */
  uiAccent: string;
  uiAccent2: string;
  panelFont: string;
  wallpaper: string;
  wallpaperType: string;
  wallpaperPreset: string;
  wallpaperOpacity: number;

  billingEnabled: boolean;
  currency: string;
  pricePerGbRam: number;
  pricePerCpuCore: number;
  pricePerGbDisk: number;

  forceHttps: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  loginAlert: boolean;

  /** Playit.gg tunnels — the per-server "expose to the internet" feature. */
  enablePlayit: boolean;

  updatedAt: string;
}

export const DEFAULT_SETTINGS: PanelSettings = {
  panelName: "ZK-MC3-PANEL",
  panelTagline: "Minecraft Hosting Panel",
  companyName: "ZK-STUDIO",
  companyUrl: "https://github.com/SKYDO234/ZK-MC3",
  ceoName: "MD Ziyan Hossain",
  logoUrl: "/logo.png",
  faviconUrl: "/logo.png",
  primaryColor: "#ff7a18",
  accentColor: "#ffb020",
  theme: "dark",
  language: "en",

  enableRegistration: true,
  requireEmailVerification: false,
  enableTwoFactor: false,
  allowRememberMe: true,
  sessionTimeoutHours: 168,
  passwordMinLength: 5,

  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "ZK-MC3-PANEL <no-reply@zk-mc3.local>",
  smtpEnabled: false,

  apiEnabled: true,
  apiRateLimit: 120,
  apiKeyMaxPerUser: 10,
  apiKeyDefaultExpiryDays: 0,

  notifyOnCrash: true,
  notifyOnLogin: true,
  notifyOnBackup: true,
  notifyOnLowResources: true,
  notifyEmail: "",

  // Off by default: operators can sign in, look around and change the password
  // whenever they want instead of being blocked by a full-screen gate.
  requireInitialPasswordChange: false,

  maxServersPerUser: 5,
  maxRamPerServer: 8192,
  maxCpuPerServer: 8,
  maxDiskPerServer: 51200,
  defaultRuntime: "local",
  defaultSoftware: "PAPER",
  defaultVersion: "1.21.4",
  allowUserServerCreation: false,

  // Frosted glass is the shipped look: translucent cards over the wallpaper.
  uiStyle: "frosted",
  sidebarStyle: "glass",
  cardStyle: "glass",
  topbarStyle: "glass",
  cornerRadius: "rounded",
  sidebarWidth: "normal",
  cardBorderGlow: "subtle",
  glassBlur: 18,
  fontScale: "normal",
  animSpeed: "normal",
  uiMotion: "on",
  uiAccent: "",
  uiAccent2: "",
  panelFont: "",
  wallpaper: "/wallpaper.jpg",
  wallpaperType: "image",
  wallpaperPreset: "",
  wallpaperOpacity: 100,

  billingEnabled: true,
  currency: "USD",
  pricePerGbRam: 2.5,
  pricePerCpuCore: 1.5,
  pricePerGbDisk: 0.1,

  forceHttps: false,
  maintenanceMode: false,
  maintenanceMessage: "ZK-MC3-PANEL is currently under maintenance. Please check back shortly.",
  loginAlert: true,

  // Off until an administrator opts in, matching JTG's gate.
  enablePlayit: false,

  updatedAt: new Date(0).toISOString(),
};

export const getSettings = async (): Promise<PanelSettings> => {
  const stored = await readJSON<Partial<PanelSettings>>("settings.json", {});
  return { ...DEFAULT_SETTINGS, ...stored };
};

export const saveSettings = async (patch: Partial<PanelSettings>): Promise<PanelSettings> => {
  const current = await getSettings();
  const next: PanelSettings = { ...current, ...patch, updatedAt: new Date().toISOString() };
  // Keep secrets when the client sends the masked placeholder
  if (patch.smtpPass === "********") next.smtpPass = current.smtpPass;
  await writeJSON("settings.json", next);
  return next;
};

export const publicSettings = async () => {
  const s = await getSettings();
  return {
    panelName: s.panelName,
    panelTagline: s.panelTagline,
    companyName: s.companyName,
    companyUrl: s.companyUrl,
    ceoName: s.ceoName,
    logoUrl: s.logoUrl,
    faviconUrl: s.faviconUrl,
    primaryColor: s.primaryColor,
    accentColor: s.accentColor,
    theme: s.theme,
    language: s.language,
    enableRegistration: s.enableRegistration,
    allowRememberMe: s.allowRememberMe,
    passwordMinLength: s.passwordMinLength,
    requireInitialPasswordChange: s.requireInitialPasswordChange,
    maintenanceMode: s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    billingEnabled: s.billingEnabled,
    currency: s.currency,
    enablePlayit: s.enablePlayit,
    uiStyle: s.uiStyle,
    sidebarStyle: s.sidebarStyle,
    cardStyle: s.cardStyle,
    topbarStyle: s.topbarStyle,
    cornerRadius: s.cornerRadius,
    sidebarWidth: s.sidebarWidth,
    cardBorderGlow: s.cardBorderGlow,
    glassBlur: s.glassBlur,
    fontScale: s.fontScale,
    animSpeed: s.animSpeed,
    uiMotion: s.uiMotion,
    uiAccent: s.uiAccent,
    uiAccent2: s.uiAccent2,
    panelFont: s.panelFont,
    wallpaper: s.wallpaper,
    wallpaperType: s.wallpaperType,
    wallpaperPreset: s.wallpaperPreset,
    wallpaperOpacity: s.wallpaperOpacity,
    allowUserServerCreation: s.allowUserServerCreation,
    updatedAt: s.updatedAt,
  };
};

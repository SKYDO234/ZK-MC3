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
  showDemoCredentials: boolean;

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

  billingEnabled: boolean;
  currency: string;
  pricePerGbRam: number;
  pricePerCpuCore: number;
  pricePerGbDisk: number;

  forceHttps: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  loginAlert: boolean;

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
  showDemoCredentials: true,

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

  billingEnabled: true,
  currency: "USD",
  pricePerGbRam: 2.5,
  pricePerCpuCore: 1.5,
  pricePerGbDisk: 0.1,

  forceHttps: false,
  maintenanceMode: false,
  maintenanceMessage: "ZK-MC3-PANEL is currently under maintenance. Please check back shortly.",
  loginAlert: true,

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
    showDemoCredentials: s.showDemoCredentials,
    passwordMinLength: s.passwordMinLength,
    requireInitialPasswordChange: s.requireInitialPasswordChange,
    maintenanceMode: s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    billingEnabled: s.billingEnabled,
    currency: s.currency,
    allowUserServerCreation: s.allowUserServerCreation,
    updatedAt: s.updatedAt,
  };
};

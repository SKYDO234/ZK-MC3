/**
 * Appearance engine
 * ---------------------------------------------------------------------------
 * One settings object restyles the whole panel. The Themes & Fonts page writes
 * the values, /api/settings serves them to every client, and this module turns
 * them into data attributes on <html> plus a handful of CSS custom properties.
 * Every rule lives in index.css, so a preview can be applied instantly without
 * touching the server and then persisted with one save.
 */

export interface Appearance {
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
  uiAccent: string;
  uiAccent2: string;
  panelFont: string;
  wallpaper: string;
  wallpaperType: string;
  wallpaperPreset: string;
  wallpaperOpacity: number;
}

export const APPEARANCE_DEFAULTS: Appearance = {
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
};

/** The eight visual presets, each a complete bundle rather than one attribute. */
export const STYLE_PRESETS: Array<{
  id: string;
  label: string;
  hint: string;
  values: Partial<Appearance>;
}> = [
  {
    id: "solid",
    label: "Solid",
    hint: "Opaque ink panels",
    values: { uiStyle: "solid", cardStyle: "solid", sidebarStyle: "solid", topbarStyle: "solid", cornerRadius: "rounded", cardBorderGlow: "off" },
  },
  {
    id: "frosted",
    label: "Frosted",
    hint: "Blurred glass over the wallpaper",
    values: { uiStyle: "frosted", cardStyle: "glass", sidebarStyle: "glass", topbarStyle: "glass", cornerRadius: "rounded", cardBorderGlow: "subtle", glassBlur: 22 },
  },
  {
    id: "glass",
    label: "Glass",
    hint: "Lighter translucency",
    values: { uiStyle: "glass", cardStyle: "glass", sidebarStyle: "glass", topbarStyle: "blur", cornerRadius: "rounded", cardBorderGlow: "subtle", glassBlur: 14 },
  },
  {
    id: "minimal",
    label: "Minimal",
    hint: "Flat borders, no depth",
    values: { uiStyle: "minimal", cardStyle: "flat", sidebarStyle: "solid", topbarStyle: "transparent", cornerRadius: "sharp", cardBorderGlow: "off", glassBlur: 10 },
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    hint: "Neon edges, accent top bar",
    values: { uiStyle: "cyberpunk", cardStyle: "neon", sidebarStyle: "gradient", topbarStyle: "accent", cornerRadius: "sharp", cardBorderGlow: "strong", animSpeed: "fast" },
  },
  {
    id: "neumorphic",
    label: "Neumorphic",
    hint: "Soft raised surfaces",
    values: { uiStyle: "neumorphic", cardStyle: "elevated", sidebarStyle: "solid", topbarStyle: "solid", cornerRadius: "extra", cardBorderGlow: "off" },
  },
  {
    id: "neon",
    label: "Neon",
    hint: "Accent glow on every card",
    values: { uiStyle: "neon", cardStyle: "neon", sidebarStyle: "glass", topbarStyle: "dark", cornerRadius: "rounded", cardBorderGlow: "medium" },
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "Monospaced, square, high contrast",
    values: { uiStyle: "terminal", cardStyle: "bordered", sidebarStyle: "solid", topbarStyle: "dark", cornerRadius: "sharp", cardBorderGlow: "off", panelFont: "JetBrains Mono" },
  },
];

/** Segmented rows reproduced from the AMC panel, grouped for our page layout. */
export const SEGMENTED: Array<{
  key: keyof Appearance;
  label: string;
  options: Array<{ value: string; label: string }>;
}> = [
  {
    key: "sidebarStyle",
    label: "Sidebar",
    options: [
      { value: "solid", label: "Solid" },
      { value: "glass", label: "Glass" },
      { value: "gradient", label: "Gradient" },
    ],
  },
  {
    key: "cardStyle",
    label: "Card Style",
    options: [
      { value: "solid", label: "Solid" },
      { value: "glass", label: "Glass" },
      { value: "bordered", label: "Bordered" },
      { value: "flat", label: "Flat" },
      { value: "elevated", label: "Elevated" },
      { value: "neon", label: "Neon" },
    ],
  },
  {
    key: "topbarStyle",
    label: "Top Bar",
    options: [
      { value: "solid", label: "Solid" },
      { value: "glass", label: "Glass" },
      { value: "blur", label: "Blur" },
      { value: "dark", label: "Dark" },
      { value: "accent", label: "Accent" },
      { value: "transparent", label: "Transparent" },
    ],
  },
  {
    key: "cornerRadius",
    label: "Corner Radius",
    options: [
      { value: "sharp", label: "Sharp" },
      { value: "rounded", label: "Rounded" },
      { value: "extra", label: "Extra" },
    ],
  },
  {
    key: "sidebarWidth",
    label: "Sidebar Width",
    options: [
      { value: "compact", label: "Compact" },
      { value: "normal", label: "Normal" },
      { value: "wide", label: "Wide" },
    ],
  },
  {
    key: "cardBorderGlow",
    label: "Border Glow",
    options: [
      { value: "off", label: "Off" },
      { value: "subtle", label: "Subtle" },
      { value: "medium", label: "Medium" },
      { value: "strong", label: "Strong" },
      { value: "pulse", label: "Pulse" },
    ],
  },
  {
    key: "fontScale",
    label: "Font Scale",
    options: [
      { value: "small", label: "Small" },
      { value: "normal", label: "Normal" },
      { value: "large", label: "Large" },
      { value: "xl", label: "XL" },
    ],
  },
  {
    key: "animSpeed",
    label: "Animation Speed",
    options: [
      { value: "slow", label: "Slow" },
      { value: "normal", label: "Normal" },
      { value: "fast", label: "Fast" },
      { value: "instant", label: "Instant" },
    ],
  },
  {
    key: "uiMotion",
    label: "Motion & Effects",
    options: [
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
  },
];

/** Twelve accent pairs, the same spread AMC ships. */
export const ACCENT_SWATCHES: Array<{ name: string; a: string; b: string }> = [
  { name: "Brand", a: "#ff7a18", b: "#ffb020" },
  { name: "Indigo", a: "#6366f1", b: "#8b5cf6" },
  { name: "Blue cyan", a: "#3b82f6", b: "#06b6d4" },
  { name: "Emerald", a: "#10b981", b: "#14b8a6" },
  { name: "Amber red", a: "#f59e0b", b: "#ef4444" },
  { name: "Pink purple", a: "#ec4899", b: "#a855f7" },
  { name: "Cyberpunk", a: "#00fff5", b: "#ff006e" },
  { name: "Matrix", a: "#00ff41", b: "#00cc33" },
  { name: "Sunset", a: "#ff6b35", b: "#f7c59f" },
  { name: "Violet", a: "#667eea", b: "#764ba2" },
  { name: "Rose", a: "#f093fb", b: "#f5576c" },
  { name: "Mint", a: "#43e97b", b: "#38f9d7" },
];

export const WALLPAPER_PRESETS: Array<{ id: string; label: string; css: string }> = [
  { id: "deep-blue", label: "Deep Blue", css: "linear-gradient(135deg,#020817,#0f2460,#4f46e5)" },
  { id: "midnight", label: "Midnight", css: "linear-gradient(135deg,#050506,#14141c,#1e2436)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(135deg,#04101f,#0a3d62,#1e6fd9)" },
  { id: "nebula", label: "Nebula", css: "linear-gradient(135deg,#0d0221,#211148,#4c1d95)" },
  { id: "forest", label: "Forest", css: "linear-gradient(135deg,#06110b,#0d2137,#065f46)" },
  { id: "crimson", label: "Crimson", css: "linear-gradient(135deg,#140708,#3b0a0f,#7f1d1d)" },
  { id: "ember", label: "Ember", css: "linear-gradient(135deg,#120a04,#2b1408,#7c2d12)" },
];

export const FONT_CHOICES = [
  "",
  "Inter",
  "Roboto",
  "Open Sans",
  "Poppins",
  "Montserrat",
  "Nunito",
  "Space Grotesk",
  "DM Sans",
  "Outfit",
  "Oxanium",
  "Orbitron",
  "Exo 2",
  "Rajdhani",
  "Audiowide",
  "Lexend",
  "Sora",
  "JetBrains Mono",
];

const RADIUS: Record<string, string> = { sharp: "5px", rounded: "12px", extra: "18px" };
const FONT_SCALE: Record<string, string> = { small: "93.75%", normal: "100%", large: "106.25%", xl: "112.5%" };
const SPEED: Record<string, string> = { slow: "0.45s", normal: "0.22s", fast: "0.12s", instant: "0.001s" };
const SIDEBAR_W: Record<string, string> = { compact: "216px", normal: "248px", wide: "280px" };

const FONT_LINKS = new Set<string>();

/** Loads a Google Font once; harmless when the network is unavailable. */
export const loadFont = (family: string) => {
  if (!family || FONT_LINKS.has(family)) return;
  FONT_LINKS.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.dataset.zkFont = family;
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
};

const setVar = (root: HTMLElement, name: string, value: string) => {
  if (value) root.style.setProperty(name, value);
  else root.style.removeProperty(name);
};

/**
 * Applies an appearance to the document. Safe to call on every settings poll:
 * the attributes are idempotent and the accent variables are absolute.
 */
export const applyAppearance = (appearance: Partial<Appearance>, fallbackAccent = "#ff7a18") => {
  const a = { ...APPEARANCE_DEFAULTS, ...appearance };
  const root = document.documentElement;

  root.dataset.ui = a.uiStyle || "frosted";
  root.dataset.sidebar = a.sidebarStyle || "glass";
  root.dataset.card = a.cardStyle || "glass";
  root.dataset.topbar = a.topbarStyle || "glass";
  root.dataset.radius = a.cornerRadius || "rounded";
  root.dataset.sidebarWidth = a.sidebarWidth || "normal";
  root.dataset.glow = a.cardBorderGlow || "off";
  root.dataset.fontScale = a.fontScale || "normal";
  root.dataset.animSpeed = a.animSpeed || "normal";
  root.dataset.motion = a.uiMotion || "on";

  const blur = Math.max(4, Math.min(48, Number(a.glassBlur) || 18));
  setVar(root, "--glass-blur", `${blur}px`);
  setVar(root, "--ui-radius", RADIUS[a.cornerRadius] || RADIUS.rounded);
  setVar(root, "--ui-speed", SPEED[a.animSpeed] || SPEED.normal);
  setVar(root, "--sidebar-w", SIDEBAR_W[a.sidebarWidth] || SIDEBAR_W.normal);
  root.style.fontSize = FONT_SCALE[a.fontScale] || FONT_SCALE.normal;

  // A custom accent from Themes wins; otherwise the Branding colour applies.
  const accent = a.uiAccent || fallbackAccent || "#ff7a18";
  const accent2 = a.uiAccent2 || a.uiAccent || "#ffb020";
  setVar(root, "--brand", accent);
  setVar(root, "--brand-2", accent2);
  setVar(root, "--brand-grad", `linear-gradient(135deg,${accent},${accent2})`);
  setVar(root, "--brand-soft", hexToRgba(accent, 0.14));
  // Tailwind v4 utilities read these theme variables, so overriding them here
  // re-colours every `text-brand-*` / `bg-brand-*` class without a rebuild.
  setVar(root, "--color-brand-400", accent);
  setVar(root, "--color-brand-500", accent);
  setVar(root, "--color-brand-600", accent2);

  if (a.panelFont) {
    loadFont(a.panelFont);
    setVar(root, "--font-sans", `"${a.panelFont}", ui-sans-serif, system-ui, sans-serif`);
    setVar(root, "--font-display", `"${a.panelFont}", ui-sans-serif, system-ui, sans-serif`);
  } else {
    setVar(root, "--font-sans", '"Inter", ui-sans-serif, system-ui, sans-serif');
    setVar(root, "--font-display", '"Sora", "Inter", ui-sans-serif, sans-serif');
  }

  const opacity = Math.max(0, Math.min(100, Number(a.wallpaperOpacity) || 100));
  setVar(root, "--wallpaper-opacity", String(opacity / 100));
};

/** #rrggbb → rgba() so accent tints follow the chosen colour. */
export const hexToRgba = (hex: string, alpha: number) => {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return `rgba(255,122,24,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

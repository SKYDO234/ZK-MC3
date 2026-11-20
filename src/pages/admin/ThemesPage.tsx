import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Palette,
  Wand2,
  Paintbrush,
  Droplet,
  Type,
  Image as ImageIcon,
  Eye,
  Save,
  RotateCcw,
  UploadCloud,
  Link2,
  Check,
  Trash2,
  Loader2,
  Sparkles,
  MonitorSmartphone,
  Layers,
  MoveHorizontal,
  Sun,
  Gauge,
  Film,
  CircleDot,
  X,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Card, CardHeader, Button, Field, PageSkeleton } from "../../components/ui";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { useToast } from "../../context/ToastContext";
import { useSettings } from "../../context/SettingsContext";
import { api, uploadFile } from "../../lib/api";
import {
  ACCENT_SWATCHES,
  APPEARANCE_DEFAULTS,
  Appearance,
  FONT_CHOICES,
  STYLE_PRESETS,
  SEGMENTED,
  WALLPAPER_PRESETS,
  applyAppearance,
  loadFont,
} from "../../lib/appearance";

/* ────────────────────────────────────────────────────────────── primitives */

/** A segmented control — the panel's answer to AMC's `.ui-seg` rows. */
const Segmented: React.FC<{
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}> = ({ options, value, onChange, size = "md" }) => (
  <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-white/[0.07] bg-black/40 p-1">
    {options.map((opt) => {
      const active = value === opt.value;
      return (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            "rounded-md font-medium transition " +
            (size === "sm" ? "px-2.5 py-1 text-[0.7rem] " : "px-3 py-1.5 text-[0.74rem] ") +
            (active
              ? "bg-white/[0.11] text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
              : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200")
          }
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

/** One labelled row: name on the left, control on the right. */
const OptionRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ icon, label, hint, children }) => (
  <div className="flex flex-col gap-2 border-b border-white/[0.045] py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-[0.76rem] font-medium text-zinc-200">
        <span className="text-zinc-600">{icon}</span>
        {label}
      </p>
      {hint && <p className="mt-0.5 pl-[22px] text-[0.66rem] leading-relaxed text-zinc-600">{hint}</p>}
    </div>
    <div className="flex-none sm:pl-2">{children}</div>
  </div>
);

/** The eight preset thumbnails — miniature versions of the real layout. */
const STYLE_THUMBS: Record<string, React.CSSProperties> = {
  solid: { background: "#131316" },
  frosted: {
    background:
      "radial-gradient(120% 100% at 15% 10%, rgba(255,122,24,0.28), transparent 55%), linear-gradient(140deg,#191b24,#0d0f14)",
  },
  glass: { background: "linear-gradient(140deg,#1b2133,#2a2140)" },
  minimal: { background: "#0f1012" },
  cyberpunk: {
    background: "linear-gradient(140deg,#05070f,#0b0b18)",
    boxShadow: "inset 0 0 0 1px rgba(0,255,245,0.35)",
  },
  neumorphic: {
    background: "#1a1d24",
    boxShadow: "inset 3px 3px 7px rgba(0,0,0,0.65), inset -2px -2px 6px rgba(255,255,255,0.045)",
  },
  neon: {
    background: "linear-gradient(140deg,#0a0a10,#141021)",
    boxShadow: "inset 0 0 0 1px rgba(255,122,24,0.45), inset 0 0 18px rgba(255,122,24,0.18)",
  },
  terminal: { background: "#000", boxShadow: "inset 0 0 0 1px rgba(0,255,65,0.3)" },
};

const StyleThumb: React.FC<{ id: string }> = ({ id }) => (
  <div
    className="relative flex h-[46px] w-full overflow-hidden rounded-[6px]"
    style={STYLE_THUMBS[id] || STYLE_THUMBS.solid}
  >
    <div
      className="h-full w-[30%] border-r"
      style={{
        background: id === "solid" ? "#0b0b0e" : "rgba(255,255,255,0.05)",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    />
    <div className="flex flex-1 flex-col justify-center gap-1 px-2">
      <span className="h-[3px] w-[65%] rounded-full bg-white/25" />
      <span className="h-[3px] w-[42%] rounded-full bg-white/12" />
      <span className="h-[3px] w-[52%] rounded-full bg-white/8" />
    </div>
  </div>
);

const FONT_PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog · 0123456789";

/* ─────────────────────────────────────────────────────────────────── page */

export const ThemesPage: React.FC = () => {
  useDocumentTitle("Themes & Fonts · ZK-MC3-PANEL");
  const { data, loading } = useApi<any>("/admin/settings");
  const { success, error } = useToast();
  const { refresh: refreshPublic, settings } = useSettings();

  // `draft` is the live preview state; nothing is written until Save.
  const [draft, setDraft] = useState<Appearance>({ ...APPEARANCE_DEFAULTS, ...settings });
  const [saved, setSaved] = useState<Appearance>({ ...APPEARANCE_DEFAULTS, ...settings });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [fontPreview, setFontPreview] = useState<string>(settings.panelFont || "");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    const next: Appearance = { ...APPEARANCE_DEFAULTS };
    (Object.keys(APPEARANCE_DEFAULTS) as Array<keyof Appearance>).forEach((key) => {
      if (data[key] !== undefined && data[key] !== null) (next as any)[key] = data[key];
    });
    setDraft(next);
    setSaved(next);
    setFontPreview(next.panelFont || "");
  }, [data]);

  // Live preview — every change repaints the whole panel immediately.
  useEffect(() => {
    applyAppearance(draft, settings.primaryColor);
  }, [draft, settings.primaryColor]);

  // Restore the last saved appearance when the page unmounts without a save.
  const savedRef = useRef<Appearance>(saved);
  savedRef.current = saved;
  useEffect(() => () => applyAppearance(savedRef.current, settings.primaryColor), []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  const set = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const applyPreset = (id: string) => {
    const preset = STYLE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setDraft((d) => ({ ...d, ...preset.values }));
  };

  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      (Object.keys(APPEARANCE_DEFAULTS) as Array<keyof Appearance>).forEach((key) => {
        payload[key] = draft[key];
      });
      await api("/admin/settings", { method: "PUT", body: payload });
      setSaved({ ...draft });
      await refreshPublic();
      success("Panel UI saved", "Every user now sees the new look.");
    } catch (err: any) {
      error("Save failed", err.message);
    } finally {
      setSaving(false);
    }
  }, [draft, refreshPublic, success, error]);

  const resetAll = () => {
    setDraft({ ...APPEARANCE_DEFAULTS });
    setFontPreview(APPEARANCE_DEFAULTS.panelFont);
    success("Defaults loaded", "Click Save Panel UI to apply them for everyone.");
  };

  /* ---------------------------------------------------- background upload */

  const uploadWallpaper = async (file?: File | null) => {
    if (!file) return;
    const okTypes = /^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm|quicktime))$/;
    if (!okTypes.test(file.type)) {
      error("Unsupported file", "Use JPG, PNG, GIF, WebP, AVIF, MP4 or WebM.");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      error("File too large", "The maximum background size is 200 MB.");
      return;
    }
    setUploading(true);
    setProgress(8);
    const tick = window.setInterval(() => setProgress((p) => Math.min(92, p + 7)), 220);
    try {
      const result = await uploadFile("/admin/settings/wallpaper/upload", file);
      setProgress(100);
      setDraft((d) => ({
        ...d,
        wallpaper: (result as any).wallpaper,
        wallpaperType: (result as any).wallpaperType,
        wallpaperPreset: "",
      }));
      await refreshPublic();
      success("Background applied", file.name);
      setTimeout(() => setProgress(0), 900);
    } catch (err: any) {
      error("Upload failed", err.message);
      setProgress(0);
    } finally {
      window.clearInterval(tick);
      setUploading(false);
    }
  };

  const applyUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      error("Use a direct link", "The URL must start with http:// or https://");
      return;
    }
    const type = /\.(mp4|webm|mov)(\?|$)/i.test(url) ? "video" : "image";
    setDraft((d) => ({ ...d, wallpaper: url, wallpaperType: type, wallpaperPreset: "" }));
    setUrlInput("");
    success("Background applied", "Click Save Panel UI to keep it.");
  };

  const removeWallpaper = async () => {
    try {
      await api("/admin/settings/wallpaper", { method: "DELETE" });
      setDraft((d) => ({ ...d, wallpaper: "", wallpaperType: "", wallpaperPreset: "" }));
      await refreshPublic();
      success("Background removed");
    } catch (err: any) {
      error("Remove failed", err.message);
    }
  };

  const applyGradient = (preset: { id: string; label: string; css: string }) => {
    setDraft((d) => ({ ...d, wallpaper: preset.css, wallpaperType: "preset", wallpaperPreset: preset.id }));
    success("Preset selected", `${preset.label} — save to apply.`);
  };

  /* --------------------------------------------------------------- render */

  if (loading && !data) return <PageSkeleton />;

  const radius = (draft.cornerRadius === "sharp" ? "4px" : draft.cornerRadius === "extra" ? "18px" : "12px");
  const accentBar = `linear-gradient(135deg, ${draft.uiAccent || "#ff7a18"}, ${draft.uiAccent2 || draft.uiAccent || "#ffb020"})`;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Palette size={20} />}
        breadcrumb={[{ label: "Administration" }, { label: "Configuration" }, { label: "Themes & Fonts" }]}
        title="Themes & Fonts"
        subtitle="Customize every visual aspect of the panel. Changes preview live — save to apply them to all users."
        actions={
          <>
            <Button icon={<RotateCcw size={14} />} onClick={resetAll}>
              Reset to default
            </Button>
            <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={saveAll} disabled={!dirty && !saving}>
              Save panel UI
            </Button>
          </>
        }
      />

      {/* ─────────────────────────────────────── panel UI style ─────────── */}
      <Card>
        <CardHeader
          icon={<Wand2 size={16} />}
          title="Panel UI style"
          subtitle="Pick a starting point, then fine-tune every surface below."
          action={
            <span className="zk-badge zk-badge-brand">
              {dirty ? "Unsaved changes" : "In sync"}
            </span>
          }
        />

        <div className="mt-5">
          <p className="zk-eyebrow mb-2.5 flex items-center gap-1.5">
            <Paintbrush size={11} /> UI style preset
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
            {STYLE_PRESETS.map((preset) => {
              const active = draft.uiStyle === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={
                    "group rounded-xl border p-2 text-left transition " +
                    (active
                      ? "border-white/25 bg-white/[0.06]"
                      : "border-white/[0.07] bg-black/20 hover:border-white/15 hover:bg-white/[0.03]")
                  }
                >
                  <StyleThumb id={preset.id} />
                  <p className={"mt-2 truncate text-[0.72rem] font-semibold " + (active ? "text-zinc-50" : "text-zinc-300")}>
                    {preset.label}
                  </p>
                  <p className="truncate text-[0.6rem] text-zinc-600">{preset.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid gap-x-8 border-t border-white/[0.055] pt-1 lg:grid-cols-2">
          <div>
            <OptionRow icon={<MonitorSmartphone size={13} />} label="Sidebar" hint="Navigation rail surface.">
              <Segmented options={SEGMENTED[0].options} value={draft.sidebarStyle} onChange={(v) => set("sidebarStyle", v)} />
            </OptionRow>
            <OptionRow icon={<Layers size={13} />} label="Card style" hint="How every card and panel is drawn.">
              <Segmented options={SEGMENTED[1].options} value={draft.cardStyle} onChange={(v) => set("cardStyle", v)} />
            </OptionRow>
            <OptionRow icon={<MoveHorizontal size={13} />} label="Top bar" hint="Header strip above the page content.">
              <Segmented options={SEGMENTED[2].options} value={draft.topbarStyle} onChange={(v) => set("topbarStyle", v)} />
            </OptionRow>
            <OptionRow icon={<CircleDot size={13} />} label="Corner radius" hint="Rounding applied to surfaces and controls.">
              <Segmented options={SEGMENTED[3].options} value={draft.cornerRadius} onChange={(v) => set("cornerRadius", v)} />
            </OptionRow>
            <OptionRow icon={<MoveHorizontal size={13} />} label="Sidebar width" hint="Rail width on desktop layouts.">
              <Segmented options={SEGMENTED[4].options} value={draft.sidebarWidth} onChange={(v) => set("sidebarWidth", v)} />
            </OptionRow>
          </div>

          <div>
            <OptionRow icon={<Sun size={13} />} label="Border glow" hint="Accent light around cards and stat tiles.">
              <Segmented options={SEGMENTED[5].options} value={draft.cardBorderGlow} onChange={(v) => set("cardBorderGlow", v)} />
            </OptionRow>

            <OptionRow icon={<Droplet size={13} />} label="Glass blur" hint="Backdrop blur strength for every glass surface.">
              <div className="w-[220px] max-w-full">
                <input
                  type="range"
                  min={4}
                  max={40}
                  step={1}
                  value={draft.glassBlur}
                  onChange={(e) => set("glassBlur", Number(e.target.value))}
                  className="zk-range w-full"
                />
                <div className="mt-1 flex items-center justify-between font-mono text-[0.6rem] text-zinc-600">
                  <span>Subtle</span>
                  <span className="text-zinc-400">{draft.glassBlur}px</span>
                  <span>Heavy</span>
                </div>
              </div>
            </OptionRow>

            <OptionRow icon={<Type size={13} />} label="Font scale" hint="Global text size multiplier.">
              <Segmented options={SEGMENTED[6].options} value={draft.fontScale} onChange={(v) => set("fontScale", v)} />
            </OptionRow>
            <OptionRow icon={<Gauge size={13} />} label="Animation speed" hint="Page transitions and hover motion.">
              <Segmented options={SEGMENTED[7].options} value={draft.animSpeed} onChange={(v) => set("animSpeed", v)} />
            </OptionRow>
            <OptionRow icon={<Film size={13} />} label="Motion & effects" hint="Turns every animated flourish off.">
              <Segmented options={SEGMENTED[8].options} value={draft.uiMotion} onChange={(v) => set("uiMotion", v)} />
            </OptionRow>
          </div>
        </div>

        {/* ───────────────────────────────── accent colour ──────────────── */}
        <div className="mt-4 border-t border-white/[0.055] pt-4">
          <p className="zk-eyebrow mb-2.5 flex items-center gap-1.5">
            <Droplet size={11} /> Accent colour
          </p>
          <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3.5">
            <div className="flex flex-wrap gap-2">
              {ACCENT_SWATCHES.map((swatch) => {
                const active = draft.uiAccent === swatch.a && draft.uiAccent2 === swatch.b;
                return (
                  <button
                    key={swatch.name}
                    type="button"
                    title={swatch.name}
                    onClick={() => {
                      setDraft((d) => ({ ...d, uiAccent: swatch.a, uiAccent2: swatch.b }));
                    }}
                    className={
                      "h-8 w-8 rounded-full transition hover:scale-110 " +
                      (active ? "ring-2 ring-white ring-offset-2 ring-offset-[#08080a]" : "ring-1 ring-white/15")
                    }
                    style={{ background: `linear-gradient(135deg, ${swatch.a}, ${swatch.b})` }}
                  />
                );
              })}
            </div>

            <div className="mt-3.5 flex flex-wrap items-end gap-3">
              <div>
                <p className="zk-eyebrow mb-1">Primary</p>
                <input
                  type="color"
                  value={draft.uiAccent || "#ff7a18"}
                  onChange={(e) => set("uiAccent", e.target.value)}
                  className="zk-color h-9 w-12 cursor-pointer"
                />
              </div>
              <div>
                <p className="zk-eyebrow mb-1">Secondary</p>
                <input
                  type="color"
                  value={draft.uiAccent2 || "#ffb020"}
                  onChange={(e) => set("uiAccent2", e.target.value)}
                  className="zk-color h-9 w-12 cursor-pointer"
                />
              </div>
              <div className="min-w-[140px] flex-1">
                <p className="zk-eyebrow mb-1">Preview</p>
                <div className="h-9 rounded-lg ring-1 ring-white/10 transition-[background]" style={{ background: accentBar }} />
              </div>
              <Button
                size="sm"
                icon={<RotateCcw size={12} />}
                onClick={() => {
                  setDraft((d) => ({
                    ...d,
                    uiAccent: APPEARANCE_DEFAULTS.uiAccent,
                    uiAccent2: APPEARANCE_DEFAULTS.uiAccent2,
                  }));
                  success("Accent reset", "Back to the brand orange.");
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* ──────────────────────────────── background + font grid ─────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<ImageIcon size={16} />}
            title="Background"
            subtitle="Upload a still or a looping video, paste a direct link, or pick a gradient."
          />
          <div className="mt-4 space-y-3.5">
            <Field label="Direct link (GIF · MP4 · WebM · JPG · PNG)">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                  <input
                    className="zk-input pl-8 font-mono text-[0.74rem]"
                    placeholder="https://example.com/background.jpg"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyUrl()}
                  />
                </div>
                <Button variant="primary" icon={<Check size={13} />} onClick={applyUrl} disabled={!urlInput.trim()}>
                  Apply
                </Button>
              </div>
            </Field>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                uploadWallpaper(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileRef.current?.click()}
              className={
                "relative cursor-pointer rounded-xl border-2 border-dashed px-4 py-7 text-center transition " +
                (dragging
                  ? "border-white/40 bg-white/[0.06]"
                  : "border-white/12 bg-black/25 hover:border-white/25 hover:bg-white/[0.03]")
              }
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => uploadWallpaper(e.target.files?.[0])}
              />
              <UploadCloud size={22} className="mx-auto text-zinc-500" />
              <p className="mt-2 text-[0.76rem] font-medium text-zinc-300">Click to choose a file</p>
              <p className="mt-0.5 font-mono text-[0.62rem] text-zinc-600">JPG · PNG · GIF · WEBP · AVIF · MP4 · WEBM · max 200 MB</p>
            </div>

            {(uploading || progress > 0) && (
              <div className="rounded-lg border border-white/[0.07] bg-black/30 p-3">
                <div className="flex items-center justify-between text-[0.66rem] font-medium text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    {uploading ? <Loader2 size={11} className="zk-spin" /> : <Check size={11} className="text-emerald-400" />}
                    {uploading ? "Uploading…" : "Upload complete"}
                  </span>
                  <span className="font-mono text-zinc-500">{progress}%</span>
                </div>
                <div className="zk-progress mt-1.5">
                  <span style={{ width: `${progress}%`, background: accentBar }} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button icon={<Check size={13} />} onClick={() => uploadWallpaper(fileRef.current?.files?.[0])} disabled={uploading}>
                Apply file
              </Button>
              {draft.wallpaper && (
                <Button variant="danger" icon={<Trash2 size={13} />} onClick={removeWallpaper}>
                  Remove
                </Button>
              )}
            </div>

            <div className="border-t border-white/[0.055] pt-3">
              <p className="zk-eyebrow mb-2 flex items-center gap-1.5">
                <Sparkles size={11} /> Quick presets
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WALLPAPER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyGradient(preset)}
                    className={
                      "relative h-14 overflow-hidden rounded-lg border text-[0.66rem] font-semibold text-white/90 transition hover:scale-[1.02] " +
                      (draft.wallpaperPreset === preset.id ? "border-white/60" : "border-white/10")
                    }
                    style={{ background: preset.css }}
                  >
                    <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1.5 py-0.5 text-left">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Eye size={16} />} title="Current background" subtitle="Exactly what users see behind the panel." />
            <div
              className="relative mt-4 flex h-[150px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] zk-surface"
              style={{ borderRadius: radius }}
            >
              {draft.wallpaperType === "preset" || (!draft.wallpaper && draft.wallpaperPreset) ? (
                <div className="absolute inset-0" style={{ background: draft.wallpaper }} />
              ) : draft.wallpaper ? (
                /\.(mp4|webm|mov)(\?|$)/i.test(draft.wallpaper) || draft.wallpaperType === "video" ? (
                  <video src={draft.wallpaper} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <img src={draft.wallpaper} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )
              ) : (
                <p className="relative text-[0.7rem] text-zinc-600">No background — flat ink canvas</p>
              )}
              {draft.wallpaper && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />}
              {draft.wallpaper && (
                <p className="absolute bottom-2 left-3 right-3 truncate font-mono text-[0.6rem] text-zinc-400">
                  {draft.wallpaper.startsWith("linear-gradient") ? `gradient · ${draft.wallpaperPreset || "custom"}` : draft.wallpaper}
                </p>
              )}
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-[0.74rem] font-medium text-zinc-300">Background opacity</p>
                <span className="font-mono text-[0.68rem] text-zinc-500">{draft.wallpaperOpacity}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={draft.wallpaperOpacity}
                onChange={(e) => set("wallpaperOpacity", Number(e.target.value))}
                className="zk-range mt-1.5 w-full"
              />
              <div className="flex justify-between font-mono text-[0.6rem] text-zinc-600">
                <span>Subtle</span>
                <span>Full</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Type size={16} />} title="Panel font" subtitle="Applied to headings and body copy across every page." />
            <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/30 p-3.5">
              <p
                className="text-[1.15rem] font-bold text-zinc-50"
                style={{ fontFamily: fontPreview ? `"${fontPreview}", sans-serif` : undefined }}
              >
                {settings.panelName || "ZK-MC3-PANEL"}
              </p>
              <p
                className="mt-1 text-[0.72rem] text-zinc-500"
                style={{ fontFamily: fontPreview ? `"${fontPreview}", sans-serif` : undefined }}
              >
                {FONT_PREVIEW_TEXT}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Choose font" className="min-w-[190px] flex-1">
                <select
                  className="zk-select"
                  value={draft.panelFont}
                  onChange={(e) => {
                    const family = e.target.value;
                    if (family) loadFont(family);
                    setFontPreview(family);
                    set("panelFont", family);
                  }}
                >
                  {FONT_CHOICES.map((family) => (
                    <option key={family || "default"} value={family}>
                      {family || "Default — Inter / Sora"}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                icon={<RotateCcw size={13} />}
                onClick={() => {
                  set("panelFont", "");
                  setFontPreview("");
                }}
              >
                Reset
              </Button>
            </div>
            <p className="mt-2.5 flex items-start gap-1.5 text-[0.64rem] leading-relaxed text-zinc-600">
              <X size={11} className="mt-0.5 flex-none" />
              Gaming faces worth trying: Oxanium, Orbitron, Exo 2, Rajdhani, Audiowide. Fonts load from Google Fonts on demand.
            </p>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] zk-surface px-4 py-3 backdrop-blur-xl">
        <p className="text-[0.72rem] text-zinc-500">
          Preview is live for you only. <span className="text-zinc-300">Save panel UI</span> publishes it to every account.
        </p>
        <div className="flex items-center gap-2">
          <Button icon={<RotateCcw size={14} />} onClick={resetAll}>
            Reset
          </Button>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={saveAll}>
            Save panel UI
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ThemesPage;

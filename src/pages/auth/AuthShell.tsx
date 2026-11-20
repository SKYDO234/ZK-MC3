import React from "react";
import { useSettings } from "../../context/SettingsContext";
import { WallpaperLayer } from "../../components/WallpaperLayer";

/**
 * Auth shell
 * ---------------------------------------------------------------------------
 * The reference sign-in is a single centred card on flat black: logo, product
 * name, one line of positioning, then the form. No split-screen showcase, no
 * glow, no grid. Just the card and a lot of black around it.
 */
export const AuthShell: React.FC<{
  children: React.ReactNode;
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ children, title, subtitle, footer, wide }) => {
  const { settings } = useSettings();

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="zk-app-bg" />
      <WallpaperLayer
        url={settings.wallpaper}
        type={settings.wallpaperType}
        preset={settings.wallpaperPreset}
      />

      <div className={`relative w-full ${wide ? "max-w-[520px]" : "max-w-[400px]"}`}>
        <div className="zk-card px-7 pb-6 pt-7">
          {/* brand block */}
          <div className="flex flex-col items-center text-center">
            <img
              src={settings.logoUrl || "/logo.png"}
              alt=""
              className="h-11 w-11 rounded-lg object-cover"
            />
            <p className="mt-3 text-[1.05rem] font-bold tracking-tight text-zinc-50">
              {settings.panelName}
            </p>
            <p className="mt-1 text-[0.68rem] text-zinc-600">{settings.panelTagline}</p>
          </div>

          <div className="mt-7">
            <h1 className="text-[1.05rem] font-bold tracking-tight text-zinc-50">{title}</h1>
            <p className="mt-1 text-[0.76rem] leading-relaxed text-zinc-500">{subtitle}</p>
          </div>

          <div className="mt-5">{children}</div>

          {footer && <div className="mt-5">{footer}</div>}
        </div>

        <p className="mt-5 text-center text-[0.62rem] text-zinc-700">
          © {new Date().getFullYear()} {settings.panelName} · {settings.companyName}
        </p>
      </div>
    </div>
  );
};

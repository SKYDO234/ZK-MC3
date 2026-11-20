import React from "react";

/**
 * WallpaperLayer
 * ---------------------------------------------------------------------------
 * Renders the operator-chosen panel backdrop behind everything else. Three
 * kinds are supported, exactly what Themes & Fonts can save:
 *
 *   · image  — an uploaded file or a pasted direct URL
 *   · video  — MP4/WebM, muted + looping, autoplay is allowed while muted
 *   · preset — a CSS gradient from the quick preset row
 *
 * The component is purely presentational: opacity, the darkening scrim and the
 * "solid themes hide the wallpaper" rule all live in index.css so the layer
 * cannot drift out of sync with the rest of the theme engine.
 */
export const WallpaperLayer: React.FC<{
  url?: string;
  type?: string;
  preset?: string;
}> = ({ url, type = "", preset = "" }) => {
  if (!url && !preset) return <div className="zk-wallpaper" aria-hidden />;

  if (preset || type === "preset") {
    return (
      <div className="zk-wallpaper" aria-hidden>
        <span
          className="absolute inset-0"
          style={{ background: url, opacity: "var(--wallpaper-opacity)" }}
        />
      </div>
    );
  }

  const isVideo = type === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(url || "");

  return (
    <div className="zk-wallpaper" aria-hidden>
      {isVideo ? (
        <video src={url} autoPlay muted loop playsInline preload="metadata" />
      ) : (
        <img src={url} alt="" loading="lazy" />
      )}
    </div>
  );
};

export default WallpaperLayer;

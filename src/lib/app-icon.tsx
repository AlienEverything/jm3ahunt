// Shared artwork for the generated app icons: a Signal Orange reticle on ink.
export const ICON_BG = "#121316";
export const ICON_ACCENT = "#FF5A1F";

/** `scale` < 1 keeps the mark inside the maskable safe zone. */
export function IconArt({ size, scale = 0.72 }: { size: number; scale?: number }) {
  const ring = size * scale;
  const stroke = Math.max(2, Math.round(size * 0.07));
  const dot = size * 0.16;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: ICON_BG }}>
      <div style={{ position: "relative", width: ring, height: ring, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: ring, border: `${stroke}px solid ${ICON_ACCENT}` }}>
        <div style={{ width: dot, height: dot, borderRadius: dot, background: ICON_ACCENT }} />
      </div>
    </div>
  );
}

"use client";

interface Props {
  isGlobe: boolean;
  onToggle: () => void;
}

export default function GlobeMapToggle({ isGlobe, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className="absolute top-4 right-4 z-30 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/10"
      style={{
        background: "var(--bg-panel)",
        backdropFilter: "blur(20px)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
      }}
    >
      <span>{isGlobe ? "🌍" : "🗺️"}</span>
      <span>{isGlobe ? "Globe" : "Map"}</span>
    </button>
  );
}

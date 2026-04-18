"use client";

import { useState } from "react";
import Link from "next/link";
import VesselSearch from "./VesselSearch";
import type { MapTheme } from "./Map";

interface SidebarProps {
  onSearchSelect?: (r: {
    mmsi: number; name: string | null;
    lat: number | null; lon: number | null;
    last_t: number | null; first_t: number | null;
    is_historical: boolean;
  }) => void;
  theme?: MapTheme;
  onThemeChange?: (t: MapTheme) => void;
  isGlobe?: boolean;
  onGlobeChange?: (v: boolean) => void;
  showSeamarks?: boolean;
  onSeamarksChange?: (v: boolean) => void;
  showEEZ?: boolean;
  onEEZChange?: (v: boolean) => void;
  showLand?: boolean;
  onLandChange?: (v: boolean) => void;
  showLabels?: boolean;
  onLabelsChange?: (v: boolean) => void;
  timelineOpen?: boolean;
  onTimelineToggle?: () => void;
}

// SVG ikoner
const Icon = {
  dark:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  light:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  map:      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  globe:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  flatmap:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="5" width="20" height="14" rx="1"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>,
  anchor:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>,
  border:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3h18v18H3z"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>,
  label:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  monitor:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
};

function ToggleBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      width: "100%", padding: "7px 10px",
      background: active ? "rgba(43,168,200,0.12)" : "rgba(255,255,255,0.03)",
      border: `1px solid ${active ? "rgba(43,168,200,0.4)" : "rgba(255,255,255,0.1)"}`,
      borderRadius: 6,
      color: active ? "#2ba8c8" : "#8aaabb",
      fontSize: 11, fontFamily: "monospace",
      letterSpacing: "0.05em", cursor: "pointer",
      transition: "all 0.15s",
      textAlign: "left",
    }}>
      <span style={{ opacity: active ? 1 : 0.7 }}>{icon}</span>
      {label}
    </button>
  );
}

const SECTION = { fontSize: 9, color: "#6a8899", letterSpacing: "0.8px", textTransform: "uppercase" as const, marginBottom: 6 };

export default function Sidebar({
  onSearchSelect, theme = "dark", onThemeChange,
  isGlobe = false, onGlobeChange,
  showSeamarks, onSeamarksChange,
  showEEZ, onEEZChange,
  showLand, onLandChange,
  showLabels, onLabelsChange,
  timelineOpen = false, onTimelineToggle,
}: SidebarProps) {
  return (
    <div style={{
      width: 220, flexShrink: 0, height: "100%",
      // Glass — matches TimeSlider (bg, border, blur)
      background: "rgba(12, 17, 30, 0.58)",
      backdropFilter: "blur(22px) saturate(1.4)",
      WebkitBackdropFilter: "blur(22px) saturate(1.4)",
      borderRight: "1px solid rgba(255, 255, 255, 0.10)",
      display: "flex", flexDirection: "column",
      position: "relative",
    }}>
      <div aria-hidden style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 1,
        background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent)",
        pointerEvents: "none",
      }} />
      {/* Logo */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "1px", color: "#2ba8c8" }}>AISS</div>
        <div style={{ fontSize: 9, color: "#5a8090", letterSpacing: "0.5px", marginTop: 1 }}>Ocean Evidence Protocol</div>
      </div>

      {/* Search */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {onSearchSelect && <VesselSearch onSelect={onSearchSelect} />}
      </div>

      {/* Timeline toggle */}
      {onTimelineToggle && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <button
            onClick={onTimelineToggle}
            aria-pressed={timelineOpen}
            aria-label={timelineOpen ? "Hide Timeline" : "Show Timeline"}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "8px 10px",
              background: timelineOpen ? "rgba(110, 231, 231, 0.14)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${timelineOpen ? "rgba(110, 231, 231, 0.45)" : "rgba(255,255,255,0.10)"}`,
              borderRadius: 7,
              color: timelineOpen ? "#6EE7E7" : "#cfe3ea",
              fontSize: 11, fontFamily: "monospace",
              letterSpacing: "0.06em", fontWeight: 600,
              cursor: "pointer", transition: "all 160ms",
              textAlign: "left",
            }}
          >
            <span style={{ opacity: timelineOpen ? 1 : 0.8 }}>⏱</span>
            <span>Timeline</span>
            <span style={{
              marginLeft: "auto",
              fontSize: 9, color: timelineOpen ? "#6EE7E7" : "#5a7a8a",
              padding: "1px 6px", borderRadius: 999,
              background: timelineOpen ? "rgba(110, 231, 231, 0.18)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${timelineOpen ? "rgba(110, 231, 231, 0.35)" : "rgba(255,255,255,0.08)"}`,
              letterSpacing: "0.05em",
            }}>{timelineOpen ? "ON" : "OFF"}</span>
          </button>
        </div>
      )}

      {/* Visning */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={SECTION}>View</div>
        {/* Globe / Flat */}
        {onGlobeChange && (
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            {([
              { v: true,  icon: Icon.globe,   label: "Globe" },
              { v: false, icon: Icon.flatmap, label: "Flat"  },
            ]).map(({ v, icon, label }) => (
              <button key={String(v)} onClick={() => onGlobeChange(v)} title={label} style={{
                flex: 1, padding: "6px 4px",
                background: isGlobe === v ? "rgba(43,168,200,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isGlobe === v ? "rgba(43,168,200,0.4)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 5, color: isGlobe === v ? "#2ba8c8" : "#8aaabb",
                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              }}>
                {icon}
                <span style={{ fontSize: 8, letterSpacing: "0.04em" }}>{label}</span>
              </button>
            ))}
          </div>
        )}
        {/* Stil */}
        <div style={{ display: "flex", gap: 4 }}>
          {([
            { key: "dark"  as MapTheme, icon: Icon.dark,  label: "Dark"   },
            { key: "light" as MapTheme, icon: Icon.light, label: "Light"  },
            { key: "map"   as MapTheme, icon: Icon.map,   label: "Roads"  },
          ]).map(({ key, icon, label }) => (
            <button key={key} onClick={() => onThemeChange?.(key)} title={label} style={{
              flex: 1, padding: "6px 4px",
              background: theme === key ? "rgba(43,168,200,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${theme === key ? "rgba(43,168,200,0.4)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 5, color: theme === key ? "#2ba8c8" : "#8aaabb",
              cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
              {icon}
              <span style={{ fontSize: 8, letterSpacing: "0.04em" }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Lag */}
      <div style={{ padding: "10px 12px", flex: 1 }}>
        <div style={SECTION}>Layers</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {onLabelsChange && <ToggleBtn icon={Icon.label}  label="Place names"   active={!!showLabels}   onClick={() => onLabelsChange(!showLabels)} />}
          {onSeamarksChange && <ToggleBtn icon={Icon.anchor} label="OpenSeaMap"   active={!!showSeamarks} onClick={() => onSeamarksChange(!showSeamarks)} />}
          {onEEZChange && <ToggleBtn icon={Icon.border} label="EEZ boundaries" active={!!showEEZ}      onClick={() => onEEZChange(!showEEZ)} />}
        </div>
      </div>

      {/* System Monitor */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <Link href="/health" style={{ textDecoration: "none" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "7px 10px", borderRadius: 6,
            background: "rgba(43,168,200,0.05)",
            border: "1px solid rgba(43,168,200,0.12)", cursor: "pointer",
          }}>
            {Icon.monitor}
            <span style={{ fontSize: 10, fontWeight: 600, color: "#7a9aaa", letterSpacing: "0.5px" }}>System Monitor</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#3a5060" }}>→</span>
          </div>
        </Link>
      </div>
    </div>
  );
}

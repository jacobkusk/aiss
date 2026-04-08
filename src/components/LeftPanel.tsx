"use client";

import { useState } from "react";
import Logo from "./Logo";
import CollectorTile from "./CollectorTile";
import StringBuilderTile from "./StringBuilderTile";
import VesselsTile from "./VesselsTile";
import FilterTile from "./FilterTile";
import TerminalFeed from "./TerminalFeed";
import LiveHistoricalBadge from "./LiveHistoricalBadge";
import SearchInput from "./SearchInput";
import TimeMachine from "./TimeMachine";
import { OVERLAY_LABELS, type Overlays, type MapStyle } from "./MapView";

interface Props {
  onTimeMachineChange: (daysAgo: number) => void;
  isLive: boolean;
  vesselCount: number;
  date: string | null;
  routeCount: number;
  overlays: Overlays;
  onToggleOverlay: (key: string) => void;
  mapStyle: MapStyle;
  onMapStyleChange: (style: MapStyle) => void;
  onClose: () => void;
}

const MAP_STYLES: { key: MapStyle; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "satellite", label: "Satellite" },
];

/* ── Ship type filters (colored, functional) ── */
const SHIP_TYPES: { key: string; label: string; color: string }[] = [
  { key: "cargo", label: "Cargo", color: "#4a8f4a" },
  { key: "tanker", label: "Tanker", color: "#c44040" },
  { key: "passenger", label: "Passenger / Cruise", color: "#4a90d9" },
  { key: "fishing", label: "Fishing", color: "#d4a017" },
  { key: "sailing", label: "Yachts / Sailing", color: "#2ba8c8" },
];

/* ── Navigation status filters (functional) ── */
const NAV_STATUS: { key: string; label: string }[] = [
  { key: "underway", label: "Underway" },
  { key: "anchored", label: "At Anchor" },
];

/* ── Layer toggles ── */
const LAYERS: { key: string; label: string }[] = [
  { key: "predictions", label: "Predictions" },
  { key: "seamarks", label: "Sea Marks" },
  { key: "names", label: "Vessel Names" },
];

/* ── Coming soon / locked filters ── */
const LOCKED_FILTERS: { label: string; items: string[] }[] = [
  { label: "Ship Details", items: ["Gross Tonnage", "Deadweight (DWT)", "Length", "Beam", "TEU Capacity", "Build Year"] },
  { label: "Voyage", items: ["Destination Port", "Destination Country", "Last Port", "Arrival Time (ETA)", "Current Draft (m)", "Load Status"] },
  { label: "Regulatory", items: ["AIS Flag", "Sanctions & Bans", "World Zone"] },
  { label: "Speed", items: ["Speed Range (kn)"] },
];

/* ── Collapsible Section ── */
function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      borderTop: "1px solid rgba(255,255,255,0.08)",
      flexShrink: 0,
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "14px 24px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <span style={{
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "1px",
          color: "rgba(255,255,255,0.35)",
          textTransform: "uppercase",
        }}>
          {title}
        </span>
        <span style={{
          fontSize: "10px",
          color: "rgba(255,255,255,0.25)",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.15s",
        }}>
          ▼
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 24px 14px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Checkbox row ── */
function FilterCheck({ label, checked, color, onChange, locked }: {
  label: string;
  checked: boolean;
  color?: string;
  onChange: () => void;
  locked?: boolean;
}) {
  return (
    <button
      onClick={locked ? undefined : onChange}
      style={{
        background: "transparent",
        border: "none",
        color: locked ? "rgba(255,255,255,0.4)" : checked ? "#ffffff" : "rgba(255,255,255,0.5)",
        fontSize: "12px",
        padding: "5px 0",
        cursor: locked ? "default" : "pointer",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        transition: "all 0.15s",
        opacity: 1,
      }}
    >
      {/* Checkbox */}
      <span style={{
        width: "16px",
        height: "16px",
        borderRadius: "3px",
        border: checked && !locked
          ? `1.5px solid ${color || "#6b8aff"}`
          : "1.5px solid rgba(255,255,255,0.2)",
        background: checked && !locked
          ? (color || "#6b8aff")
          : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "all 0.15s",
      }}>
        {checked && !locked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>

      {/* Color dot for ship types */}
      {color && (
        <span style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: checked && !locked ? color : "rgba(255,255,255,0.15)",
          flexShrink: 0,
          transition: "all 0.15s",
        }} />
      )}

      <span>{label}</span>

      {locked && (
        <span style={{
          marginLeft: "auto",
          fontSize: "9px",
          color: "rgba(255,255,255,0.2)",
          fontWeight: 600,
          letterSpacing: "0.5px",
        }}>
          SOON
        </span>
      )}
    </button>
  );
}

export default function LeftPanel({ onTimeMachineChange, isLive, vesselCount, date, routeCount, overlays, onToggleOverlay, mapStyle, onMapStyleChange, onClose }: Props) {
  return (
    <div
      className="flex flex-col w-[380px] shrink-0 h-full max-md:hidden"
      style={{
        background: "linear-gradient(180deg, #1a1a3e 0%, #0f0f2a 100%)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        overflowY: "auto",
      }}
    >
      <div className="flex items-center justify-between" style={{ flexShrink: 0 }}>
        <Logo />
        <button
          onClick={onClose}
          className="mr-4 flex items-center justify-center w-8 h-8 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "0 16px 12px", flexShrink: 0 }}>
        <LiveHistoricalBadge isLive={isLive} vesselCount={vesselCount} date={date} routeCount={routeCount} />
      </div>
      <TerminalFeed />
      <CollectorTile />
      <StringBuilderTile />
      <VesselsTile />
      <FilterTile />
      <SearchInput onSelect={() => {}} />

      {/* Map Style */}
      <Section title="Map Style">
        <div style={{ display: "flex", gap: "6px" }}>
          {MAP_STYLES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onMapStyleChange(key)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: "6px",
                border: mapStyle === key ? "1px solid rgba(107, 138, 255, 0.4)" : "1px solid rgba(255,255,255,0.1)",
                background: mapStyle === key ? "rgba(107, 138, 255, 0.15)" : "rgba(255,255,255,0.04)",
                color: mapStyle === key ? "#6b8aff" : "rgba(255,255,255,0.45)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      {/* Ship Type */}
      <Section title="Ship Type">
        {SHIP_TYPES.map(({ key, label, color }) => (
          <FilterCheck
            key={key}
            label={label}
            checked={overlays[key] ?? true}
            color={color}
            onChange={() => onToggleOverlay(key)}
          />
        ))}
        {/* Extra types shown but locked */}
        <FilterCheck label="Military / Law Enforcement" checked={false} color="#8b5cf6" onChange={() => {}} locked />
        <FilterCheck label="Tugs / Pilot" checked={false} color="#e07020" onChange={() => {}} locked />
        <FilterCheck label="High-Speed Craft" checked={false} color="#e07020" onChange={() => {}} locked />
        <FilterCheck label="Unknown / Other" checked={false} color="#4a8f4a" onChange={() => {}} locked />
      </Section>

      {/* Navigation Status */}
      <Section title="Navigation Status">
        {NAV_STATUS.map(({ key, label }) => (
          <FilterCheck
            key={key}
            label={label}
            checked={overlays[key] ?? true}
            onChange={() => onToggleOverlay(key)}
          />
        ))}
        <FilterCheck label="Moored" checked={false} onChange={() => {}} locked />
        <FilterCheck label="Not Under Command" checked={false} onChange={() => {}} locked />
        <FilterCheck label="Restricted Maneuverability" checked={false} onChange={() => {}} locked />
        <FilterCheck label="Constrained by Draft" checked={false} onChange={() => {}} locked />
        <FilterCheck label="Aground" checked={false} onChange={() => {}} locked />
      </Section>

      {/* Layers */}
      <Section title="Layers">
        {LAYERS.map(({ key, label }) => (
          <FilterCheck
            key={key}
            label={label}
            checked={overlays[key] ?? false}
            onChange={() => onToggleOverlay(key)}
          />
        ))}
        <FilterCheck label="Density Heatmap" checked={false} onChange={() => {}} locked />
        <FilterCheck label="Weather Overlay" checked={false} onChange={() => {}} locked />
        <FilterCheck label="Ports & Terminals" checked={false} onChange={() => {}} locked />
      </Section>

      {/* Locked filter sections */}
      {LOCKED_FILTERS.map(({ label, items }) => (
        <Section key={label} title={label} defaultOpen={false}>
          {items.map((item) => (
            <FilterCheck key={item} label={item} checked={false} onChange={() => {}} locked />
          ))}
        </Section>
      ))}

      {/* Time Machine — bottom */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "auto", flexShrink: 0 }}>
        <TimeMachine onChange={onTimeMachineChange} isLive={isLive} />
      </div>
    </div>
  );
}

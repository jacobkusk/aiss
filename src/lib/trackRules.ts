/**
 * TRACK VISUALIZATION RULES — aiss.network
 * ─────────────────────────────────────────
 * Single source of truth for all track rendering and anomaly detection.
 * Adjust values here; they propagate automatically to TrackLayer and any
 * future consumers.
 *
 * Sections:
 *   SPEED_COLOR       — ring color by vessel speed
 *   GAPS              — signal loss between waypoints
 *   OUTLIER           — impossible position jumps
 *   LINE_STYLE        — visual weight of each line type
 *   VESSEL_TYPES      — per-type threshold overrides (future)
 *   GEOFENCE          — area rules (future)
 *   ROUTE_PATTERNS    — known repeated routes (future)
 */

// ─── SPEED COLOR ─────────────────────────────────────────────────────────────
// Waypoint ring color = vessel speed at that point.
// Mirrored in SQL (get_vessel_track) — keep in sync.
//
// COG direction dot is hidden when SOG < STATIONARY_KN (vessel not moving).

export const SPEED_COLOR = {
  /** SOG below this → vessel considered stationary → no COG dot, green ring. */
  STATIONARY_KN: 0.5,

  BRACKETS: [
    { maxKn:  0.5, color: "#00e676" }, // green  — stationary / anchored
    { maxKn:  2,   color: "#00e676" }, // green  — manoeuvring / drifting
    { maxKn:  8,   color: "#ffeb3b" }, // yellow — slow ahead
    { maxKn: 15,   color: "#ff9800" }, // orange — cruising
    { maxKn: Infinity, color: "#f44336" }, // red — fast / high speed
  ],
};

// ─── GAPS ────────────────────────────────────────────────────────────────────
// Signal loss between consecutive waypoints.
// Renders as a dashed purple line: last known → first reacquired position.

export const GAP = {
  /** Seconds without a new point before we draw a gap line. */
  THRESHOLD_SEC: 300, // 5 minutes
  COLOR: "#7C3AED",   // purple
};

// ─── OUTLIER DETECTION ───────────────────────────────────────────────────────
// Detects impossible position jumps (bad GPS fix, AIS relay error, spoofing).
// Implied speed between two consecutive points is computed client-side.

export const OUTLIER = {
  /** Fallback implied-speed threshold (knots) when no vessel stats available. */
  DEFAULT_THRESHOLD_KN: 60,

  /** Adaptive threshold: vessel's 95th-pct speed × this factor.
   *  Harbour bus max ~12 kn → threshold ~36 kn. Fast ferry max ~35 kn → 105 kn. */
  MAX_SPEED_FACTOR: 3,

  /** Adaptive threshold: vessel's average moving speed × this factor. */
  AVG_SPEED_FACTOR: 5,

  /** Hard floor — never flag slower than this as an outlier.
   *  Prevents false positives on slow vessels. */
  MIN_THRESHOLD_KN: 20,

  /** Both flanking segments (i-2→i-1 and i+1→i+2) must also be clean
   *  before a skip line is drawn. Prevents skip lines in messy data. */
  REQUIRE_CONTEXT_CONFIRMATION: true,

  /** First point after an outlier segment gets green ring —
   *  its speed was computed relative to a bad fix. */
  RESET_POST_OUTLIER_COLOR: true,
};

// ─── LINE STYLE ──────────────────────────────────────────────────────────────

export const LINE_STYLE = {
  normal:  { width: 1.5, opacity: 0.70, dash: null        as null     },
  gap:     { width: 1.5, opacity: 0.75, dash: [5, 3]      as number[] }, // signal loss — purple
  outlier: { width: 2.0, opacity: 0.80, dash: [4, 3]      as number[] }, // bad fix — red
  skip:    { width: 1.5, opacity: 0.75, dash: [5, 3]      as number[] }, // logical bypass — green
};

// ─── VESSEL TYPE OVERRIDES (future) ─────────────────────────────────────────

export const VESSEL_TYPE_RULES: Record<string, {
  outlierMaxSpeedFactor?: number;
  outlierMinThresholdKn?: number;
}> = {
  // ferry:    { outlierMaxSpeedFactor: 2, outlierMinThresholdKn: 25 },
  // sailing:  { outlierMinThresholdKn: 10 },
  // cargo:    { outlierMaxSpeedFactor: 4 },
};

// ─── GEOFENCE (future) ────────────────────────────────────────────────────────
// Named areas with special rules — harbour entrance, anchorage, speed zone.
//
// export const GEOFENCES: Array<{
//   id: string;
//   name: string;
//   polygon: [number, number][]; // [lon, lat] ring
//   rules: { maxSpeedKn?: number; alertOnEntry?: boolean };
// }> = [];

// ─── ROUTE PATTERNS (future) ─────────────────────────────────────────────────
// Known repeated routes (harbour bus, ferry crossing).
// Distinguishes "expected repetition" from "suspicious repeated pattern".
//
// export const KNOWN_ROUTES: Array<{
//   id: string;
//   name: string;
//   mmsiList?: number[];
//   shipTypes?: number[];
//   corridor: GeoJSON.LineString;
//   toleranceM: number;
// }> = [];

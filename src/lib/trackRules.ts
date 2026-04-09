/**
 * TRACK VISUALIZATION RULES — aiss.network
 * ─────────────────────────────────────────
 * Single source of truth for all track rendering and anomaly detection.
 * Adjust values here; they propagate automatically to TrackLayer and any
 * future consumers.
 *
 * Sections:
 *   GAPS              — signal loss between waypoints
 *   OUTLIER           — bad GPS fixes / impossible position jumps
 *   PREDICTION        — dead reckoning residual scoring
 *   LINE_STYLE        — visual weight of each line type
 *   VESSEL_TYPES      — per-type threshold overrides (future)
 *   GEOFENCE          — area rules (future)
 *   ROUTE_PATTERNS    — known repeated routes (future)
 */

// ─── GAPS ────────────────────────────────────────────────────────────────────

export const GAP = {
  /** Seconds between consecutive waypoints above which we call it a signal gap.
   *  Renders as a dashed line in the destination point's prediction color. */
  THRESHOLD_SEC: 300, // 5 minutes
};

// ─── OUTLIER DETECTION ───────────────────────────────────────────────────────

export const OUTLIER = {
  /** Fallback implied-speed threshold (knots) when no vessel stats available. */
  DEFAULT_THRESHOLD_KN: 60,

  /** Adaptive threshold: vessel's 95th-pct speed × this factor.
   *  Harbour bus max ~12 kn → threshold ~36 kn. Fast ferry max ~35 kn → 105 kn. */
  MAX_SPEED_FACTOR: 3,

  /** Adaptive threshold: vessel's average moving speed × this factor. */
  AVG_SPEED_FACTOR: 5,

  /** Hard floor — never classify slower than this as an outlier,
   *  regardless of vessel stats. Prevents false positives on slow vessels. */
  MIN_THRESHOLD_KN: 20,

  /** Context check: both outer flanking segments (i-2→i-1 and i+2→i+3)
   *  must also be non-outliers before a skip line is drawn.
   *  Prevents skip lines in genuinely messy data sections. */
  REQUIRE_CONTEXT_CONFIRMATION: true,

  /** Points immediately after an outlier segment have their SQL prediction_color
   *  reset to green — the score was computed relative to a bad fix. */
  RESET_POST_OUTLIER_COLOR: true,
};

// ─── PREDICTION SCORING ──────────────────────────────────────────────────────
// Dead reckoning residual: ratio of actual deviation vs predicted distance.
// Computed in SQL (get_vessel_track) via ST_DistanceSphere + LAG(SOG, COG).
// NULL score (first point, stationary, or gap >30 min) → green.

export const PREDICTION = {
  COLORS: [
    { maxScore: 0.15, color: "#00e676" }, // green  — on predicted course
    { maxScore: 0.33, color: "#ffeb3b" }, // yellow — minor deviation
    { maxScore: 0.50, color: "#ff9800" }, // orange — notable course change
    { maxScore: 1.00, color: "#f44336" }, // red    — sharp manoeuvre / anomaly
  ],

  /** SOG below this (knots) → vessel considered stationary → no score computed. */
  STATIONARY_THRESHOLD_KN: 0.5,

  /** Time gap above this (seconds) between consecutive points → no score.
   *  Vessel may have changed course freely during the gap. */
  MAX_GAP_FOR_SCORE_SEC: 1800, // 30 minutes
};

// ─── LINE STYLE ──────────────────────────────────────────────────────────────

export const LINE_STYLE = {
  normal:  { width: 1.5, opacity: 0.70, dash: null     as null },
  gap:     { width: 1.5, opacity: 0.75, dash: [5, 3]  as number[] }, // signal loss — color = prediction_color
  outlier: { width: 1.0, opacity: 0.60, dash: [3, 4]  as number[] }, // bad GPS fix — always red
  skip:    { width: 1.5, opacity: 0.75, dash: [5, 3]  as number[] }, // logical bypass — always green
};

// ─── VESSEL TYPE OVERRIDES (future) ─────────────────────────────────────────
// AIS ship_type codes → custom threshold multipliers.
// Ferries accelerate faster; sailboats rarely exceed 15 kn.
//
// Example:
//   [ship_type: 60-69 = passenger / ferry]  → tighter outlier detection
//   [ship_type: 36-37 = sailing vessel]      → very low min threshold

export const VESSEL_TYPE_RULES: Record<string, {
  outlierMaxSpeedFactor?: number;
  outlierMinThresholdKn?: number;
}> = {
  // ferry:    { outlierMaxSpeedFactor: 2, outlierMinThresholdKn: 25 },
  // sailing:  { outlierMinThresholdKn: 10 },
  // cargo:    { outlierMaxSpeedFactor: 4 },
};

// ─── GEOFENCE (future) ────────────────────────────────────────────────────────
// Named areas with special rules — e.g. harbour entrance, anchorage, speed zone.
// A vessel entering/leaving a geofence triggers an event.
//
// export const GEOFENCES: Array<{
//   id: string;
//   name: string;
//   polygon: [number, number][]; // [lon, lat] ring
//   rules: { maxSpeedKn?: number; alertOnEntry?: boolean };
// }> = [];

// ─── ROUTE PATTERNS (future) ─────────────────────────────────────────────────
// Known repeated routes (e.g. harbour bus line, ferry crossing).
// Used to distinguish "expected repetition" from "suspicious repeated pattern".
//
// export const KNOWN_ROUTES: Array<{
//   id: string;
//   name: string;
//   mmsiList?: number[];       // specific vessels on this route
//   shipTypes?: number[];      // or all vessels of a type
//   corridor: GeoJSON.LineString;
//   toleranceM: number;        // metres deviation before flagging
// }> = [];

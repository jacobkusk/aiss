/**
 * WAYPOINT / TRACK / DOT RULES — aiss.network
 * ───────────────────────────────────────────
 * Single source of truth. Two layers now + one future layer.
 *
 *
 *   1. WP   — the facts         (button: "WP")    — IMPLEMENTED
 *   2. LINE — our interpretation (button: "Line") — NOT YET IMPLEMENTED
 *   3. D·P  — compressed LINE                     — FUTURE
 *
 *
 * ─── 1. WP LAYER ─────────────────────────────────────────────────────────────
 *
 * Every WP is a real CRC-verified AIS fix. We never throw one away, merge them,
 * or invent them. For one vessel they are numbered 1, 2, 3 … N.
 *
 * The WP layer draws three things on the map:
 *
 *     wp        — the waypoint itself (dot)
 *     wp-line   — line between consecutive WPs
 *     wp-rings  — ring around each WP
 *
 * Rule sets govern how these look — all unchanged from before:
 *
 *   ── NUMBERING (seq on each WP) ────────────────────────────────────────
 *
 *     WPs are numbered 1, 2, 3 … N within the current visible time
 *     window, per vessel. The first WP in the window is ALWAYS 1.
 *
 *       • Per vessel      — each boat has its own sequence
 *       • Per time window — move the slider → numbers restart from 1
 *       • NOT per track   — there are no track splits in WP
 *       • NOT per day     — it's per visible window, which OFTEN
 *                           happens to equal one day
 *
 *   ── GAPS on wp-line ────────────────────────────────────────────────────
 *
 *       < 5 min   silent → solid wp-line
 *      5-10 min   silent → SHORT gap, grey, dense dashed
 *     10-20 min   silent → LONG  gap, light grey, sparse dashed
 *       > 20 min  silent → NO wp-line
 *
 *   ── PREDICTION colour (on wp-rings AND on the wp-line segment arriving
 *      at each WP) ───────────────────────────────────────────────────────
 *
 *     Boat doing 10 kn. In 30 s we expect it 154 m ahead. How far off?
 *       ≤ 23 m   → green   (right where we thought)
 *      23-51 m   → yellow  (a little off)
 *      51-77 m   → orange  (noticeably off)
 *      77 m+     → red     (far off / something weird)
 *
 *     → Automatically green when:
 *         • Stationary  (SOG < 0.5 kn)
 *         • First point of track
 *         • Previous gap was > 30 min
 *         • Points < 5 sec apart
 *
 *     Score = distance(expected, actual) / (SOG × 0.514 m/s × dt_sec)
 *     COG is NOT used. COG is purely visual (the arrow on each WP).
 *
 *   ── ENDPOINTS (FROM / TO markers) ─────────────────────────────────────
 *
 *     FROM = filtered[0]          (first WP in the visible range)
 *     TO   = filtered[length - 1] (last  WP in the visible range)
 *
 *     Every WP is a verified fix. The dashed line communicates any gap —
 *     the TO marker always stays on the actual last known position.
 *
 *   ── OUTLIER detection — bad GPS fixes / impossible position jumps.
 *      See the `OUTLIER` constant for thresholds.
 *
 *
 * ─── 2. LINE LAYER (planned — not yet implemented) ───────────────────────────
 *
 * A separate visualisation drawn on top of the WP data. It uses vessel type
 * and harbour geofences to produce a line that is more readable than raw WPs.
 * 99% of viewers look at LINE first.
 *
 *   ── COLOUR (same as WP) ───────────────────────────────────────────────
 *
 *     The LINE uses the SAME PREDICTION COLOURS as WP — green / yellow /
 *     orange / red, computed from the same score. See PREDICTION in the
 *     WP section above. One colour scheme across WP and LINE.
 *
 *   ── GAP DASH (same as WP) ─────────────────────────────────────────────
 *
 *     Same thresholds as the wp-line:
 *        < 5 min   silent → solid
 *       5-10 min   silent → SHORT gap, grey, dense dashed
 *      10-20 min   silent → LONG  gap, light grey, sparse dashed
 *        > 20 min  silent → may split (see VESSEL RULES below)
 *
 *   ── VESSEL RULES (new — only on LINE) ─────────────────────────────────
 *
 *     Fishing (30):          stops all day → keep line, never split
 *     Sailing / Pleasure     drifting is normal → keep line
 *       (36-37):
 *     Tug / pilot (50-59):   short sporadic jobs → keep line
 *     High-speed (40-49):    split on > 20 min silence
 *     Passenger / ferry      split on open-water silence,
 *       (60-69):             ignore harbour silence
 *     Cargo (70-79):         split on > 20 min silence
 *     Tanker (80-89):        split on > 20 min silence
 *
 *   ── HARBOUR RULE (overrides everything) ───────────────────────────────
 *
 *     Inside a known harbour / anchorage: silences are expected, keep the
 *     line, never split. (Implemented via GEOFENCES — future.)
 *
 *
 * ─── 3. D·P LAYER (future) ───────────────────────────────────────────────────
 *
 * Same principles as LINE, just fewer points for fast overview. Not now.
 *
 *
 * ─── Constants & helpers in this file ───────────────────────────────────────
 *
 *   GAP               — wp-line silence thresholds
 *   PREDICTION        — prediction-score colour buckets
 *   LINE_STYLE        — visual weight of each wp-line segment type
 *   OUTLIER           — bad GPS fix detection
 *   ENDPOINTS         — FROM / TO marker placement
 *   VESSEL_TYPE_RULES — per-type rules for the future LINE layer
 *   GEOFENCE          — harbour / area rules (future)
 *   ROUTE_PATTERNS    — known repeated routes (future)
 */

// ─── GAP (wp-line silence thresholds) ────────────────────────────────────────
// See header for the full rules. Values below are what the code reads.

export const GAP = {
  /**
   * Lower threshold: seconds of silence above which we draw a gap segment.
   * Below this → solid line. At or above → SHORT gap (dense dashed).
   */
  lowerThresholdSec(_sogKn: number | null): number {
    return 300; // 5 min — SHORT gap starts here for all vessels
  },

  /** SHORT gap upper boundary: above this (and below LONG_SEC) → LONG gap. */
  SHORT_UPPER_SEC: 600, // 10 min

  /**
   * LONG gap upper boundary: above this → NO LINE.
   * (Unless a vessel-type or geofence rule overrides — see VESSEL_TYPE_RULES.)
   */
  LONG_SEC: 1200, // 20 min

  SHORT_COLOR: "#6b7280", // grey        — SHORT gap (5-10 min, dense dashed)
  LONG_COLOR:  "#9ca3af", // light grey  — LONG  gap (10-20 min, sparse dashed)
};

// ─── ENDPOINTS (FROM / TO markers) ──────────────────────────────────────────
// See header for the rule. Implementation: TrackLayer.buildEndpointGeoJSON.

export const ENDPOINTS = {
  /**
   * FROM marker = filtered[0]          (first waypoint in the visible range)
   * TO   marker = filtered[length - 1] (last  waypoint in the visible range)
   */
  USE_FIRST_LAST_ONLY: true,
};

// ─── OUTLIER DETECTION ───────────────────────────────────────────────────────

export const OUTLIER = {
  /** Fallback implied-speed threshold (knots) when no vessel stats available. */
  DEFAULT_THRESHOLD_KN: 30,

  /** Adaptive threshold: vessel's 95th-pct speed × this factor.
   *  Harbour bus max ~12 kn → threshold ~24 kn. Fast ferry max ~35 kn → 70 kn. */
  MAX_SPEED_FACTOR: 2,

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

// ─── PREDICTION (colours on wp-rings and wp-line) ────────────────────────────
// See header for the full rules. Score is computed in SQL; values below are
// the colour buckets applied to `prediction_color`.

export const PREDICTION = {
  COLORS: [
    { maxScore: 0.15, color: "#00e676" }, // green  — right where we thought
    { maxScore: 0.33, color: "#ffeb3b" }, // yellow — a little off
    { maxScore: 0.50, color: "#ff9800" }, // orange — noticeably off
    { maxScore: 1.00, color: "#f44336" }, // red    — far off / something weird
  ],

  /** SOG below this (knots) → vessel considered stationary → no score computed. */
  STATIONARY_THRESHOLD_KN: 0.5,

  /** Time gap above this (seconds) between consecutive points → no score.
   *  Vessel may have changed course freely during the gap. */
  MAX_GAP_FOR_SCORE_SEC: 1800, // 30 minutes
};

// ─── LINE_STYLE (visual weight of each wp-line segment type) ─────────────────

export const LINE_STYLE = {
  normal:    { width: 1.5, opacity: 0.70, dash: null          as null },
  gap:       { width: 2,   opacity: 0.70, dash: [0.5, 3]      as number[] }, // SHORT gap — dense dashed
  gap_long:  { width: 1.5, opacity: 0.65, dash: [2, 8]        as number[] }, // LONG  gap — sparse dashed
  outlier:   { width: 2.0, opacity: 0.80, dash: [4, 3]        as number[] }, // bad GPS fix
  skip:      { width: 1.5, opacity: 0.75, dash: [5, 3]        as number[] }, // logical bypass
};

// ─── VESSEL_TYPE_RULES (for the future LINE layer) ───────────────────────────
// See header for the rule. NOT yet wired into TrackLayer — the WP layer
// ignores these. They are the documented intent for the future LINE layer.

export interface VesselTypeRule {
  /** Human-readable category name (for the info panel). */
  label: string;

  /** AIS ship_type codes this rule covers. */
  shipTypeCodes: number[];

  /** When > 20 min silent: split into a new track, or keep the line going? */
  splitOnLongGap: boolean;

  /** Inside a known harbour geofence, never break the line regardless of silence. */
  ignoreSilenceInHarbour: boolean;

  /** Outlier detection: vessel's 95th-pct speed × this factor. */
  outlierMaxSpeedFactor?: number;

  /** Outlier detection: hard floor for speed threshold (knots). */
  outlierMinThresholdKn?: number;
}

export const VESSEL_TYPE_RULES: Record<string, VesselTypeRule> = {
  fishing: {
    label: "Fishing",
    shipTypeCodes: [30],
    splitOnLongGap: false,          // stops and starts all day — one track
    ignoreSilenceInHarbour: true,
    outlierMinThresholdKn: 15,
  },

  sailing: {
    label: "Sailing",
    shipTypeCodes: [36],
    splitOnLongGap: false,          // drifting / no engine is normal
    ignoreSilenceInHarbour: true,
    outlierMinThresholdKn: 10,
  },

  pleasure: {
    label: "Pleasure craft",
    shipTypeCodes: [37],
    splitOnLongGap: false,          // weekend use, sporadic reporting
    ignoreSilenceInHarbour: true,
    outlierMinThresholdKn: 15,
  },

  highspeed: {
    label: "High-speed craft",
    shipTypeCodes: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
    splitOnLongGap: true,
    ignoreSilenceInHarbour: true,
    outlierMaxSpeedFactor: 2,
    outlierMinThresholdKn: 45,
  },

  tug: {
    label: "Tug / pilot",
    shipTypeCodes: [50, 52, 53, 54, 55, 56, 57, 58, 59],
    splitOnLongGap: false,          // short sporadic jobs — keep as one track
    ignoreSilenceInHarbour: true,
  },

  passenger: {
    label: "Passenger / ferry",
    shipTypeCodes: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69],
    splitOnLongGap: true,           // split on open-water silence
    ignoreSilenceInHarbour: true,   // but ignore dock-time silence
    outlierMaxSpeedFactor: 2,
    outlierMinThresholdKn: 25,
  },

  cargo: {
    label: "Cargo",
    shipTypeCodes: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
    splitOnLongGap: true,
    ignoreSilenceInHarbour: true,
    outlierMaxSpeedFactor: 2,
    outlierMinThresholdKn: 25,
  },

  tanker: {
    label: "Tanker",
    shipTypeCodes: [80, 81, 82, 83, 84, 85, 86, 87, 88, 89],
    splitOnLongGap: true,
    ignoreSilenceInHarbour: true,
    outlierMaxSpeedFactor: 2,
    outlierMinThresholdKn: 25,
  },
};

/** Default rule when ship_type is unknown or not covered above. */
export const DEFAULT_VESSEL_TYPE_RULE: VesselTypeRule = {
  label: "Unknown",
  shipTypeCodes: [],
  splitOnLongGap: true,             // safer default: honour the > 20 min rule
  ignoreSilenceInHarbour: true,
};

/** Look up the rule for a given AIS ship_type code. */
export function vesselTypeRuleFor(shipType: number | null | undefined): VesselTypeRule {
  if (shipType == null) return DEFAULT_VESSEL_TYPE_RULE;
  for (const rule of Object.values(VESSEL_TYPE_RULES)) {
    if (rule.shipTypeCodes.includes(shipType)) return rule;
  }
  return DEFAULT_VESSEL_TYPE_RULE;
}

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

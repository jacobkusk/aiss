/**
 * TRACK RULES — aiss.network
 * ══════════════════════════
 *
 * This file is the ONE PLACE where we decide how a tracked vessel looks on
 * the map. TrackLayer.tsx reads the constants below and paints accordingly.
 *
 * If you see a track rule explained somewhere else in the code — delete it
 * and point here instead. Rules live in one place, not two.
 *
 *
 *   What are we drawing?
 *   ─────────────────────
 *
 *   Every AIS message from a vessel becomes a "waypoint" (WP): a real, CRC-
 *   verified fix at a real time. We never merge them, invent them, or
 *   throw them away. Click a vessel → we draw its visible waypoints in
 *   order, connected by a line.
 *
 *   Two display modes — a toggle in the sidebar:
 *
 *       "Line" mode  →  just the line  +  FROM / TO markers
 *       "WP"   mode  →  the same line  +  a dot, ring, number and direction
 *                       triangle on every waypoint
 *
 *   WP mode is strictly LINE mode with extra detail layered on top.
 *   Nothing is exclusive to WP mode except those extras.
 *
 *
 *   The line has 4 segment kinds
 *   ─────────────────────────────
 *
 *   Between any two consecutive waypoints, how long was the vessel silent?
 *
 *       ─────   < 5  min silent  →  solid line (normal reporting rate)
 *       · · ·   5–10 min silent  →  short gap  (dense dashes,  medium grey)
 *       ─ ─ ─  10–20 min silent  →  long  gap  (sparse dashes, light  grey)
 *       (blank) > 20 min silent  →  nothing — we treat this as a new track
 *
 *   And tiny arrows — chevrons — point along the direction of travel.
 *   Placement rules live in DIRECTION below: one per N metres of cumulative
 *   track plus one at every colour change.
 *
 *
 *   The line has 4 colours (the "prediction colour")
 *   ─────────────────────────────────────────────────
 *
 *   Imagine a vessel going 10 knots. In 30 s we'd expect it about 154 m
 *   ahead. When the next real fix arrives, how far off was our guess?
 *
 *       GREEN    ≤ 23 m   — right where we thought
 *       YELLOW   23–51 m  — a little off
 *       ORANGE   51–77 m  — noticeably off
 *       RED      > 77 m   — far off / something weird (spoof? GPS glitch?)
 *
 *   The colour paints BOTH the segment arriving at each waypoint AND the
 *   ring around that waypoint. A row of green rings = predictable vessel.
 *   A red ring = the next position surprised us.
 *
 *   Auto-green (no score, treat as predictable) when any of:
 *       • The vessel is basically stopped (SOG < 0.5 kn)
 *       • It's the first point in the window
 *       • The gap before this point was > 30 min
 *       • Points are < 5 sec apart
 *
 *   Score = distance(expected, actual) / (SOG × 0.514 m/s × dt_sec).
 *   Computed in SQL. COG (the little triangle inside each ring) is NOT
 *   used for scoring — it is purely decorative, showing which way the
 *   vessel was pointed at the moment of the fix.
 *
 *
 *   Waypoint numbering (only visible in WP mode)
 *   ─────────────────────────────────────────────
 *
 *   Waypoints are numbered 1, 2, 3 … N within the current visible time
 *   window, per vessel. The first WP in the window is ALWAYS 1.
 *
 *       • Per vessel      — each vessel has its own sequence
 *       • Per time window — move the slider → numbers restart from 1
 *       • NOT per track, NOT per day
 *
 *
 *   Endpoints (FROM / TO markers)
 *   ──────────────────────────────
 *
 *       FROM = first waypoint in the visible time window
 *       TO   = last  waypoint in the visible time window
 *
 *   Every waypoint is a verified fix — a gap before the last one is a
 *   reporting-rate gap, not a data-quality issue. The dashed line already
 *   communicates the gap; TO stays on the actual last known position.
 *
 *
 *   Outliers
 *   ─────────
 *
 *   Sometimes a single GPS fix is clearly wrong — the vessel "teleports"
 *   and comes back. We detect these by implied speed plus a context check,
 *   and draw the skip segment differently. See OUTLIER.
 *
 *
 *   Planned but not implemented
 *   ────────────────────────────
 *
 *   Today the LINE is "just connect the waypoints in order". The future
 *   enhanced LINE will know the vessel type and which harbour it's in, and
 *   apply smarter rules — see VESSEL_TYPE_RULES and GEOFENCES below.
 *   Blocked on populating entities.domain_meta.ship_type for most vessels.
 *
 *   After that: D·P layer — a compressed version of LINE with fewer
 *   points, same look, cheaper to render for long history.
 *
 *
 *   Constants in this file
 *   ───────────────────────
 *
 *       GAP               — 5 / 10 / 20 min silence thresholds
 *       PREDICTION        — colour buckets
 *       LINE_STYLE        — width, opacity, dash pattern per segment type
 *       DIRECTION         — chevron placement
 *       OUTLIER           — bad GPS fix detection
 *       ENDPOINTS         — FROM / TO rule
 *       VESSEL_TYPE_RULES — per-type rules for the future enhanced LINE
 *       GEOFENCES         — harbour rules (future, not yet populated)
 *       KNOWN_ROUTES      — repeated-route detection (future)
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

  SHORT_COLOR: "#a3b1c2", // medium grey — SHORT gap (5-10 min, dense dashed)
  LONG_COLOR:  "#c8d2de", // light grey  — LONG  gap (10-20 min, sparse dashed)
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
  gap:       { width: 2,   opacity: 0.90, dash: [1, 2.5]      as number[] }, // SHORT gap — dense dashed
  gap_long:  { width: 1.75,opacity: 0.85, dash: [2.5, 5]      as number[] }, // LONG  gap — sparse dashed
  outlier:   { width: 2.0, opacity: 0.80, dash: [4, 3]        as number[] }, // bad GPS fix
  skip:      { width: 1.5, opacity: 0.75, dash: [5, 3]        as number[] }, // logical bypass
};

// ─── DIRECTION (chevrons on the line) ────────────────────────────────────────
// See header for placement rule. Values below are what the code reads.

export const DIRECTION = {
  /** One chevron per this many metres of cumulative track distance.
   *  Independent of AIS reporting rate — so cruising (long segments) and
   *  harbour (many short segments) both get even chevron spacing. */
  SPACING_M: 150,

  /** Also fire a chevron whenever prediction_color changes — guarantees
   *  every colour stretch has at least one direction indicator. */
  FIRE_ON_COLOR_CHANGE: true,

  /** Chevron canvas size (px, pre-retina). SDF scales cleanly. */
  ICON_SIZE_PX: 28,

  /** Stroke width as fraction of canvas size — sets chevron slimness. */
  STROKE_FRACTION: 0.08,

  /** icon-size (layout) interpolated by zoom. Zoom → multiplier. */
  ICON_SIZE_BY_ZOOM: [
    [11, 0.55],
    [14, 0.85],
    [18, 1.00],
  ] as const,
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

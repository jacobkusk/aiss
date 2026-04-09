import type { IngestAdapter, NormalizedPoints, ValidationResult, Point } from "../../core/interfaces"

// Konfigurerbare valideringsregler
type ValidationRule = {
  name: string
  fn: (point: Point, prev?: Point) => boolean
}

// Max hastighed per entity type (m/s) — anti-teleportation
const MAX_SPEED_MS: Record<string, number> = {
  vessel: 30,      // ~58 knob
  aircraft: 350,   // ~680 knob
  person: 15,
  vehicle: 70,
  animal: 30,
  default: 100,
}

// Min bevægelse for at acceptere punkt (meter)
const MIN_MOVEMENT_M = 5

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isValidMmsi(mmsi: unknown): boolean {
  if (typeof mmsi !== "number" && typeof mmsi !== "string") return false
  return /^\d{9}$/.test(String(mmsi))
}

export class AisIngestAdapter implements IngestAdapter {
  async normalize(raw: unknown, source: string): Promise<NormalizedPoints> {
    if (!raw || typeof raw !== "object") {
      throw new Error("normalize: raw must be an object")
    }

    const r = raw as Record<string, unknown>

    // Udtræk felter — håndter både rå NMEA-decoded og pre-processed JSON
    const mmsi = r.mmsi ?? r.MMSI
    const lat = Number(r.lat ?? r.latitude ?? r.Latitude ?? 0)
    const lon = Number(r.lon ?? r.longitude ?? r.Longitude ?? 0)
    const sog = Number(r.speed ?? r.sog ?? r.SOG ?? 0)  // knob
    const cog = Number(r.course ?? r.cog ?? r.COG ?? 0)
    const heading = Number(r.heading ?? r.HDG ?? 511)
    const rot = Number(r.rot ?? r.ROT ?? -128)
    const nav_status = r.nav_status ?? r.status
    const timestamp = r.timestamp ? new Date(r.timestamp as string).getTime() : Date.now()

    // Konvertér SOG (knob) → m/s
    const speed_ms = sog * 0.514444

    const point: Point = {
      lon,
      lat,
      alt: 0,  // AIS er altid havniveau
      t: timestamp,
      speed: speed_ms,
      bearing: cog,
      domain_fields: {
        mmsi,
        hdg: heading,
        rot,
        nav_status,
        sog_kn: sog,
      },
    }

    // Entity domain_meta til vessels-tabel
    const entity_domain_meta: Record<string, unknown> = {
      mmsi,
      vessel_type: r.ship_type ?? r.type_and_cargo,
      flag: r.country ?? null,
      vessel_name: r.shipname ?? r.vessel_name ?? null,
      imo: r.imo ?? null,
    }

    return {
      entity_type: "vessel",
      entity_domain_meta,
      points: [point],
      source,
      source_domain: "maritime",
    }
  }

  validate(normalized: NormalizedPoints): ValidationResult {
    const maxSpeed = MAX_SPEED_MS[normalized.entity_type] ?? MAX_SPEED_MS.default
    const accepted: Point[] = []
    const rejected: Array<{ point: Point; reason: string }> = []

    let prev: Point | undefined

    for (const point of normalized.points) {
      const mmsi = point.domain_fields?.mmsi

      // MMSI validering (kun for vessels)
      if (normalized.entity_type === "vessel" && !isValidMmsi(mmsi)) {
        rejected.push({ point, reason: "invalid_mmsi" })
        continue
      }

      // Null Island
      if (point.lat === 0 && point.lon === 0) {
        rejected.push({ point, reason: "null_island" })
        continue
      }

      // Grov koordinat-validering
      if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) {
        rejected.push({ point, reason: "invalid_coordinates" })
        continue
      }

      if (prev) {
        const dist = haversine(prev.lon, prev.lat, point.lon, point.lat)
        const dtSec = (point.t - prev.t) / 1000

        // Anti-teleportation
        if (dtSec > 0) {
          const impliedSpeed = dist / dtSec
          if (impliedSpeed > maxSpeed) {
            rejected.push({ point, reason: "teleportation" })
            continue
          }
        }

        // Skip stationary
        if (dist < MIN_MOVEMENT_M) {
          rejected.push({ point, reason: "stationary" })
          continue
        }
      }

      accepted.push(point)
      prev = point
    }

    return {
      valid: accepted.length > 0,
      accepted,
      rejected,
    }
  }
}

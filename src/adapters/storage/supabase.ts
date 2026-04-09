// Supabase StorageAdapter — eneste fil der må importere @supabase/supabase-js
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type {
  StorageAdapter, Point, SegmentMeta, Track, Segment,
  BBox, Entity, EntityInput
} from "../../core/interfaces"

interface SupabaseConfig {
  url: string
  service_key: string
}

export class SupabaseStorageAdapter implements StorageAdapter {
  private client: SupabaseClient

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.service_key)
  }

  async upsert_entity(entity: EntityInput): Promise<string> {
    const { data, error } = await this.client
      .from("entities")
      .insert({
        entity_type: entity.entity_type,
        display_name: entity.display_name ?? null,
        domain_meta: entity.domain_meta ?? {},
      })
      .select("entity_id")
      .single()

    if (error) throw new Error(`upsert_entity failed: ${error.message}`)
    return data.entity_id
  }

  async get_entity(entity_id: string): Promise<Entity | null> {
    const { data, error } = await this.client
      .from("entities")
      .select("*")
      .eq("entity_id", entity_id)
      .single()

    if (error || !data) return null
    return {
      entity_id: data.entity_id,
      entity_type: data.entity_type,
      display_name: data.display_name ?? undefined,
      domain_meta: data.domain_meta ?? {},
      created_at: new Date(data.created_at).getTime(),
      updated_at: new Date(data.updated_at).getTime(),
    }
  }

  async upsert_segment(
    entity_id: string,
    points: Point[],
    metadata: SegmentMeta
  ): Promise<string> {
    if (points.length === 0) throw new Error("upsert_segment: points cannot be empty")

    // Byg WKT for MULTILINESTRINGZM med M=unix timestamp ms
    const coords = points
      .map(p => `${p.lon} ${p.lat} ${p.alt} ${p.t}`)
      .join(", ")
    const wkt = `MULTILINESTRING ZM ((${coords}))`

    // Upsert entity_last
    await this.client.from("entity_last").upsert({
      entity_id,
      lat: points[points.length - 1].lat,
      lon: points[points.length - 1].lon,
      alt: points[points.length - 1].alt,
      speed: points[points.length - 1].speed,
      bearing: points[points.length - 1].bearing,
      t: new Date(points[points.length - 1].t).toISOString(),
      source: metadata.source,
      updated_at: new Date().toISOString(),
    }, { onConflict: "entity_id" })

    // Indsæt track-segment
    const { data, error } = await this.client
      .from("tracks")
      .insert({
        entity_id,
        track: wkt,
        source: metadata.source,
        source_domain: metadata.source_domain ?? null,
        latency_class: metadata.latency_class ?? "low",
        gap_metadata: metadata.gap_before_sec != null
          ? [{ gap_before_sec: metadata.gap_before_sec, gap_reason: metadata.gap_reason ?? "unknown" }]
          : [],
      })
      .select("track_id")
      .single()

    if (error) throw new Error(`upsert_segment failed: ${error.message}`)
    return data.track_id
  }

  async get_track(entity_id: string, from_ts: number, to_ts: number): Promise<Track> {
    const { data, error } = await this.client
      .from("tracks")
      .select("track_id, entity_id, source, source_domain, merkle_root, permanent_address, created_at, track")
      .eq("entity_id", entity_id)
      .gte("created_at", new Date(from_ts).toISOString())
      .lte("created_at", new Date(to_ts).toISOString())
      .order("created_at", { ascending: true })

    if (error) throw new Error(`get_track failed: ${error.message}`)

    const segments: Segment[] = (data ?? []).map((row: any, idx: number) => ({
      segment_index: idx,
      points: [],  // PostGIS dump sker i dedikeret RPC — her returnerer vi metadata
      meta: {
        source: row.source,
        source_domain: row.source_domain ?? undefined,
      },
      hash: row.merkle_root ? new Uint8Array(row.merkle_root) : undefined,
    }))

    return {
      track_id: data?.[0]?.track_id ?? entity_id,
      entity_id,
      segments,
      source: data?.[0]?.source ?? "unknown",
      source_domain: data?.[0]?.source_domain ?? undefined,
      permanent_address: data?.[0]?.permanent_address ?? undefined,
      created_at: data?.[0] ? new Date(data[0].created_at).getTime() : Date.now(),
    }
  }

  async search(bbox: BBox, from_ts: number, to_ts: number, entity_type?: string): Promise<Entity[]> {
    const bboxWkt = `POLYGON((${bbox.min_lon} ${bbox.min_lat}, ${bbox.max_lon} ${bbox.min_lat}, ${bbox.max_lon} ${bbox.max_lat}, ${bbox.min_lon} ${bbox.max_lat}, ${bbox.min_lon} ${bbox.min_lat}))`

    let query = this.client
      .from("entity_last")
      .select(`
        entity_id,
        lat, lon, alt, speed, bearing, t, source,
        entities!inner(entity_id, entity_type, display_name, domain_meta, created_at, updated_at)
      `)
      .gte("t", new Date(from_ts).toISOString())
      .lte("t", new Date(to_ts).toISOString())

    if (entity_type) {
      query = query.eq("entities.entity_type", entity_type)
    }

    const { data, error } = await query
    if (error) throw new Error(`search failed: ${error.message}`)

    return (data ?? []).map((row: any) => ({
      entity_id: row.entity_id,
      entity_type: row.entities?.entity_type ?? "unknown",
      display_name: row.entities?.display_name ?? undefined,
      domain_meta: row.entities?.domain_meta ?? {},
      created_at: new Date(row.entities?.created_at ?? 0).getTime(),
      updated_at: new Date(row.entities?.updated_at ?? 0).getTime(),
    }))
  }
}

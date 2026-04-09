// AISS Core Interfaces — teknologi-agnostisk fundament
// Ingen imports af Supabase, Arweave, Protobuf eller andre libraries her

export interface Point {
  lon: number
  lat: number
  alt: number        // meter: 0=havniveau, +=luft, -=undervand
  t: number          // unix timestamp ms
  speed: number      // m/s
  bearing: number    // grader 0-360
  domain_fields?: Record<string, unknown>
}

export interface SegmentMeta {
  source: string           // "ais" | "radar" | "gps" | "manual" | "import"
  source_domain?: string   // "maritime" | "aviation" | "land" | "space" | "subsea"
  latency_class?: string   // "low" | "high" | "archive"
  gap_before_sec?: number
  gap_reason?: "planned" | "signal_lost" | "unknown"
  last_known_state?: { speed: number; bearing: number; t: number }
}

export interface Track {
  track_id: string
  entity_id: string
  segments: Segment[]
  source: string
  source_domain?: string
  merkle_root?: Uint8Array
  permanent_address?: string
  created_at: number  // unix ms
}

export interface Segment {
  segment_index: number
  points: Point[]
  meta: SegmentMeta
  hash?: Uint8Array
}

export interface BBox {
  min_lon: number
  min_lat: number
  max_lon: number
  max_lat: number
}

export interface Entity {
  entity_id: string
  entity_type: string
  display_name?: string
  domain_meta: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface EntityInput {
  entity_type: string
  display_name?: string
  domain_meta?: Record<string, unknown>
}

export interface SegmentHash {
  segment_index: number
  hash: Uint8Array
}

export interface MerkleRoot {
  root: Uint8Array
  leaf_hashes: Uint8Array[]
}

export interface TimestampProof {
  method: "opentimestamps" | "rfc3161" | "chainpoint"
  proof_data: Uint8Array
  blockchain?: string
  block_height?: number
  anchored_at?: number  // unix ms
}

export interface VerificationResult {
  valid: boolean
  reason?: string
  details?: Record<string, unknown>
}

export interface Tag {
  name: string
  value: string
}

export interface NormalizedPoints {
  entity_type: string
  entity_domain_meta: Record<string, unknown>
  points: Point[]
  source: string
  source_domain: string
}

export interface ValidationResult {
  valid: boolean
  accepted: Point[]
  rejected: Array<{ point: Point; reason: string }>
}

// Adapter interfaces

export interface StorageAdapter {
  upsert_segment(entity_id: string, points: Point[], metadata: SegmentMeta): Promise<string>
  get_track(entity_id: string, from_ts: number, to_ts: number): Promise<Track>
  search(bbox: BBox, from_ts: number, to_ts: number, entity_type?: string): Promise<Entity[]>
  get_entity(entity_id: string): Promise<Entity | null>
  upsert_entity(entity: EntityInput): Promise<string>
}

export interface SignatureAdapter {
  sign_segment(points: Point[]): Promise<SegmentHash>
  build_merkle_root(segment_hashes: SegmentHash[]): Promise<MerkleRoot>
  verify(file: Uint8Array): Promise<VerificationResult>
}

export interface TimestampAdapter {
  timestamp(merkle_root: Uint8Array): Promise<TimestampProof>
  verify(merkle_root: Uint8Array, proof: TimestampProof): Promise<VerificationResult>
}

export interface PermanentStorageAdapter {
  store(file: Uint8Array, tags: Tag[]): Promise<string>
  retrieve(address: string): Promise<Uint8Array>
  verify_permanent(address: string): Promise<boolean>
}

export interface IngestAdapter {
  normalize(raw: unknown, source: string): Promise<NormalizedPoints>
  validate(points: NormalizedPoints): ValidationResult
}

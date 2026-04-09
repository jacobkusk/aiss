// .aiss v1 format — TypeScript-first, Protobuf-kompatibel struktur
// Magic bytes: 0x41 0x49 0x53 0x53 ("AISS")

export const AISS_MAGIC = new Uint8Array([0x41, 0x49, 0x53, 0x53])
export const AISS_FORMAT_VERSION = "1.0.0"

export interface RecipientKey {
  recipient_id: string
  encrypted_dek: Uint8Array
  key_algorithm: string  // "ecdh-p256" (NIST-godkendt)
}

export interface AissHeader {
  entity_id: string
  entity_type: string
  domain_metadata: Uint8Array   // JSON bytes
  created_at: number            // unix ms
  merkle_root: Uint8Array
  format_version: string

  // Vault — tomme i åben mode
  encryption_algorithm: string  // "" | "aes-256-gcm"
  recipient_keys: RecipientKey[]
  jurisdiction: string
}

export interface AissPoint {
  lon: number
  lat: number
  alt: number
  t: number         // unix ms
  speed: number
  bearing: number
  domain_fields: Uint8Array  // JSON bytes
}

export interface AissSegment {
  segment_index: number
  gap_before_sec: number
  gap_reason: string    // "planned" | "signal_lost" | "unknown"
  source: string
  source_domain: string
  points: AissPoint[]
  segment_hash: Uint8Array
  last_known_state: Uint8Array  // JSON bytes
}

export interface MerkleEvent {
  hash: Uint8Array
  method: string        // "sha256"
  timestamp: number     // unix ms
}

export interface AissChain {
  events: MerkleEvent[]
}

export interface AissSignature {
  sha256_merkle_root: Uint8Array
  signed_at: number     // unix ms
  opentimestamps_proof: Uint8Array

  // eIDAS placeholders — tomme i v1
  qtsp_signature: Uint8Array
  qtsp_certificate_chain: Uint8Array
  rfc3161_timestamp_token: Uint8Array
  qtsp_provider: string
  external_signature_uri: string
}

export interface AissFile {
  version: number       // 1
  header: AissHeader
  segments: AissSegment[]
  chain: AissChain
  signature: AissSignature
}

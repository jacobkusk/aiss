// ─────────────────────────────────────────────────────────────────────────────
// .aiss PROTOCOL SCAFFOLDING — not yet wired into any runtime path.
//
// This factory + the src/adapters/ + src/formats/aiss/v1/ tree together form
// the planned foundation for the .aiss file format (magic bytes "AISS",
// Merkle-root signed, per-recipient encryption). See src/formats/aiss/v1/
// schema.ts for the structural definition.
//
// Nothing calls these factories today. Do NOT delete as dead code —
// they are the implementation target for aiss:full.
// ─────────────────────────────────────────────────────────────────────────────

import { SupabaseStorageAdapter } from "../adapters/storage/supabase"
import { Sha256MerkleSignatureAdapter } from "../adapters/signature/sha256merkle"
import { AisIngestAdapter } from "../adapters/ingest/ais"
import type { StorageAdapter, SignatureAdapter, IngestAdapter } from "./interfaces"

export function createStorageAdapter(): StorageAdapter {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) throw new Error("Missing Supabase config")

  return new SupabaseStorageAdapter({ url, service_key: key })
}

export function createSignatureAdapter(): SignatureAdapter {
  return new Sha256MerkleSignatureAdapter()
}

export function createAisIngestAdapter(): IngestAdapter {
  return new AisIngestAdapter()
}

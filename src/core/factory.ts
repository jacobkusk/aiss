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

import type { AissFile, AissHeader, AissSegment, AissPoint } from "./schema"
export type { AissFile, AissHeader, AissSegment, AissPoint, AissSignature, AissChain, MerkleEvent, RecipientKey } from "./schema"
export { AISS_MAGIC, AISS_FORMAT_VERSION } from "./schema"

// Serialisering — JSON-baseret v1, Protobuf-klar struktur
// Protobuf bindings tilføjes i v1.1 uden breaking change

function uint8ToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64")
}

function base64ToUint8(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64"))
}

function serializeForJson(obj: unknown): unknown {
  if (obj instanceof Uint8Array) return uint8ToBase64(obj)
  if (Array.isArray(obj)) return obj.map(serializeForJson)
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serializeForJson(v)])
    )
  }
  return obj
}

export function serialize(file: AissFile): Uint8Array {
  const { AISS_MAGIC } = require("./schema")
  const version = new Uint8Array([file.version])
  const json = JSON.stringify(serializeForJson(file))
  const body = new TextEncoder().encode(json)
  const result = new Uint8Array(4 + 1 + body.length)
  result.set(AISS_MAGIC, 0)
  result.set(version, 4)
  result.set(body, 5)
  return result
}

export function deserialize(data: Uint8Array): AissFile {
  const { AISS_MAGIC } = require("./schema")

  // Verificér magic bytes
  for (let i = 0; i < 4; i++) {
    if (data[i] !== AISS_MAGIC[i]) {
      throw new Error("Not an AISS file — invalid magic bytes")
    }
  }

  const version = data[4]
  if (version !== 1) throw new Error(`Unsupported AISS version: ${version}`)

  const json = new TextDecoder().decode(data.slice(5))
  return JSON.parse(json) as AissFile
}

export function create_empty(entity_id: string, entity_type: string): AissFile {
  const { AISS_FORMAT_VERSION } = require("./schema")
  return {
    version: 1,
    header: {
      entity_id,
      entity_type,
      domain_metadata: new TextEncoder().encode("{}"),
      created_at: Date.now(),
      merkle_root: new Uint8Array(32),
      format_version: AISS_FORMAT_VERSION,
      encryption_algorithm: "",
      recipient_keys: [],
      jurisdiction: "",
    },
    segments: [],
    chain: { events: [] },
    signature: {
      sha256_merkle_root: new Uint8Array(32),
      signed_at: 0,
      opentimestamps_proof: new Uint8Array(0),
      qtsp_signature: new Uint8Array(0),
      qtsp_certificate_chain: new Uint8Array(0),
      rfc3161_timestamp_token: new Uint8Array(0),
      qtsp_provider: "",
      external_signature_uri: "",
    },
  }
}

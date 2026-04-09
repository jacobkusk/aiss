import { createHash } from "crypto"
import type { SignatureAdapter, Point, SegmentHash, MerkleRoot, VerificationResult } from "../../core/interfaces"

export class Sha256MerkleSignatureAdapter implements SignatureAdapter {
  async sign_segment(points: Point[]): Promise<SegmentHash> {
    const content = points.map(p =>
      `${p.lon},${p.lat},${p.alt},${p.t},${p.speed},${p.bearing}`
    ).join("|")

    const hash = createHash("sha256").update(content).digest()

    return {
      segment_index: 0,  // sættes af caller
      hash: new Uint8Array(hash),
    }
  }

  async build_merkle_root(segment_hashes: SegmentHash[]): Promise<MerkleRoot> {
    if (segment_hashes.length === 0) {
      return {
        root: new Uint8Array(32),
        leaf_hashes: [],
      }
    }

    const leaves = segment_hashes
      .sort((a, b) => a.segment_index - b.segment_index)
      .map(s => s.hash)

    const root = this._merkle_root(leaves)

    return {
      root,
      leaf_hashes: leaves,
    }
  }

  private _merkle_root(hashes: Uint8Array[]): Uint8Array {
    if (hashes.length === 1) return hashes[0]

    const next: Uint8Array[] = []
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i]
      const right = i + 1 < hashes.length ? hashes[i + 1] : left  // duplikér sidst hvis ulige
      const combined = new Uint8Array(left.length + right.length)
      combined.set(left, 0)
      combined.set(right, left.length)
      next.push(new Uint8Array(createHash("sha256").update(combined).digest()))
    }

    return this._merkle_root(next)
  }

  async verify(file: Uint8Array): Promise<VerificationResult> {
    try {
      const { deserialize } = await import("../../formats/aiss/v1/index")
      const aissFile = deserialize(file)

      if (!aissFile.signature?.sha256_merkle_root) {
        return { valid: false, reason: "No merkle root in file" }
      }

      // Genberegn merkle root fra segment hashes
      const segmentHashes = aissFile.segments.map((seg, idx) => ({
        segment_index: idx,
        hash: seg.segment_hash,
      }))

      const computed = await this.build_merkle_root(segmentHashes)
      const stored = aissFile.signature.sha256_merkle_root

      const matches = computed.root.every((b, i) => b === stored[i])

      return {
        valid: matches,
        reason: matches ? undefined : "Merkle root mismatch — file may have been tampered",
        details: {
          stored_root: Buffer.from(stored).toString("hex"),
          computed_root: Buffer.from(computed.root).toString("hex"),
        }
      }
    } catch (e: unknown) {
      return { valid: false, reason: `Verification error: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
}

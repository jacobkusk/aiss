# Permanent Storage Adapter

Interface: PermanentStorageAdapter (se /src/core/interfaces/index.ts)

Planlagt implementation: Arweave via Irys
- Betaling i USDC via Irys (ingen AR-token direkte)
- Upload: irys.xyz API fra Edge Function
- Fallback: Cloudflare R2 som buffer

Vigtigt: vault-data krypteres FØR upload — Arweave er permanent,
nøgle-rotation skal designes fra dag 1.

# Timestamp Adapter

Interface: TimestampAdapter (se /src/core/interfaces/index.ts)

Planlagt implementation: OpenTimestamps (Bitcoin, gratis)
- JS library: opentimestamps (npm)
- Batch per time — én Merkle-rod forankres på Bitcoin ~hvert 10. min
- Offline verificerbar — ingen netværksadgang nødvendig til verifikation
- Forankring på Bitcoin + Ethereum parallelt for redundans

Fremtidig: RFC 3161 (eIDAS QTSP-certificeret TSA)

# Vault Adapter

Interface: se /src/core/interfaces/index.ts

Planlagt implementation: libsodium (client-side)
- Envelope encryption: data-krypteringsnøgle (DEK) krypteret med brugers KEK
- Algoritme: AES-256-GCM (NIST-godkendt — kræves af forsvarskunder)
- Nøgleudveksling: ECDH P-256 (NIST-godkendt)
- Multi-recipient: DEK krypteres med N modtagers public keys
- Zero-knowledge: server modtager aldrig plaintext

Certificeringer der kræver NIST: NATO STANAG, EU forsvarsgodkendelse

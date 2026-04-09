# Player Adapter

Interface: se /src/core/interfaces/index.ts

Planlagt implementation: CesiumJS + Deck.gl
- CesiumJS (Apache 2.0): 3D globe, terrain, atmosfære
- Deck.gl TripsLayer: tusindvis af samtidige tracks, hardware-accelereret
- Z-akse nativ: skibe (0), fly (>0), undervand (<0), rum (>>0)
- VIGTIGT: dynamic import med ssr: false — Cesium er browser-only

Alternativ overvejet: MapLibre GL JS — fravalgt pga. Z-akse er hack

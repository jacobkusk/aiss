import Link from "next/link";
import CopyButton from "@/components/CopyButton";

async function getSigningKey(): Promise<string | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/aiss-signing-keys`,
      {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
        next: { revalidate: 86400 },
      }
    );
    const data = await res.json();
    const rootKey = data.keys?.find((k: { key_type: string }) => k.key_type === "root");
    return rootKey?.public_key ?? null;
  } catch {
    return null;
  }
}

const NAV = [
  { id: "intro", label: "Introduction" },
  { id: "endpoints", label: "Endpoints", children: [
    { id: "ep-vessels",       label: "GET /vessels" },
    { id: "ep-vessel",        label: "GET /vessel/:mmsi" },
    { id: "ep-voyage",        label: "GET /voyage/:id" },
    { id: "ep-voyage-mmsi",   label: "GET /voyage/by-mmsi" },
    { id: "ep-voyage-multi",  label: "GET /voyage/multi" },
    { id: "ep-stations",      label: "GET /stations" },
    { id: "ep-anomalies",     label: "GET /anomalies" },
    { id: "ep-ingest",        label: "POST /ingest" },
    { id: "ep-verify",        label: "POST /verify" },
    { id: "ep-signing-keys",  label: "GET /.well-known/…" },
  ]},
  { id: "format",    label: ".aiss Format" },
  { id: "fair-use",  label: "Fair Use" },
  { id: "rate-limits", label: "Rate Limits" },
];

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  void lang;
  return (
    <div style={{ position: "relative", marginTop: "10px" }}>
      <div style={{
        position: "absolute", top: "10px", right: "12px", zIndex: 1,
      }}>
        <CopyButton text={code.trim()} />
      </div>
      <pre style={{
        margin: 0,
        padding: "16px 48px 16px 16px",
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "8px",
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#a0b4ff",
        lineHeight: 1.75,
        overflowX: "auto",
        whiteSpace: "pre",
      }}>
        {code.trim()}
      </pre>
    </div>
  );
}

function Method({ type }: { type: "GET" | "POST" }) {
  const color = type === "GET" ? "#2ba8c8" : "#6b8aff";
  const bg = type === "GET" ? "rgba(43,168,200,0.12)" : "rgba(107,138,255,0.12)";
  return (
    <span style={{
      fontFamily: "monospace", fontSize: "11px", fontWeight: 700,
      color, background: bg, border: `1px solid ${color}40`,
      borderRadius: "4px", padding: "2px 7px", marginRight: "10px", letterSpacing: "0.05em",
    }}>
      {type}
    </span>
  );
}

function Endpoint({ id, method, path, description, params, curl, response }: {
  id: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  params?: { name: string; desc: string }[];
  curl: string;
  response: string;
}) {
  return (
    <div id={id} style={{ paddingTop: "48px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "10px" }}>
        <Method type={method} />
        <code style={{ fontFamily: "monospace", fontSize: "15px", color: "#fff", fontWeight: 600 }}>
          {path}
        </code>
      </div>
      <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.55)", margin: "0 0 16px", lineHeight: 1.6 }}>
        {description}
      </p>

      {params && params.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "8px" }}>
            Parameters
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {params.map((p) => (
              <div key={p.name} style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
                <code style={{ fontFamily: "monospace", color: "#6b8aff", minWidth: "100px", flexShrink: 0 }}>{p.name}</code>
                <span style={{ color: "rgba(255,255,255,0.45)" }}>{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "4px" }}>
        Example
      </div>
      <CodeBlock code={curl} />

      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "4px", marginTop: "16px" }}>
        Response
      </div>
      <CodeBlock code={response} lang="json" />
    </div>
  );
}

export default async function DocsPage() {
  const signingKey = await getSigningKey();

  return (
    <div className="docs-shell" style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #1a1a3e 0%, #0f0f2a 60%, #080818 100%)",
      color: "#ffffff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
    }}>

      {/* Mobile top bar — visible below 900px only */}
      <details className="docs-mobile-nav">
        <summary>
          <Link href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff", letterSpacing: "-0.5px" }}>AISs</span>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>API REFERENCE</span>
          </Link>
          <span className="docs-mobile-burger" aria-hidden="true">≡</span>
        </summary>
        <nav>
          {NAV.map((item) => (
            <div key={item.id}>
              <a href={`#${item.id}`} className="docs-nav-link" style={{
                display: "block",
                fontSize: "14px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.7)",
                textDecoration: "none",
                padding: "8px 10px",
                borderRadius: "6px",
              }}>
                {item.label}
              </a>
              {"children" in item && item.children && (
                <div style={{ paddingLeft: "12px", display: "flex", flexDirection: "column", gap: "1px" }}>
                  {item.children.map((child) => (
                    <a key={child.id} href={`#${child.id}`} className="docs-nav-child" style={{
                      display: "block",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      color: "rgba(255,255,255,0.4)",
                      textDecoration: "none",
                      padding: "5px 10px",
                      borderRadius: "4px",
                    }}>
                      {child.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </details>

      {/* Desktop sidebar — hidden below 900px */}
      <aside className="docs-sidebar" style={{
        width: "220px",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        height: "100vh",
        overflowY: "auto",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        padding: "32px 0",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{ padding: "0 24px", marginBottom: "32px" }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", letterSpacing: "-0.5px" }}>AISs</span>
          </Link>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "2px", letterSpacing: "0.08em" }}>API REFERENCE</div>
        </div>

        <nav style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV.map((item) => (
            <div key={item.id}>
              <a href={`#${item.id}`} className="docs-nav-link" style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(255,255,255,0.6)",
                textDecoration: "none",
                padding: "5px 8px",
                borderRadius: "6px",
              }}>
                {item.label}
              </a>
              {"children" in item && item.children && (
                <div style={{ paddingLeft: "12px", display: "flex", flexDirection: "column", gap: "1px" }}>
                  {item.children.map((child) => (
                    <a key={child.id} href={`#${child.id}`} className="docs-nav-child" style={{
                      display: "block",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      color: "rgba(255,255,255,0.35)",
                      textDecoration: "none",
                      padding: "3px 8px",
                      borderRadius: "4px",
                    }}>
                      {child.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <style>{`
        .docs-nav-link:hover { color: #ffffff !important; }
        .docs-nav-child:hover { color: #6b8aff !important; }
        .docs-mobile-nav { display: none; }
        .docs-mobile-nav summary::-webkit-details-marker { display: none; }
        .docs-mobile-nav summary { list-style: none; }

        @media (max-width: 900px) {
          .docs-shell { flex-direction: column !important; }
          .docs-sidebar { display: none !important; }
          .docs-main { max-width: 100% !important; padding: 24px 20px 80px !important; }
          .docs-mobile-nav {
            display: block;
            position: sticky;
            top: 0;
            z-index: 10;
            background: rgba(15, 15, 42, 0.92);
            -webkit-backdrop-filter: blur(8px);
            backdrop-filter: blur(8px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }
          .docs-mobile-nav summary {
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 20px;
          }
          .docs-mobile-burger {
            font-size: 22px;
            color: rgba(255, 255, 255, 0.5);
            line-height: 1;
          }
          .docs-mobile-nav[open] .docs-mobile-burger { color: #6b8aff; }
          .docs-mobile-nav[open] nav {
            padding: 4px 16px 16px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            max-height: 60vh;
            overflow-y: auto;
            border-top: 1px solid rgba(255, 255, 255, 0.04);
          }
        }
      `}</style>

      {/* Content */}
      <main className="docs-main" style={{ flex: 1, maxWidth: "820px", padding: "64px 48px 120px", overflowX: "hidden" }}>

        {/* Intro */}
        <div id="intro">
          <p style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "1.5px", color: "#6b8aff", textTransform: "uppercase", marginBottom: "16px" }}>
            Documentation
          </p>
          <h1 style={{ fontSize: "36px", fontWeight: 700, margin: "0 0 12px", letterSpacing: "-1px" }}>
            AISs API
          </h1>
          <p style={{ fontSize: "16px", color: "rgba(255,255,255,0.55)", margin: "0 0 32px", lineHeight: 1.6 }}>
            Free, real-time maritime data for everyone.
          </p>

          <div style={{
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}>
            {[
              ["Base URL", "https://aiss.network/v1"],
              ["Format", "JSON — voyages return application/aiss+json"],
              ["Auth", "Not required for read. API key for write and commercial use."],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", minWidth: "72px", flexShrink: 0 }}>{label}</span>
                <span style={{ fontFamily: label === "Base URL" ? "monospace" : "inherit", color: "rgba(255,255,255,0.75)" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "56px 0 0" }} />

        {/* Endpoints header */}
        <div id="endpoints" style={{ paddingTop: "48px" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 4px" }}>Endpoints</h2>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", margin: 0 }}>All endpoints are available without authentication.</p>
        </div>

        <Endpoint
          id="ep-vessels"
          method="GET"
          path="/vessels"
          description="Live vessel positions. Returns all vessels updated within the last hour, optionally filtered by bounding box."
          params={[
            { name: "bbox", desc: "Bounding box: south,west,north,east — e.g. 54,10,58,14" },
            { name: "source", desc: "Filter by source: ais, waveo_gps, passive_radar" },
            { name: "limit", desc: "Max results (default 1000)" },
          ]}
          curl={`curl "https://aiss.network/v1/vessels?bbox=54,10,58,14"`}
          response={`{
  "vessels": [
    {
      "mmsi": 219024587,
      "name": "VINDSTILLE",
      "lat": 55.6761,
      "lon": 12.5683,
      "sog": 6.2,
      "cog": 185,
      "heading": 183,
      "nav_status": 0,
      "ship_type": 36,
      "source": "ais",
      "updated_at": "2026-04-07T15:30:00Z"
    }
  ],
  "count": 920,
  "timestamp": "2026-04-07T15:30:05Z"
}`}
        />

        <Endpoint
          id="ep-vessel"
          method="GET"
          path="/vessel/:mmsi"
          description="Full detail for a single vessel including dimensions, destination, and current status."
          curl={`curl "https://aiss.network/v1/vessel/219024587"`}
          response={`{
  "mmsi": 219024587,
  "name": "VINDSTILLE",
  "prefix": "S/Y",
  "flag": "DK",
  "lat": 55.6761,
  "lon": 12.5683,
  "sog": 6.2,
  "cog": 185,
  "destination": "ANHOLT",
  "eta": "0405 1800",
  "nav_status": "Underway using engine",
  "source": "ais",
  "updated_at": "2026-04-07T15:30:00Z"
}`}
        />

        <Endpoint
          id="ep-voyage"
          method="GET"
          path="/voyage/:id"
          description="Download a single voyage in .aiss format. The response is a signed JSON document containing vessel identity, voyage metadata, and timestamped events."
          params={[
            { name: "download", desc: "Set to true to receive as a .aiss file attachment" },
          ]}
          curl={`curl "https://aiss.network/v1/voyage/550e8400-e29b-41d4-a716-446655440000"`}
          response={`{
  "aiss": "1.0",
  "vessel": {
    "mmsi": 219024587,
    "name": "VINDSTILLE",
    "prefix": "S/Y",
    "flag": "DK"
  },
  "voyage": {
    "status": "completed",
    "started_at": "2026-04-07T10:00:00Z",
    "ended_at": "2026-04-07T16:00:00Z",
    "distance_nm": 23.4,
    "departure": "København",
    "arrival": "Anholt"
  },
  "route_id": 47283,
  "events": [
    { "type": "depart",      "t": "2026-04-07T10:00:00Z", "position": { "lat": 55.69, "lon": 12.59 } },
    { "type": "anchor_down", "t": "2026-04-07T15:30:00Z", "position": { "lat": 56.72, "lon": 11.52 } }
  ],
  "signature": {
    "signed_by": "aiss.network",
    "key_id": "aiss-2026-04",
    "algorithm": "ed25519",
    "verify": "https://aiss.network/.well-known/signing-keys"
  }
}`}
        />

        <Endpoint
          id="ep-voyage-mmsi"
          method="GET"
          path="/voyage/by-mmsi/:mmsi"
          description="List all recorded voyages for a vessel, newest first."
          params={[
            { name: "limit", desc: "Max results (default 10)" },
            { name: "from",  desc: "Start date — ISO 8601 (e.g. 2026-04-01)" },
            { name: "to",    desc: "End date — ISO 8601" },
          ]}
          curl={`curl "https://aiss.network/v1/voyage/by-mmsi/219024587?limit=5"`}
          response={`[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "started_at": "2026-04-07T10:00:00Z",
    "ended_at": "2026-04-07T16:00:00Z",
    "distance_nm": 23.4,
    "departure": "København",
    "arrival": "Anholt",
    "status": "completed"
  }
]`}
        />

        <Endpoint
          id="ep-voyage-multi"
          method="GET"
          path="/voyage/multi"
          description="Fetch voyages for multiple vessels simultaneously. Useful for comparing routes, detecting meetings, or building investigation timelines."
          params={[
            { name: "mmsi", desc: "Comma-separated MMSI numbers (max 20)" },
            { name: "from", desc: "Start date — ISO 8601" },
            { name: "to",   desc: "End date — ISO 8601" },
          ]}
          curl={`curl "https://aiss.network/v1/voyage/multi?mmsi=219024587,211234567&from=2026-04-01"`}
          response={`{
  "voyages": [
    { "aiss": "1.0", "vessel": { "mmsi": 219024587, ... }, ... },
    { "aiss": "1.0", "vessel": { "mmsi": 211234567, ... }, ... }
  ]
}`}
        />

        <Endpoint
          id="ep-stations"
          method="GET"
          path="/stations"
          description="Active AIS receiving stations contributing to the network."
          curl={`curl "https://aiss.network/v1/stations"`}
          response={`{
  "stations": [
    {
      "id": "uuid",
      "name": "Rønne AIS",
      "type": "ais",
      "lat": 55.1,
      "lon": 14.7,
      "range_km": 35,
      "is_active": true
    }
  ]
}`}
        />

        <Endpoint
          id="ep-anomalies"
          method="GET"
          path="/anomalies"
          description="Detected anomalies: dark vessels, AIS gaps, speed violations, and spoofing suspects. Public access returns data with a 24-hour delay. Real-time requires an API key."
          params={[
            { name: "bbox",  desc: "Bounding box: south,west,north,east" },
            { name: "type",  desc: "dark_vessel · ais_gap · speed_violation · spoofing_suspect" },
            { name: "hours", desc: "Lookback window in hours (default 72)" },
          ]}
          curl={`curl "https://aiss.network/v1/anomalies?type=dark_vessel&hours=72"`}
          response={`{
  "anomalies": [
    {
      "type": "dark_vessel",
      "lat": 55.4,
      "lon": 14.2,
      "severity": "high",
      "description": "Radar detection without AIS match",
      "created_at": "2026-04-07T10:00:00Z"
    }
  ]
}`}
        />

        <Endpoint
          id="ep-ingest"
          method="POST"
          path="/ingest"
          description="Submit vessel positions from your station or application. Accepts a single position object or a batch array. Anonymous submissions are accepted; an API key enables station attribution."
          params={[
            { name: "x-api-key", desc: "Header — optional for anonymous, required for attribution" },
          ]}
          curl={`# Single position
curl -X POST "https://aiss.network/v1/ingest" \\
  -H "Content-Type: application/json" \\
  -d '{"mmsi":219024587,"lat":55.67,"lon":12.56,"sog":6.2,"cog":185,"source":"my-station"}'

# Batch
curl -X POST "https://aiss.network/v1/ingest" \\
  -H "Content-Type: application/json" \\
  -d '[{"mmsi":219024587,...},{"mmsi":211234567,...}]'`}
          response={`{ "ok": true, "accepted": 2, "rejected": 0 }`}
        />

        <Endpoint
          id="ep-verify"
          method="POST"
          path="/verify"
          description="Verify the Ed25519 signature on a .aiss file. Returns whether the file is authentic and unmodified since it was signed by aiss.network."
          curl={`curl -X POST "https://aiss.network/v1/verify" \\
  -H "Content-Type: application/aiss+json" \\
  -d @my-voyage.aiss`}
          response={`# Valid
{ "valid": true, "signed_by": "aiss.network", "signed_at": "2026-04-07T15:30:00Z" }

# Tampered
{ "valid": false, "reason": "hash mismatch — data has been tampered with" }`}
        />

        <Endpoint
          id="ep-signing-keys"
          method="GET"
          path="/.well-known/signing-keys"
          description="Public Ed25519 signing keys for offline verification. Root keys are issued by aiss.network. Organisation keys are issued by verified members."
          curl={`curl "https://aiss.network/.well-known/signing-keys"`}
          response={`{
  "keys": [
    {
      "key_id": "aiss-2026-04",
      "key_type": "root",
      "algorithm": "ed25519",
      "public_key": "${signingKey ?? "MCowBQYDK2VwAyEA…"}",
      "signed_by": "aiss.network"
    }
  ]
}`}
        />

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "56px 0 0" }} />

        {/* .aiss Format */}
        <div id="format" style={{ paddingTop: "48px" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 4px" }}>.aiss Format</h2>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", margin: "0 0 24px" }}>
            The native voyage format for the AISs ecosystem.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
            {[
              ["MIME type", "application/aiss+json"],
              ["Extension", ".aiss"],
              ["Version",   "1.0"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", minWidth: "80px", flexShrink: 0 }}>{label}</span>
                <code style={{ fontFamily: "monospace", color: "rgba(255,255,255,0.7)" }}>{value}</code>
              </div>
            ))}
          </div>

          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: "0 0 20px" }}>
            A <code style={{ fontFamily: "monospace", color: "#6b8aff" }}>.aiss</code> file is a signed JSON document representing one voyage by one vessel.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px", marginBottom: "28px" }}>
            <div style={{ background: "rgba(43,168,200,0.06)", border: "1px solid rgba(43,168,200,0.15)", borderRadius: "8px", padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "#2ba8c8", textTransform: "uppercase", marginBottom: "10px" }}>Contains</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
                {[
                  "Vessel identity (MMSI, name, flag, type)",
                  "Voyage metadata (start, end, distance, ports)",
                  "Events with timestamps",
                  "Route reference (linked by route_id)",
                  "Ed25519 signature",
                  "Sensor source list",
                ].map((item) => (
                  <li key={item} style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", display: "flex", gap: "8px" }}>
                    <span style={{ color: "#2ba8c8", flexShrink: 0 }}>·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "10px" }}>Does not contain</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
                {[
                  "Raw sensor data (radar, camera)",
                  "Social data (comments, logbook text)",
                  "Weather data (separate layer)",
                  "Other vessels' data",
                  "Positions (interpolated at query time)",
                ].map((item) => (
                  <li key={item} style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", display: "flex", gap: "8px" }}>
                    <span style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "10px" }}>
              Supported sensor sources
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {[
                "ais", "s_ais", "vhf_dsc", "soft_ais", "fishing_vms", "waveo_gps", "epirb",
                "nmea2000", "nmea0183", "nmea_snapshot",
                "weather", "depth",
                "passive_radar", "mmwave", "camera", "xband_radar",
              ].map((s) => (
                <code key={s} style={{
                  fontFamily: "monospace", fontSize: "12px",
                  color: "#6b8aff", background: "rgba(107,138,255,0.08)",
                  border: "1px solid rgba(107,138,255,0.18)",
                  borderRadius: "4px", padding: "2px 8px",
                }}>
                  {s}
                </code>
              ))}
            </div>
          </div>

          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7, marginBottom: "20px" }}>
            Events store timestamps, not positions. Positions are interpolated from the route at query time — zero extra storage per event.
          </div>

          <div style={{ marginBottom: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "4px" }}>
              Verify any .aiss file
            </div>
            <CodeBlock code={`curl -X POST https://aiss.network/v1/verify -d @voyage.aiss`} />
          </div>

          {signingKey && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: "4px" }}>
                Public key for offline verification
              </div>
              <CodeBlock code={signingKey} />
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "56px 0 0" }} />

        {/* Fair Use */}
        <div id="fair-use" style={{ paddingTop: "48px" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 4px" }}>Fair Use</h2>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", margin: "0 0 20px", lineHeight: 1.6 }}>
            AISs data is free to read, explore, and use for personal projects, research, education, non-commercial applications, and journalism.
          </p>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", margin: "0 0 16px", lineHeight: 1.6 }}>
            If you build a commercial product using AISs data, we ask that you either:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
            {[
              ["Feed data back", "Share your AIS station or sensor data with the network"],
              ["Subscribe",      "Sign up for a commercial API plan"],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: "flex", gap: "12px", fontSize: "13px" }}>
                <span style={{ color: "#6b8aff", flexShrink: 0, fontWeight: 600 }}>{title}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{desc}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)", margin: 0 }}>
            This keeps the infrastructure running and the data free for everyone. Questions:{" "}
            <a href="mailto:api@aiss.network" style={{ color: "#6b8aff", textDecoration: "none" }}>api@aiss.network</a>
          </p>
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "56px 0 0" }} />

        {/* Rate Limits */}
        <div id="rate-limits" style={{ paddingTop: "48px" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 20px" }}>Rate Limits</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", overflow: "hidden" }}>
            {[
              { tier: "No API key",       limit: "100 req / hour",        color: "rgba(255,255,255,0.5)" },
              { tier: "Free key",         limit: "1,000 req / hour",      color: "rgba(255,255,255,0.5)" },
              { tier: "Provider key",     limit: "100,000 req / hour",    color: "#6b8aff" },
              { tier: "Commercial key",   limit: "Custom",                color: "#6b8aff" },
            ].map((row, i) => (
              <div key={row.tier} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "12px 20px",
                background: i % 2 === 0 ? "rgba(0,0,0,0.2)" : "transparent",
                fontSize: "13px",
              }}>
                <span style={{ color: "rgba(255,255,255,0.6)" }}>{row.tier}</span>
                <span style={{ fontFamily: "monospace", fontWeight: 600, color: row.color }}>{row.limit}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)", margin: "16px 0 0" }}>
            Request a key:{" "}
            <a href="mailto:api@aiss.network" style={{ color: "#6b8aff", textDecoration: "none" }}>api@aiss.network</a>
          </p>
        </div>

      </main>
    </div>
  );
}

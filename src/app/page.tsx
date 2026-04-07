import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

async function getStats() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const [{ count: vessels }, { count: routes }, { count: stations }] = await Promise.all([
      supabase.from("ais_vessels").select("*", { count: "exact", head: true }),
      supabase.from("ais_vessel_routes").select("*", { count: "exact", head: true }),
      supabase.from("ais_stations").select("*", { count: "exact", head: true }),
    ]);
    return {
      vessels: vessels ?? 0,
      routes: routes ?? 0,
      stations: stations ?? 0,
    };
  } catch {
    return { vessels: 0, routes: 0, stations: 0 };
  }
}

export default async function LandingPage() {
  const stats = await getStats();
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #1a1a3e 0%, #0f0f2a 60%, #080818 100%)",
      display: "flex",
      flexDirection: "column",
      color: "#ffffff",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Decorative glow */}
      <div style={{ position: "fixed", top: "-300px", left: "50%", transform: "translateX(-50%)", width: "1000px", height: "600px", borderRadius: "50%", background: "radial-gradient(circle, rgba(60,60,180,0.35) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 40px", maxWidth: "1100px", width: "100%", margin: "0 auto", position: "relative", zIndex: 10 }}>
        <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px" }}>
          <span style={{ color: "#ffffff" }}>AISs</span>
        </div>
        <div style={{ display: "flex", gap: "32px", alignItems: "center" }}>
          <a href="/api" style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", textDecoration: "none" }}>API</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: "center", padding: "80px 24px 60px", maxWidth: "760px", margin: "0 auto", position: "relative", zIndex: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "6px 16px", borderRadius: "100px", background: "rgba(107,138,255,0.1)", border: "1px solid rgba(107,138,255,0.25)", marginBottom: "32px", fontSize: "13px", color: "#8ba4ff" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b8aff", display: "inline-block" }} />
          Open protocol — free for everyone
        </div>

        <h1 style={{ fontSize: "56px", fontWeight: 700, lineHeight: 1.05, margin: "0 0 20px", letterSpacing: "-1.5px" }}>
          AISs protocol
        </h1>
        <p style={{ fontSize: "22px", fontWeight: 400, color: "rgba(255,255,255,0.75)", margin: "0 0 16px", lineHeight: 1.4 }}>
          The open standard<span style={{ fontFamily: "monospace", color: "#6b8aff", fontWeight: 600, margin: "0 0.3em" }}>.aiss</span>for maritime data
        </p>
        <p style={{ fontSize: "17px", color: "rgba(255,255,255,0.45)", margin: "0 0 44px", lineHeight: 1.7 }}>
          EVERY VESSEL · EVERY VOYAGE · EVERY SIGNAL<br />
          COLLECTED · SAVED · SHARED
        </p>

        <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/map" style={{ fontSize: "15px", fontWeight: 600, color: "#fff", background: "linear-gradient(135deg, #4a6aff, #6b8aff)", padding: "14px 32px", borderRadius: "8px", textDecoration: "none" }}>
            Explore Live Map
          </Link>
        </div>
      </section>

      {/* Three columns */}
      <section style={{ maxWidth: "1100px", width: "100%", margin: "0 auto", padding: "0 24px 72px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", position: "relative", zIndex: 10 }}>
        {([
          {
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b8aff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>,
            title: "Open data",
            body: "33,000+ vessels tracked live. Free API. No key needed. Routes, positions, speed, heading, destination — all searchable.",
            link: "/map",
            linkText: "View vessels →",
          },
          {
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b8aff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 10a4 4 0 0 0-4-4H5a4 4 0 0 0 0 8h4"/><path d="M11 14a4 4 0 0 0 4 4h4a4 4 0 0 0 0-8h-4"/></svg>,
            title: ".aiss format",
            body: "One file per voyage. Vessel identity, compressed route, events, sensor sources — signed and verifiable. Download, share, replay.",
            link: "/api",
            linkText: "Format spec →",
          },
          {
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b8aff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0"/><path d="M2 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0"/><path d="M2 7c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0"/></svg>,
            title: "Built for the sea",
            body: "AIS, GPS, radar, satellite, NMEA, VHF DSC, fishing VMS — all fused into one open protocol.",
            link: "/map",
            linkText: "See layers →",
          },
        ] as const).map((col) => (
          <div key={col.title} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "28px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>{col.icon}</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>{col.title}</div>
            <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.5)", lineHeight: 1.65, flex: 1, whiteSpace: "pre-line" }}>{col.body}</div>
            <a href={col.link} style={{ fontSize: "13px", color: "#6b8aff", textDecoration: "none", fontWeight: 500 }}>{col.linkText}</a>
          </div>
        ))}
      </section>

      {/* Stats bar */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "20px 24px", position: "relative", zIndex: 10 }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", justifyContent: "center", gap: "48px", flexWrap: "wrap" }}>
          {[
            { value: stats.vessels > 0 ? stats.vessels.toLocaleString("en-US") : "—", label: "vessels live" },
            { value: stats.routes > 0 ? stats.routes.toLocaleString("en-US") : "—", label: "routes stored" },
            { value: stats.stations > 0 ? stats.stations.toLocaleString("en-US") : "—", label: "stations" },
            { value: "47", label: "countries" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "18px", fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>{s.value}</span>
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Station CTA */}
      <section style={{ maxWidth: "1100px", margin: "0 auto", padding: "64px 24px", position: "relative", zIndex: 10 }}>
        <div style={{ background: "rgba(107,138,255,0.06)", border: "1px solid rgba(107,138,255,0.2)", borderRadius: "12px", padding: "48px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "24px" }}>
          <div>
            <h2 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 8px" }}>Have an AIS receiver?</h2>
            <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.45)", margin: 0 }}>
              Feed your data to AISs and get global coverage in return.
            </p>
          </div>
          <Link href="/map" style={{ fontSize: "15px", fontWeight: 600, color: "#fff", background: "linear-gradient(135deg, #4a6aff, #6b8aff)", padding: "14px 32px", borderRadius: "8px", textDecoration: "none", flexShrink: 0 }}>
            Add your station →
          </Link>
        </div>
      </section>

      {/* Why AISs */}
      <section style={{ maxWidth: "760px", margin: "0 auto", padding: "80px 24px 64px", position: "relative", zIndex: 10 }}>
        <p style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "1.5px", color: "#6b8aff", textTransform: "uppercase", marginBottom: "24px" }}>Why AISs</p>
        <h2 style={{ fontSize: "32px", fontWeight: 700, lineHeight: 1.2, margin: "0 0 16px", letterSpacing: "-0.5px" }}>
          Maritime data should be open.
        </h2>
        <p style={{ fontSize: "20px", color: "#6b8aff", fontWeight: 500, margin: "0 0 40px" }}>AISs gives it to everyone.</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
          {[
            "No account needed to explore",
            "Feed your station, get global data",
            "Every route stored permanently",
            ".aiss format: open, portable, yours",
            "API for developers and researchers",
          ].map((item) => (
            <li key={item} style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "16px", color: "rgba(255,255,255,0.65)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b8aff", flexShrink: 0 }} />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 24px 80px", position: "relative", zIndex: 10 }}>
        <p style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "1.5px", color: "#6b8aff", textTransform: "uppercase", marginBottom: "40px" }}>How it works</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          {[
            { n: "1", title: "Stations collect", body: "AIS receivers worldwide feed data to AISs" },
            { n: "2", title: "Routes compress", body: "Positions become permanent vessel routes" },
            { n: "3", title: "Voyages form", body: "Routes + events = .aiss voyage files" },
            { n: "4", title: "Everyone benefits", body: "Free API, free data, free tools" },
          ].map((step) => (
            <div key={step.n} style={{ borderTop: "2px solid rgba(107,138,255,0.3)", paddingTop: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#6b8aff", marginBottom: "8px" }}>{step.n}</div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "#fff", marginBottom: "8px" }}>{step.title}</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{step.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Build on AISs */}
      <section style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 24px 80px", position: "relative", zIndex: 10 }}>
        <p style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "1.5px", color: "#6b8aff", textTransform: "uppercase", marginBottom: "32px" }}>Build on AISs</p>
        <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(107,138,255,0.2)", borderRadius: "12px", padding: "32px 36px" }}>
          <pre style={{ margin: "0 0 8px", fontFamily: "monospace", fontSize: "14px", color: "#a0b4ff", lineHeight: 1.8 }}>
{`GET /aiss-vessels?bbox=54,10,58,14

curl https://aiss.network/v1/voyage/by-mmsi/219024587

→ application/aiss+json`}
          </pre>
          <p style={{ margin: "20px 0 24px", fontSize: "15px", color: "rgba(255,255,255,0.5)" }}>Three lines of code. Global maritime data.</p>
          <a href="/api" style={{ fontSize: "14px", fontWeight: 600, color: "#6b8aff", textDecoration: "none" }}>API documentation →</a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: "24px 40px", textAlign: "center", fontSize: "12px", color: "rgba(255,255,255,0.2)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        An open protocol by <span style={{ color: "#6b8aff", fontWeight: 600 }}>aiss.network</span>
      </footer>
    </div>
  );
}

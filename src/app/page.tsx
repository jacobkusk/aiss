import Link from "next/link";

export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #1a1a3e 0%, #0f0f2a 100%)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        color: "#ffffff",
      }}
    >
      {/* Decorative gradient circles */}
      <div
        style={{
          position: "absolute",
          bottom: "-200px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "900px",
          height: "900px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(60, 60, 180, 0.4) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-300px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "1200px",
          height: "1200px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(80, 60, 200, 0.25) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Nav */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px 40px",
          maxWidth: "1200px",
          width: "100%",
          margin: "0 auto",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px" }}>
          <span style={{ color: "#ffffff" }}>AIS</span>
          <span style={{ color: "#6b8aff" }}>s</span>
        </div>
        <div style={{ display: "flex", gap: "32px", alignItems: "center" }}>
          <Link
            href="/map"
            style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", textDecoration: "none", fontWeight: 500 }}
          >
            Live Map
          </Link>
          <a
            href="/api"
            style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", textDecoration: "none", fontWeight: 500 }}
          >
            API
          </a>
          <Link
            href="/map"
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#ffffff",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              padding: "8px 20px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Open Map
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px",
          textAlign: "center",
          maxWidth: "800px",
          margin: "0 auto",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 16px",
            borderRadius: "100px",
            background: "rgba(107, 138, 255, 0.1)",
            border: "1px solid rgba(107, 138, 255, 0.25)",
            marginBottom: "32px",
            fontSize: "13px",
            fontWeight: 500,
            color: "#8ba4ff",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#6b8aff",
              animation: "pulse-live 2s infinite",
            }}
          />
          Open protocol — free for everyone
        </div>

        <h1
          style={{
            fontSize: "52px",
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#ffffff",
            margin: "0 0 24px",
            letterSpacing: "-1px",
          }}
        >
          AISs —{" "}
          <span style={{ fontSize: "36px" }}>open, saved &{" "}
          <span style={{ color: "#6b8aff" }}>shared</span> protocol
          <br />
          for AIS and soft AIS</span>
        </h1>

        <p
          style={{
            fontSize: "18px",
            lineHeight: 1.7,
            color: "rgba(255,255,255,0.6)",
            margin: "0 0 40px",
            maxWidth: "640px",
          }}
        >
          Routes, positions, speed, heading, draft, destination, port calls,
          encounters, weather conditions, voyage history — all searchable, all free.
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
          <Link
            href="/map"
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#ffffff",
              background: "linear-gradient(135deg, #4a6aff 0%, #6b8aff 100%)",
              padding: "14px 32px",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            Explore Live Map
          </Link>
          <a
            href="/api"
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#8ba4ff",
              background: "transparent",
              padding: "14px 32px",
              borderRadius: "8px",
              border: "1px solid rgba(107, 138, 255, 0.3)",
              textDecoration: "none",
            }}
          >
            Read the API docs →
          </a>
        </div>
      </main>

      {/* Features */}
      <section
        style={{
          padding: "48px 40px",
          maxWidth: "600px",
          margin: "0 auto",
          width: "100%",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
          zIndex: 10,
        }}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
          {[
            "Time Machine — rewind and see where any ship was",
            "No AIS receiver needed — full global feed via API",
            "Have your own AIS? Share data, get global coverage",
            "Open API — build apps on real maritime data, free",
          ].map((item) => (
            <li key={item} style={{ fontSize: "15px", color: "rgba(255,255,255,0.55)", display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#6b8aff", flexShrink: 0 }} />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Stats */}
      <section
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "60px",
          padding: "40px 24px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
          zIndex: 10,
        }}
      >
        {[
          { value: "18,000+", label: "Vessels tracked" },
          { value: "24/7", label: "Real-time collection" },
          { value: "100%", label: "Free & open" },
        ].map((stat) => (
          <div key={stat.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#ffffff" }}>
              {stat.value}
            </div>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
              {stat.label}
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer
        style={{
          padding: "24px 40px",
          textAlign: "center",
          fontSize: "12px",
          color: "rgba(255,255,255,0.3)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
          zIndex: 10,
        }}
      >
        An open protocol by{" "}
        <span style={{ color: "#6b8aff", fontWeight: 600 }}>VIER.BLUE</span>
      </footer>
    </div>
  );
}

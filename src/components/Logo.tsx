export default function Logo() {
  return (
    <div className="px-6 pt-6 pb-4">
      <div style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>
        <span style={{ color: "#ffffff" }}>AIS</span>
        <span style={{ color: "#6b8aff" }}>s</span>
      </div>
      <div style={{
        fontSize: "11px",
        color: "rgba(255,255,255,0.4)",
        marginTop: "4px",
        lineHeight: 1.4,
      }}>
        AIS SHARED &amp; OPEN MARITIME DATA PROTOCOL
      </div>
    </div>
  );
}

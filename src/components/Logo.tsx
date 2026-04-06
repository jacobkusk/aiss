export default function Logo() {
  return (
    <div className="px-6 pt-6 pb-4">
      <div className="text-3xl font-bold tracking-tight">
        <span style={{ color: "var(--text-primary)" }}>AIS</span>
        <span style={{ color: "var(--aqua)" }}>s</span>
      </div>
      <div
        className="text-[10px] tracking-[3px] uppercase mt-1"
        style={{ color: "var(--text-muted)" }}
      >
        Open Maritime Data Protocol
      </div>
    </div>
  );
}

export default function ApiHint() {
  const today = new Date().toISOString().split("T")[0];

  return (
    <div
      className="absolute bottom-4 right-4 z-30 rounded-lg px-3 py-2"
      style={{
        background: "rgba(2, 10, 18, 0.6)",
        border: "1px solid var(--border)",
      }}
    >
      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
        GET aiss.dev/v1/vessels?date={today}
      </span>
    </div>
  );
}

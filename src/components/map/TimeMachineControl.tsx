"use client";

interface Props {
  active: boolean;
  time: string; // datetime-local string "YYYY-MM-DDTHH:MM"
  onToggle: () => void;
  onTimeChange: (value: string) => void;
}

export default function TimeMachineControl({ active, time, onToggle, onTimeChange }: Props) {
  return (
    <div style={{
      position: "absolute",
      top: 12,
      right: 12,
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-mono, monospace)",
    }}>
      {active && (
        <input
          type="datetime-local"
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
          style={{
            background: "rgba(4, 12, 20, 0.92)",
            border: "1px solid rgba(245, 158, 11, 0.5)",
            borderRadius: 6,
            color: "#f59e0b",
            fontSize: 12,
            padding: "5px 8px",
            outline: "none",
            fontFamily: "inherit",
            cursor: "pointer",
            colorScheme: "dark",
          }}
        />
      )}
      <button
        onClick={onToggle}
        title={active ? "Tilbage til live" : "Time machine — se historiske positioner"}
        style={{
          background: active ? "rgba(245, 158, 11, 0.15)" : "rgba(4, 12, 20, 0.88)",
          border: `1px solid ${active ? "rgba(245, 158, 11, 0.6)" : "rgba(43, 168, 200, 0.2)"}`,
          borderRadius: 6,
          color: active ? "#f59e0b" : "#5a8090",
          fontSize: 11,
          padding: "5px 10px",
          cursor: "pointer",
          fontFamily: "inherit",
          letterSpacing: "0.05em",
          display: "flex",
          alignItems: "center",
          gap: 5,
          transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 13 }}>⏱</span>
        {active ? "HIST" : "LIVE"}
      </button>
    </div>
  );
}

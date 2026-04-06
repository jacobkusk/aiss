"use client";

import { useState } from "react";

interface Props {
  onChange: (daysAgo: number) => void;
  isLive: boolean;
}

export default function TimeMachine({ onChange, isLive }: Props) {
  const [value, setValue] = useState(0);

  const handleChange = (v: number) => {
    setValue(v);
    onChange(v);
  };

  const dateLabel = () => {
    if (value === 0) return "LIVE";
    const d = new Date();
    d.setDate(d.getDate() - value);
    return d.toISOString().split("T")[0];
  };

  return (
    <div className="px-6 pb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
          Time Machine
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span
              className="inline-block w-2 h-2 rounded-full pulse-live"
              style={{ background: "var(--green-live)" }}
            />
          )}
          <span
            className="text-xs font-mono font-bold"
            style={{ color: isLive ? "var(--green-live)" : "var(--amber-historical)" }}
          >
            {dateLabel()}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={30}
        value={value}
        onChange={(e) => handleChange(parseInt(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--green-live) 0%, var(--amber-historical) 100%)`,
          accentColor: isLive ? "var(--green-live)" : "var(--amber-historical)",
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>NOW</span>
        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>30 DAYS</span>
      </div>
    </div>
  );
}

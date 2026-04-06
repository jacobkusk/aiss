"use client";

import Logo from "./Logo";
import StatsBar from "./StatsBar";
import SearchInput from "./SearchInput";
import TimeMachine from "./TimeMachine";
import { OVERLAY_LABELS, type Overlays } from "./MapView";

interface Props {
  onTimeMachineChange: (daysAgo: number) => void;
  isLive: boolean;
  overlays: Overlays;
  onToggleOverlay: (key: string) => void;
  onClose: () => void;
}

export default function LeftPanel({ onTimeMachineChange, isLive, overlays, onToggleOverlay, onClose }: Props) {
  return (
    <div
      className="flex flex-col w-[380px] shrink-0 h-full max-md:hidden"
      style={{
        background: "linear-gradient(180deg, #1a1a3e 0%, #0f0f2a 100%)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center justify-between">
        <Logo />
        <button
          onClick={onClose}
          className="mr-4 flex items-center justify-center w-8 h-8 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      <StatsBar />
      <SearchInput onSelect={() => {}} />
      <TimeMachine onChange={onTimeMachineChange} isLive={isLive} />

      {/* Filters */}
      <div style={{
        padding: "16px 24px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}>
        <div style={{
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "1px",
          color: "rgba(255,255,255,0.3)",
          marginBottom: "8px",
          textTransform: "uppercase",
        }}>
          Filters
        </div>
        {Object.entries(OVERLAY_LABELS).map(([key, item]) => (
          <button
            key={key}
            onClick={() => onToggleOverlay(key)}
            style={{
              background: "transparent",
              border: "none",
              color: overlays[key] ? "#ffffff" : "rgba(255, 255, 255, 0.3)",
              fontSize: "13px",
              padding: "6px 0",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: overlays[key] ? item.color : "rgba(255,255,255,0.15)",
              marginRight: "12px",
              transition: "all 0.15s",
            }} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

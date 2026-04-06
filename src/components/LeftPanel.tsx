"use client";

import Logo from "./Logo";
import StatsBar from "./StatsBar";
import SearchInput from "./SearchInput";
import TimeMachine from "./TimeMachine";
import VesselList from "./VesselList";
import type { Vessel } from "@/lib/types";

interface Props {
  vessels: Vessel[];
  onVesselSelect: (vessel: Vessel) => void;
  onTimeMachineChange: (daysAgo: number) => void;
  isLive: boolean;
}

export default function LeftPanel({ vessels, onVesselSelect, onTimeMachineChange, isLive }: Props) {
  return (
    <div
      className="flex flex-col w-[380px] shrink-0 h-full max-md:hidden"
      style={{
        background: "#d5dce3",
        backdropFilter: "blur(20px)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <Logo />

      {/* Hero */}
      <div className="px-6 pb-5">
        <div style={{ fontSize: "18px", fontWeight: 300, color: "var(--text-primary)", lineHeight: 1.4 }}>
          Saving all maritime data from all ships forever.
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "8px" }}>
          Free. Open. Build on AISs.
        </div>
      </div>

      <StatsBar />
      <SearchInput onSelect={onVesselSelect} />
      <TimeMachine onChange={onTimeMachineChange} isLive={isLive} />
      <VesselList vessels={vessels} onSelect={onVesselSelect} />

      {/* Footer description */}
      <div style={{
        padding: "20px 24px",
        borderTop: "1px solid var(--border)",
        fontSize: "13px",
        lineHeight: "1.6",
        color: "var(--text-secondary)",
      }}>
        <p style={{ margin: 0 }}>AISs is the open maritime data protocol. Every position. Every sensor. Every ship. Stored forever. Free for everyone.</p>
        <p style={{ margin: 0, marginTop: "12px" }}>Build your app on AISs — the maritime data layer that others keep behind a paywall.</p>
        <a href="/api" style={{
          display: "inline-block",
          marginTop: "16px",
          padding: "8px 20px",
          border: "1px solid var(--aqua)",
          borderRadius: "6px",
          color: "var(--aqua)",
          fontSize: "13px",
          textDecoration: "none",
          background: "transparent",
        }}>
          Read the API docs →
        </a>
      </div>

      {/* Copyright */}
      <div style={{
        padding: "12px 24px",
        fontSize: "11px",
        color: "var(--text-muted)",
        letterSpacing: "0.5px",
      }}>
        An open protocol by weare.blue
      </div>
    </div>
  );
}

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
  onClose: () => void;
}

export default function LeftPanel({ vessels, onVesselSelect, onTimeMachineChange, isLive, onClose }: Props) {
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
      <SearchInput onSelect={onVesselSelect} />
      <TimeMachine onChange={onTimeMachineChange} isLive={isLive} />
      <VesselList vessels={vessels} onSelect={onVesselSelect} />

    </div>
  );
}

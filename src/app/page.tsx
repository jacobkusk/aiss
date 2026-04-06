"use client";

import { useState, useCallback, useRef } from "react";
import type maplibregl from "maplibre-gl";
import LeftPanel from "@/components/LeftPanel";
import MapView from "@/components/MapView";
import GlobeMapToggle from "@/components/GlobeMapToggle";
import LiveHistoricalBadge from "@/components/LiveHistoricalBadge";
import VesselPopup from "@/components/VesselPopup";
import ApiHint from "@/components/ApiHint";
import type { Vessel } from "@/lib/types";

export default function Home() {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const [isGlobe, setIsGlobe] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);
  const [routeCount, setRouteCount] = useState(0);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const handleVesselSelect = useCallback((vessel: Vessel) => {
    setSelectedVessel(vessel);
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [vessel.lon, vessel.lat],
        zoom: 10,
        duration: 2000,
      });
    }
  }, []);

  const handleTimeMachineChange = useCallback((daysAgo: number) => {
    if (daysAgo === 0) {
      setIsLive(true);
      setHistoricalDate(null);
    } else {
      setIsLive(false);
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      setHistoricalDate(d.toISOString().split("T")[0]);
    }
  }, []);

  return (
    <div className="flex h-full w-full">
      {/* Left Panel */}
      <LeftPanel
        vessels={vessels}
        onVesselSelect={handleVesselSelect}
        onTimeMachineChange={handleTimeMachineChange}
        isLive={isLive}
      />

      {/* Map Area */}
      <div className="relative flex-1">
        <MapView
          mapRef={mapRef}
          isGlobe={isGlobe}
          isLive={isLive}
          historicalDate={historicalDate}
          onVesselsUpdate={setVessels}
          onVesselClick={setSelectedVessel}
          onRouteCountUpdate={setRouteCount}
        />

        {/* Overlays */}
        <LiveHistoricalBadge
          isLive={isLive}
          vesselCount={vessels.length}
          date={historicalDate}
          routeCount={routeCount}
        />

        <GlobeMapToggle isGlobe={isGlobe} onToggle={() => setIsGlobe(!isGlobe)} />

        {selectedVessel && (
          <VesselPopup
            vessel={selectedVessel}
            onClose={() => setSelectedVessel(null)}
          />
        )}

        <ApiHint />
      </div>
    </div>
  );
}

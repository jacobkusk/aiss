"use client";

import { useState, useCallback, useRef } from "react";
import type maplibregl from "maplibre-gl";
import LeftPanel from "@/components/LeftPanel";
import MapView, { DEFAULT_OVERLAYS, type Overlays, type MapStyle } from "@/components/MapView";
import TimeScrubber from "@/components/TimeScrubber";

import LiveHistoricalBadge from "@/components/LiveHistoricalBadge";
import VesselPopup from "@/components/VesselPopup";
import type { Vessel } from "@/lib/types";

export default function Home() {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const [isGlobe, setIsGlobe] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);
  const [routeCount, setRouteCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // const [scrubMinutesAgo, setScrubMinutesAgo] = useState(0);
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [zoomLevel, setZoomLevel] = useState(2);
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

  const handleToggleOverlay = useCallback((key: string) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left Panel */}
      {sidebarOpen && (
        <LeftPanel
          onTimeMachineChange={handleTimeMachineChange}
          isLive={isLive}
          overlays={overlays}
          onToggleOverlay={handleToggleOverlay}
          mapStyle={mapStyle}
          onMapStyleChange={setMapStyle}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Map Area */}
      <div className="relative flex-1">
        {/* Open sidebar button */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 z-30 flex items-center justify-center w-10 h-10 rounded-lg"
            style={{
              background: "rgba(26, 26, 62, 0.9)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.7)",
              fontSize: "18px",
              cursor: "pointer",
              backdropFilter: "blur(10px)",
            }}
          >
            &#9776;
          </button>
        )}
        <MapView
          mapRef={mapRef}
          isGlobe={isGlobe}
          isLive={isLive}
          historicalDate={historicalDate}
          scrubMinutesAgo={0}
          overlays={overlays}
          mapStyle={mapStyle}
          onVesselsUpdate={setVessels}
          onVesselClick={setSelectedVessel}
          onRouteCountUpdate={setRouteCount}
          onToggleGlobe={setIsGlobe}
          onToggleOverlay={handleToggleOverlay}
          onZoomChange={setZoomLevel}
        />

        {/* Overlays */}
        <LiveHistoricalBadge
          isLive={isLive}
          vesselCount={vessels.length}
          date={historicalDate}
          routeCount={routeCount}
          sidebarOpen={sidebarOpen}
        />

        {selectedVessel && (
          <VesselPopup
            vessel={selectedVessel}
            onClose={() => setSelectedVessel(null)}
          />
        )}

        <TimeScrubber
          rangeMinutes={360}
          onScrub={() => {}}
          onLive={() => {}}
          zoomLevel={zoomLevel}
        />
      </div>
    </div>
  );
}

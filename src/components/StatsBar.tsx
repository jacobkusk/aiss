"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatNumber } from "@/lib/utils";

interface StatsData {
  vessels: number;
  routes: number;
  nm: number;
}

export default function StatsBar() {
  const [stats, setStats] = useState<StatsData>({ vessels: 0, routes: 0, nm: 0 });

  useEffect(() => {
    async function fetchStats() {
      const [vesselsRes, routesRes] = await Promise.all([
        supabase.from("ais_latest").select("mmsi", { count: "exact", head: true }),
        supabase.from("ais_vessel_routes").select("distance_nm"),
      ]);

      const vesselCount = vesselsRes.count ?? 0;
      const routeData = routesRes.data ?? [];
      const routeCount = routeData.length;
      const totalNm = routeData.reduce((sum, r) => sum + (r.distance_nm ?? 0), 0);

      setStats({ vessels: vesselCount, routes: routeCount, nm: totalNm });
    }
    fetchStats();
  }, []);

  const items = [
    { label: "VESSELS", value: formatNumber(stats.vessels) },
    { label: "ROUTES", value: formatNumber(stats.routes) },
    { label: "NM TRACKED", value: formatNumber(stats.nm) },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 px-6 pb-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg px-3 py-2 text-center"
          style={{ background: "rgba(43, 168, 200, 0.06)", border: "1px solid var(--border)" }}
        >
          <div
            className="text-lg font-bold font-mono"
            style={{ color: "var(--aqua)" }}
          >
            {item.value}
          </div>
          <div className="text-[9px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

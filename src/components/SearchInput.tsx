"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { mmsiToFlag } from "@/lib/utils";
import type { Vessel } from "@/lib/types";

interface Props {
  onSelect: (vessel: Vessel) => void;
}

export default function SearchInput({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Vessel[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }

    const isNumeric = /^\d+$/.test(q);
    let res;
    if (isNumeric) {
      res = await supabase
        .from("ais_latest")
        .select("mmsi, ship_name, lat, lon, sog, cog")
        .eq("mmsi", parseInt(q))
        .limit(20);
    } else {
      res = await supabase
        .from("ais_latest")
        .select("mmsi, ship_name, lat, lon, sog, cog")
        .ilike("ship_name", `%${q}%`)
        .limit(20);
    }

    setResults(
      (res.data ?? []).map((r) => ({
        mmsi: r.mmsi,
        ship_name: r.ship_name,
        lat: r.lat,
        lon: r.lon,
        sog: r.sog,
        cog: r.cog,
        heading: null,
        speed: r.sog,
      }))
    );
    setOpen(true);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (v: Vessel) => {
    setQuery(v.ship_name ?? String(v.mmsi));
    setOpen(false);
    onSelect(v);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={wrapperRef} className="relative px-6 pb-4">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search vessel name or MMSI..."
        className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
        style={{
          background: "rgba(43, 168, 200, 0.06)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      />
      {open && results.length > 0 && (
        <div
          className="absolute left-6 right-6 top-full z-50 max-h-64 overflow-y-auto rounded-lg shadow-xl"
          style={{ background: "var(--bg-panel)", backdropFilter: "blur(20px)", border: "1px solid var(--border)" }}
        >
          {results.map((v) => (
            <button
              key={v.mmsi}
              onClick={() => handleSelect(v)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5 transition-colors"
            >
              <span className="text-base">{mmsiToFlag(v.mmsi)}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ color: "var(--text-primary)" }}>
                  {v.ship_name || "Unknown"}
                </div>
                <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                  {v.mmsi}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

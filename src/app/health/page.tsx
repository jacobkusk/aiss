"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Source {
  source_id:      string;
  source_name:    string;
  source_type:    string;
  is_active:      boolean;
  last_seen:      string | null;
  age_sec:        number | null;
  status:         "ok" | "stale" | "down" | "inactive";
  total_batches:  number;
  total_accepted: number;
  total_rejected: number;
}

interface DayPoint   { day: string; n: number; }
interface GrowthPoint { day: string; new: number; total: number; }

interface RpcHealth {
  rpc_name:   string;
  ok:         boolean;
  detail:     string | null;
  checked_at: string | null;
}

interface SystemStats {
  total_positions:     number;
  positions_today:     number;
  positions_last_hour: number;
  total_vessels:       number;
  vessels_today:       number;
  new_vessels_today:   number;
  new_vessels_week:    number;
  db_size:             string;
  db_size_bytes:       number;
  partition_count:     number;
  daily_positions:     DayPoint[];
  vessels_growth:      GrowthPoint[];
  sources:             Source[];
  rpc_health:          RpcHealth[];
  vessels_live_2min:   number;
}

const STATUS_COLOR: Record<string, string> = {
  ok:       "#00e676",
  stale:    "#f59e0b",
  down:     "#ef4444",
  inactive: "#3a5060",
};

const STATUS_LABEL: Record<string, string> = {
  ok:       "ONLINE",
  stale:    "LANGSOM",
  down:     "NEDE",
  inactive: "IKKE TILSLUTTET",
};

const SOURCE_ICON: Record<string, string> = {
  pi4_rtlsdr:     "📡",
  aishub:         "🌐",
  aisstream:      "📶",
  ais_aggregator: "🌐",
  ais_websocket:  "📶",
};

const SOURCE_LABEL: Record<string, string> = {
  pi4_rtlsdr: "Pi4 RTL-SDR",
  aishub:     "AISHub",
  aisstream:  "AISStream",
};

function ago(sec: number) {
  if (sec < 60)   return `${Math.round(sec)}s siden`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m siden`;
  return `${Math.floor(sec / 3600)}t siden`;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function HealthPage() {
  const [stats, setStats]     = useState<SystemStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [tick, setTick]       = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/monitor");
        const json = await res.json();
        if (!mounted) return;
        if (!res.ok || json.error) {
          setApiError(json.error ?? `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        setStats(json);
        setApiError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (mounted) {
          setApiError(e instanceof Error ? e.message : "Netværksfejl");
          setLoading(false);
        }
      }
    }
    load();
    const id = setInterval(load, 20_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const maxDay     = Math.max(...(stats?.daily_positions ?? []).map((d) => d.n), 1);
  const growth     = stats?.vessels_growth ?? [];
  const maxTotal   = Math.max(...growth.map((g) => g.total), 1);
  const maxNew     = Math.max(...growth.map((g) => g.new), 1);

  // SVG polyline points for cumulative curve
  const W = 900, H = 120, PAD = 8;
  const growthPoints = growth.map((g, i) => {
    const x = growth.length < 2 ? PAD : PAD + (i / (growth.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((g.total / maxTotal) * (H - PAD * 2));
    return `${x},${y}`;
  }).join(" ");

  const onlineSources  = stats?.sources.filter((s) => s.status === "ok").length ?? 0;
  const totalSources   = stats?.sources.filter((s) => s.is_active).length ?? 0;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#040c14", display: "flex", alignItems: "center", justifyContent: "center", color: "#5a8090", fontFamily: "monospace", fontSize: 14 }}>
      Henter systemdata...
    </div>
  );

  if (apiError) return (
    <div style={{ minHeight: "100vh", background: "#040c14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, fontFamily: "monospace" }}>
      <div style={{ fontSize: 14, color: "#ef4444" }}>⚠ API fejl</div>
      <div style={{ fontSize: 12, color: "#5a8090", maxWidth: 400, textAlign: "center" }}>{apiError}</div>
      <button
        onClick={() => { setLoading(true); setApiError(null); }}
        style={{ fontSize: 11, color: "#2ba8c8", background: "none", border: "1px solid #2ba8c833", borderRadius: 6, padding: "6px 16px", cursor: "pointer" }}
      >
        Prøv igen
      </button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#040c14", color: "#c0d4dc", fontFamily: "var(--font-jetbrains, monospace)", padding: "28px 28px", maxWidth: 1000, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <Link href="/map" style={{ fontSize: 12, color: "#2ba8c8", textDecoration: "none", letterSpacing: 1, fontWeight: 700 }}>AISS</Link>
        <span style={{ color: "#3a5060" }}>/</span>
        <span style={{ fontSize: 12, color: "#c0d4dc", letterSpacing: 1, fontWeight: 700 }}>SYSTEM MONITOR</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#3a5060" }}>opdaterer hvert 20s</span>
      </div>
      <div style={{ fontSize: 12, color: "#4a6878", marginBottom: 32 }}>
        Realtidsoverblik over AISS platformen — database, datakilder og aktivitet.
      </div>

      {/* LIVE PI RECEPTION */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#4a6878", textTransform: "uppercase", marginBottom: 12 }}>
          📡 Pi modtager lige nu
        </div>
        <div style={{ background: "rgba(0,230,118,0.04)", border: "1px solid rgba(0,230,118,0.2)", borderRadius: 10, padding: "20px 24px", display: "flex", alignItems: "center", gap: 24 }}>
          <div>
            <div style={{ fontSize: 48, fontWeight: 800, color: "#00e676", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {stats?.vessels_live_2min ?? 0}
            </div>
            <div style={{ fontSize: 12, color: "#c0d4dc", marginTop: 6, fontWeight: 600 }}>skibe inden for rækkevidde</div>
            <div style={{ fontSize: 10, color: "#4a6878", marginTop: 2 }}>set de seneste 2 minutter</div>
          </div>
          <div style={{ width: 1, height: 60, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ fontSize: 12, color: "#4a6878", lineHeight: 1.7 }}>
            Positioner modtaget via RTL-SDR → AIS-catcher → Supabase.<br />
            Opdateres hvert 20s.
          </div>
        </div>
      </div>

      {/* DATABASE STATS */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#4a6878", textTransform: "uppercase", marginBottom: 12 }}>
        🗄️ Database
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        {[
          { label: "Positioner total",  sub: "alle tider",         value: fmt(stats?.total_positions ?? 0),   color: "#2ba8c8" },
          { label: "Positioner i dag",  sub: "siden midnat",       value: fmt(stats?.positions_today ?? 0),   color: "#2ba8c8" },
          { label: "Skibe nogensinde",  sub: "unikke MMSI",        value: fmt(stats?.total_vessels ?? 0),     color: "#00e676" },
          { label: "Skibe aktive i dag",  sub: "set siden midnat",          value: fmt(stats?.vessels_today ?? 0),      color: "#00e676" },
          { label: "Nye skibe i dag",    sub: "første gang nogensinde set", value: fmt(stats?.new_vessels_today ?? 0),  color: "#f59e0b" },
          { label: "Nye skibe ugen",     sub: "første gang set 7 dage",    value: fmt(stats?.new_vessels_week ?? 0),   color: "#f59e0b" },
          { label: "DB størrelse",       sub: `${stats?.partition_count ?? 0} daglige partitioner`, value: stats?.db_size ?? "—", color: "#7a9aaa" },
        ].map((s) => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#c0d4dc", marginTop: 6, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 10, color: "#4a6878", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* DAILY CHART */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#c0d4dc", marginBottom: 10 }}>
          Positioner pr. dag <span style={{ fontWeight: 400, color: "#4a6878", fontSize: 11 }}>(seneste 7 dage · alle kilder)</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 80 }}>
          {(stats?.daily_positions ?? []).map((d, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, color: "#2ba8c8" }}>{fmt(d.n)}</div>
              <div
                title={`${d.day}: ${d.n} positioner`}
                style={{ width: "100%", height: Math.max(4, (d.n / maxDay) * 60), background: "#2ba8c8", borderRadius: "3px 3px 0 0", opacity: 0.8 }}
              />
              <div style={{ fontSize: 10, color: "#4a6878" }}>
                {new Date(d.day).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* VESSEL GROWTH */}
      {growth.length > 1 && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#4a6878", textTransform: "uppercase", marginBottom: 16 }}>
            📈 Skibsvækst
          </div>

          {/* Cumulative curve */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#c0d4dc" }}>
                Unikke skibe opdaget <span style={{ fontWeight: 400, color: "#4a6878", fontSize: 11 }}>(kumulativ total)</span>
              </div>
              <div style={{ fontSize: 11, color: "#4a6878" }}>
                {growth[0]?.day ? new Date(growth[0].day).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : ""}
                {" → "}
                {growth[growth.length - 1]?.day ? new Date(growth[growth.length - 1].day).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : ""}
              </div>
            </div>
            <div style={{ position: "relative", background: "rgba(43,168,200,0.03)", border: "1px solid rgba(43,168,200,0.08)", borderRadius: 8, overflow: "hidden" }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 120, display: "block" }}>
                {/* gradient fill */}
                <defs>
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2ba8c8" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#2ba8c8" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {/* filled area */}
                {growth.length > 1 && (
                  <polygon
                    points={`${PAD},${H} ${growthPoints} ${W - PAD},${H}`}
                    fill="url(#growthGrad)"
                  />
                )}
                {/* line */}
                <polyline
                  points={growthPoints}
                  fill="none"
                  stroke="#2ba8c8"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                {/* latest dot */}
                {growth.length > 0 && (() => {
                  const last = growth[growth.length - 1];
                  const lx = PAD + ((growth.length - 1) / (growth.length - 1)) * (W - PAD * 2);
                  const ly = H - PAD - ((last.total / maxTotal) * (H - PAD * 2));
                  return <circle cx={lx} cy={ly} r="4" fill="#2ba8c8" />;
                })()}
              </svg>
              {/* Y axis labels */}
              <div style={{ position: "absolute", top: PAD, left: 12, fontSize: 10, color: "#2ba8c8", fontWeight: 700 }}>
                {fmt(maxTotal)}
              </div>
              <div style={{ position: "absolute", bottom: PAD + 4, left: 12, fontSize: 10, color: "#4a6878" }}>
                0
              </div>
            </div>
            {/* X axis labels */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "#4a6878" }}>
              {[0, Math.floor(growth.length / 2), growth.length - 1].map((i) => growth[i] ? (
                <span key={i}>{new Date(growth[i].day).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}</span>
              ) : null)}
            </div>
          </div>

          {/* New vessels per day bar chart */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#c0d4dc", marginBottom: 8 }}>
              Nye skibe pr. dag <span style={{ fontWeight: 400, color: "#4a6878", fontSize: 11 }}>(første gang nogensinde set)</span>
            </div>
            <div style={{ display: "flex", gap: growth.length > 30 ? 2 : 4, alignItems: "flex-end", height: 64 }}>
              {growth.map((g, i) => (
                <div
                  key={i}
                  title={`${new Date(g.day).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}: ${g.new} nye skibe`}
                  style={{
                    flex: 1,
                    height: g.new > 0 ? Math.max(3, (g.new / maxNew) * 56) : 2,
                    background: g.new > 0 ? "#00e676" : "#1a3040",
                    borderRadius: "2px 2px 0 0",
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "#4a6878" }}>
              {[0, Math.floor(growth.length / 2), growth.length - 1].map((i) => growth[i] ? (
                <span key={i}>{new Date(growth[i].day).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}</span>
              ) : null)}
            </div>
          </div>
        </div>
      )}

      {/* RPC HEALTH */}
      {(stats?.rpc_health ?? []).length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#4a6878", textTransform: "uppercase", marginBottom: 12 }}>
            🔌 API endpoints
            {(stats?.rpc_health ?? []).every((r) => r.ok) ? (
              <span style={{ marginLeft: 10, color: "#00e676", fontWeight: 400 }}>alle OK</span>
            ) : (
              <span style={{ marginLeft: 10, color: "#ef4444", fontWeight: 400 }}>
                {(stats?.rpc_health ?? []).filter((r) => !r.ok).length} BRUDT
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {(stats?.rpc_health ?? []).map((r) => (
              <div key={r.rpc_name} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "rgba(255,255,255,0.02)",
                border: `1px solid ${r.ok ? "#00e67622" : "#ef444433"}`,
                borderRadius: 8,
                padding: "12px 16px",
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: r.ok ? "#00e676" : "#ef4444",
                  boxShadow: r.ok ? "0 0 8px #00e676" : "0 0 8px #ef4444",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: r.ok ? "#c0d4dc" : "#ef4444", fontFamily: "monospace" }}>
                    {r.rpc_name}
                  </div>
                  <div style={{ fontSize: 10, color: "#4a6878", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.detail ?? "—"}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#3a5060", flexShrink: 0 }}>
                  {r.checked_at ? ago(Math.round((Date.now() - new Date(r.checked_at).getTime()) / 1000)) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SOURCES */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#4a6878", textTransform: "uppercase", marginBottom: 12 }}>
        📡 Datakilder — {onlineSources}/{totalSources} online
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 36 }}>
        {(stats?.sources ?? []).map((src) => {
          const color  = STATUS_COLOR[src.status];
          const icon   = SOURCE_ICON[src.source_name] ?? SOURCE_ICON[src.source_type] ?? "📡";
          const label  = SOURCE_LABEL[src.source_name] ?? src.source_name;
          const isLink = src.is_active;

          const card = (
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: `1px solid ${color}33`,
              borderRadius: 8,
              padding: "18px 20px",
              cursor: isLink ? "pointer" : "default",
              opacity: src.status === "inactive" ? 0.5 : 1,
              transition: "border-color 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#c0d4dc" }}>{label}</div>
                  <div style={{ fontSize: 10, color: "#4a6878", marginTop: 1 }}>{src.source_type}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: src.status === "ok" ? `0 0 8px ${color}` : "none" }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.5 }}>{STATUS_LABEL[src.status]}</span>
                </div>
              </div>
              {src.is_active ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#2ba8c8" }}>{fmt(src.total_accepted)}</div>
                    <div style={{ fontSize: 9, color: "#4a6878", marginTop: 2 }}>meldinger total</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#7a9aaa" }}>{src.total_batches.toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: "#4a6878", marginTop: 2 }}>batches sendt</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: src.age_sec != null ? (src.age_sec < 300 ? "#00e676" : "#ef4444") : "#3a5060" }}>
                      {src.age_sec != null ? ago(src.age_sec) : "—"}
                    </div>
                    <div style={{ fontSize: 9, color: "#4a6878", marginTop: 2 }}>sidst set</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "#3a5060" }}>Planlagt datakilde — ikke tilsluttet endnu</div>
              )}
              {isLink && (
                <div style={{ marginTop: 12, fontSize: 10, color: "#2ba8c8", letterSpacing: 0.5 }}>
                  Se detaljer →
                </div>
              )}
            </div>
          );

          return isLink ? (
            <Link key={src.source_id} href={`/health/sources/${src.source_id}`} style={{ textDecoration: "none" }}>
              {card}
            </Link>
          ) : (
            <div key={src.source_id}>{card}</div>
          );
        })}
      </div>

    </div>
  );
}

"use client";

import { useEffect, useState, use, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
function fmtCoord(v: number, dir: "lat" | "lon") {
  return `${Math.abs(v).toFixed(5)}° ${dir === "lat" ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W")}`;
}
function ago(sec: number) {
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
function fmtN(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
function daysHours(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// MMSI → country code
function mmsiFlag(mmsi: number): string | null {
  const mid = Math.floor(mmsi / 1_000_000);
  const M: Record<number, string> = {
    201:"GR",205:"LU",206:"BE",207:"FR",209:"CY",211:"DE",219:"DK",220:"DK",224:"ES",225:"ES",226:"FR",
    227:"FR",228:"FR",229:"MT",230:"FI",231:"FO",232:"GB",233:"GB",234:"GB",235:"GB",236:"GI",237:"GR",
    238:"HR",239:"GR",240:"GR",241:"GR",244:"NL",245:"NL",246:"NL",247:"IT",248:"MT",249:"MT",250:"IE",
    255:"PT",256:"MT",257:"NO",258:"NO",259:"NO",261:"PL",263:"PT",265:"SE",266:"SE",270:"CZ",271:"TR",
    272:"UA",273:"RU",275:"LV",276:"EE",277:"LT",303:"US",304:"AG",308:"BS",316:"CA",338:"US",339:"JM",
    345:"MX",351:"PA",352:"PA",353:"PA",354:"PA",355:"PA",356:"PA",366:"US",367:"US",368:"US",369:"US",
    412:"CN",413:"CN",431:"JP",432:"JP",440:"KR",441:"KR",470:"AE",477:"HK",
    501:"AQ",503:"AU",512:"NZ",525:"ID",533:"MY",538:"MH",548:"PH",563:"SG",564:"SG",565:"SG",566:"SG",
    567:"TH",574:"VN",601:"ZA",620:"EG",636:"LR",637:"LR",
  };
  return M[mid] ?? null;
}
function ccToName(cc: string | null): string {
  const N: Record<string, string> = {
    DK:"Denmark",NO:"Norway",SE:"Sweden",DE:"Germany",GB:"United Kingdom",FR:"France",
    NL:"Netherlands",RU:"Russia",PA:"Panama",LR:"Liberia",MH:"Marshall Islands",
    BS:"Bahamas",CY:"Cyprus",MT:"Malta",SG:"Singapore",CN:"China",JP:"Japan",
    US:"United States",IT:"Italy",GR:"Greece",FI:"Finland",PT:"Portugal",ES:"Spain",
    KR:"Korea",HK:"Hong Kong",AE:"UAE",
  };
  return cc ? (N[cc] ?? cc) : "—";
}
function FlagEmoji({ cc }: { cc: string | null }) {
  if (!cc) return null;
  const flag = cc.toUpperCase().split("").map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
  return <span style={{ fontSize: 14, marginRight: 4 }}>{flag}</span>;
}

// CO₂ estimate (IMO CII simplified)
function co2Estimate(sogKn: number, lengthM: number | null) {
  const L = lengthM ?? 120;
  const pMain = 0.007 * Math.pow(L, 2.5) * Math.pow(Math.max(sogKn, 0.5) / 14, 3);
  const fuelTonsDay = (pMain * 180 * 24) / 1_000_000;
  const co2 = fuelTonsDay * 3.114;
  const ciiRef = 0.01 * Math.pow(L, 0.8);
  const ratio = co2 / Math.max(ciiRef, 0.1);
  let rating = "A", color = "#00e676";
  if (ratio > 1.8) { rating = "E"; color = "#ef4444"; }
  else if (ratio > 1.4) { rating = "D"; color = "#f59e0b"; }
  else if (ratio > 1.1) { rating = "C"; color = "#f59e0b"; }
  else if (ratio > 0.85) { rating = "B"; color = "#2BA8C8"; }
  return { tonsPerDay: co2, ciiRating: rating, color };
}

const MSG_TYPE_LABELS: Record<string, string> = {
  "1":"Position (Class A)","2":"Position (Class A)","3":"Position (Class A)",
  "5":"Static & Voyage","18":"Position (Class B)","19":"Extended (Class B)",
  "24":"Static (Class B)","21":"AtoN Report","27":"Long Range","unknown":"Unknown",
};

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
   ═══════════════════════════════════════════════════════════════ */
const C = {
  bg:"#040c14", panel:"#081322", panelB:"#0a1628",
  border:"rgba(43,168,200,0.15)", borderS:"rgba(43,168,200,0.35)",
  aqua:"#2BA8C8", aqua2:"#5fd4f0",
  green:"#00e676", amber:"#f59e0b", red:"#ef4444",
  violet:"#a888ff", cyan:"#22d3ee",
  ink:"#c0d4dc", dim:"#7a9aaa", faint:"#4a6878", ghost:"#2a4050",
  mono:"var(--font-jetbrains, monospace)",
} as const;

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
interface SpeedBucket { bucket: number; avg_sog: number; max_sog: number; n: number }
interface CogBin { bin_deg: number; n: number }
interface HeatCell { dow: number; hr: number; n: number }
interface CumulDay { day: string; nm: number }
interface Activity { at_sea_pct: number; at_port_pct: number; at_sea_fixes: number; at_port_fixes: number; total_fixes: number }
interface MsgType { msg_type: string; n: number }
interface VesselEvent { t: string; event_type: string; detail: Record<string, any> }
interface Weather { temp_c: number; wind_kn: number; wind_dir: number; wave_m: number; wave_period: number; current_kn: number; current_dir: number }

interface VesselDetail {
  entity: {
    entity_id: string; mmsi: number; name: string | null;
    entity_type: string; type_text: string | null; flag: string | null;
    imo: string | null; callsign: string | null;
    length_m: number | null; beam_m: number | null;
    ship_type: number | null; first_seen: string; last_static: string;
    domain_meta: Record<string, any>;
  };
  last: {
    lat: number; lon: number; speed_kn: number; cog: number;
    heading: number | null; nav_status: string | null;
    t: string; age_sec: number; source: string;
    source_count: number; sensors: Record<string, any>;
  } | null;
  voyage: { destination: string | null; eta: string | null; draught_m: number | null; nav_status: string | null };
  evidence: {
    has_track: boolean; merkle_root_hex: string | null;
    epsilon_m: number | null; segment_count: number;
    raw_points: number | null; dp_points: number | null;
    compressed_at: string | null; last_signed_at: string | null;
    gap_intervals: any; source_domain: string | null;
    latency_class: string | null; permanent_address: string | null;
  };
  stats: {
    fixes_today: number; fixes_24h: number; fixes_7d: number; total_fixes: number;
    avg_sog_kn_7d: number | null; max_sog_kn_7d: number | null;
    first_seen: string | null; last_fix_ts: string | null;
    days_tracked: number;
  };
  sources: Array<{ name: string; type: string; n: number; last_seen: string }>;
  charts: {
    speed_ts: SpeedBucket[];
    cog_hist: CogBin[];
    heatmap: HeatCell[];
    cumulative: CumulDay[];
    activity: Activity;
    msg_types: MsgType[];
  };
  events: VesselEvent[];
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function VesselDetailPage({ params }: { params: Promise<{ mmsi: string }> }) {
  const resolvedParams = use(params);
  const mmsi = Number(resolvedParams.mmsi);
  const [data, setData] = useState<VesselDetail | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
    try {
      const [mr, wr] = await Promise.allSettled([
        fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,ocean_current_velocity,ocean_current_direction&timezone=UTC`),
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m&forecast_days=1&timezone=UTC`),
      ]);
      let wave_m = 0, wave_period = 0, current_kn = 0, current_dir = 0, temp_c = 0, wind_kn = 0, wind_dir = 0;
      if (mr.status === "fulfilled" && mr.value.ok) {
        const m = await mr.value.json();
        wave_m = m.current?.wave_height ?? 0;
        wave_period = m.current?.wave_period ?? 0;
        current_kn = (m.current?.ocean_current_velocity ?? 0) * 1.944;
        current_dir = m.current?.ocean_current_direction ?? 0;
      }
      if (wr.status === "fulfilled" && wr.value.ok) {
        const w = await wr.value.json();
        temp_c = w.current?.temperature_2m ?? 0;
        wind_kn = (w.current?.wind_speed_10m ?? 0) * 0.5399;
        wind_dir = w.current?.wind_direction_10m ?? 0;
      }
      setWeather({ temp_c, wind_kn, wind_dir, wave_m, wave_period, current_kn, current_dir });
    } catch { /* weather is optional */ }
  }, []);

  useEffect(() => {
    if (!mmsi || isNaN(mmsi)) { setError("Invalid MMSI"); setLoading(false); return; }
    let cancelled = false;
    async function load() {
      try {
        const { data: raw, error: rpcErr } = await supabase.rpc("get_vessel_detail", { p_mmsi: mmsi });
        if (cancelled) return;
        if (rpcErr) { setError(rpcErr.message); setLoading(false); return; }
        const d = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (d?.error === "not_found") { setError("Vessel not found"); setLoading(false); return; }
        setData(d as VesselDetail);
        setLoading(false);
        if (d?.last?.lat && !cancelled) fetchWeather(d.last.lat, d.last.lon);
      } catch (e: any) { if (!cancelled) { setError(e.message ?? "Unknown error"); setLoading(false); } }
    }
    load();
    const timer = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [mmsi, fetchWeather]);

  if (loading) return <Loading mmsi={mmsi} />;
  if (error || !data) return <ErrorView error={error} />;

  const e = data.entity, l = data.last, v = data.voyage, ev = data.evidence;
  const st = data.stats, sr = data.sources, ch = data.charts;
  const cc = e.flag ?? mmsiFlag(mmsi);
  const co2 = l ? co2Estimate(l.speed_kn, e.length_m) : null;
  const totalNm = (ch.cumulative ?? []).reduce((s, d) => s + d.nm, 0);
  const fixRatePerHr = st.fixes_7d > 0 ? (st.fixes_7d / (st.days_tracked * 24)).toFixed(1) : null;
  // Tracked duration
  const trackedSec = st.first_seen ? (Date.now() / 1000 - new Date(st.first_seen).getTime() / 1000) : 0;

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.ink, fontFamily:C.mono }}>

      {/* ── Topbar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 20px", borderBottom:`1px solid ${C.border}`, background:C.panel }}>
        <Link href="/map" style={{ color:C.aqua, textDecoration:"none", fontSize:11, fontWeight:700 }}>← map</Link>
        <span style={{ color:C.ghost, fontSize:11 }}>/</span>
        <span style={{ color:C.dim, fontSize:11 }}>vessels</span>
        <span style={{ color:C.ghost, fontSize:11 }}>/</span>
        <span style={{ color:"#fff", fontSize:11, fontWeight:600 }}>{mmsi}</span>
        <div style={{ flex:1 }}/>
        {l && <Chip color={C.green}>● LIVE · {ago(l.age_sec)}</Chip>}
        {l && l.source_count >= 2 && <Chip color={C.aqua}>{l.source_count} SOURCES</Chip>}
        {ev.has_track && <Chip color={C.violet}>{ev.merkle_root_hex ? "▣ SIGNED" : "▣ TRACKED"}</Chip>}
        {co2 && l && l.speed_kn > 0.5 && <Chip color={co2.color}>CII {co2.ciiRating}</Chip>}
      </div>

      {/* ── Hero ── */}
      <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", borderBottom:`1px solid ${C.border}` }}>
        {/* Photo area */}
        <div style={{ position:"relative", background:`linear-gradient(160deg,#0d1e2e 0%,#071018 60%), url(/vessel-placeholder.svg) center/65% no-repeat`, borderRight:`1px solid ${C.border}`, minHeight:260, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
          <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:6, borderTop:`1px solid ${C.border}` }}>
            <span style={{ fontSize:10, color:C.dim, letterSpacing:"0.08em" }}>photo · community</span>
          </div>
        </div>
        {/* Name / IDs */}
        <div style={{ padding:"24px 32px", display:"flex", flexDirection:"column", justifyContent:"center", background:`linear-gradient(135deg,#0a1926,${C.bg})` }}>
          {/* Chips row */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:14 }}>
            {cc && <Chip color={C.dim}><FlagEmoji cc={cc}/>{cc} · {ccToName(cc).toUpperCase()}</Chip>}
            {e.type_text && <Chip color={C.aqua}>◆ {e.type_text.toUpperCase()}</Chip>}
            {v.nav_status && <Chip color={C.green}>{v.nav_status.toUpperCase()}</Chip>}
            {v.draught_m != null && e.domain_meta?.draught_max && v.draught_m / (e.domain_meta.draught_max as number) > 0.85
              && <Chip color={C.amber}>▲ CONSTRAINED BY DRAUGHT</Chip>}
            {totalNm > 5 && <Chip color={C.cyan}>▲ {Math.min(99, Math.round(totalNm / 10))}% OF VOYAGE</Chip>}
          </div>
          {/* Name */}
          <h1 style={{ fontSize:38, fontWeight:900, color:"#fff", letterSpacing:"-0.025em", margin:"0 0 8px", lineHeight:1 }}>
            {e.name || "UNKNOWN"}
          </h1>
          <div style={{ color:C.dim, fontSize:13, marginBottom:18, lineHeight:1.5 }}>
            {[e.type_text, e.length_m && e.beam_m ? `${e.length_m} m × ${e.beam_m} m` : e.length_m ? `${e.length_m} m` : null,
              e.domain_meta?.year_built ? `Built ${e.domain_meta.year_built}` : null,
              cc ? `Flag ${ccToName(cc)}` : null
            ].filter(Boolean).join(" · ")}
          </div>
          {/* IDs row */}
          <div style={{ display:"flex", gap:32, flexWrap:"wrap" }}>
            <IdBlock label="IMO" value={e.imo} color={C.aqua}/>
            <IdBlock label="MMSI" value={String(mmsi)} color={C.green}/>
            <IdBlock label="CALLSIGN" value={e.callsign} color={C.violet}/>
            <IdBlock label="AIS CLASS" value={e.entity_type === "vessel_b" ? "B" : e.ship_type != null && e.ship_type < 100 ? "A" : "—"} color={C.cyan}/>
          </div>
        </div>
      </div>

      {/* ── Stats strip — compact, 8 cells ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", borderBottom:`1px solid ${C.border}`, background:C.panelB }}>
        <StatCell label="Today" value={fmtN(st.fixes_today)} color={C.green} sub="since midnight"/>
        <StatCell label="24 h" value={fmtN(st.fixes_24h)} color={C.aqua} sub="fixes"/>
        <StatCell label="7 d" value={fmtN(st.fixes_7d)} color={C.cyan} sub={fixRatePerHr ? `avg ${fixRatePerHr}/hr` : "fixes"}/>
        <StatCell label="All time" value={fmtN(st.total_fixes)} color={C.violet} sub={`${st.days_tracked}d tracked`}/>
        <StatCell label="Avg speed" value={st.avg_sog_kn_7d != null ? `${st.avg_sog_kn_7d.toFixed(1)} kn` : "—"} color={C.aqua} sub="7 day average"/>
        <StatCell label="Max speed" value={st.max_sog_kn_7d != null ? `${st.max_sog_kn_7d.toFixed(1)} kn` : "—"} color={C.green} sub="7 day peak"/>
        <StatCell label="Distance" value={totalNm > 0 ? `${totalNm.toFixed(0)} nm` : "—"} color={C.cyan} sub="7 day sailed"/>
        <StatCell label="Tracked" value={trackedSec > 0 ? daysHours(trackedSec) : `${st.days_tracked}d`} color="#fff" sub="by aiss.network"/>
      </div>

      {/* ── KPI strip — big numbers ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", borderBottom:`1px solid ${C.border}`, background:C.bg }}>
        <Kpi big={l ? l.speed_kn.toFixed(1) : "—"} color={C.aqua} label="knots" sub="speed over ground"/>
        <Kpi big={String(l?.source_count ?? 0)} color={C.green} label="sources" sub="verifying right now"/>
        <Kpi big={ev.has_track ? String(ev.segment_count) : "—"} color={C.violet} label="segments" sub={ev.has_track ? `${ev.merkle_root_hex ? "signed" : "tracked"} · ε${ev.epsilon_m ?? "?"}m` : "no track"}/>
        <Kpi big={v.draught_m != null ? `${v.draught_m}m` : "—"} color={C.amber} label="draught" sub={e.domain_meta?.draught_max ? `max ${e.domain_meta.draught_max} m` : "reported"}/>
        <Kpi big={String(st.fixes_7d)} color={C.cyan} label="fixes / 7 d" sub={fixRatePerHr ? `avg ${fixRatePerHr} / hour` : "—"}/>
        <Kpi big={trackedSec > 0 ? daysHours(trackedSec) : `${st.days_tracked}d`} color="#fff" label="tracked" sub="by aiss.network"/>
      </div>

      {/* ── Voyage bar ── */}
      <div style={{ padding:"14px 28px", borderBottom:`1px solid ${C.border}`, background:C.panel, display:"grid", gridTemplateColumns:"210px 1fr 260px", gap:20, alignItems:"center" }}>
        {/* Departure */}
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:"0.06em", fontVariantNumeric:"tabular-nums" }}>
            {cc ?? "—"} · {e.domain_meta?.home_port ? (e.domain_meta.home_port as string).toUpperCase().slice(0,10) : "ORIGIN"}
          </div>
          <div style={{ fontSize:10, color:C.faint, marginTop:2, letterSpacing:"0.08em" }}>
            {e.domain_meta?.home_port ?? ccToName(cc)}
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height:4, background:`${C.aqua}18`, borderRadius:2, position:"relative" }}>
          <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${Math.min(95, Math.max(5, Math.round(totalNm/10)))}%`, background:`linear-gradient(to right,${C.aqua}60,${C.aqua})`, borderRadius:2, boxShadow:`0 0 8px ${C.aqua}50` }}/>
          <div style={{ position:"absolute", left:`${Math.min(95,Math.max(5,Math.round(totalNm/10)))}%`, top:"50%", transform:"translate(-50%,-50%)", color:C.aqua, fontSize:10 }}>▶</div>
        </div>
        {/* Destination + ETA */}
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:"0.06em" }}>{v.destination ?? "—"}</div>
          <div style={{ fontSize:9, color:C.faint, marginTop:2, letterSpacing:"0.1em", textTransform:"uppercase" }}>
            {v.destination ? "DESTINATION · UNCONFIRMED PORT" : "NO DESTINATION REPORTED"}
          </div>
          <div style={{ marginTop:5, fontSize:10, color:C.dim }}>
            {st.first_seen && <span style={{ marginRight:12 }}>ATD <span style={{ color:C.aqua2 }}>{fmtDateTime(st.first_seen)}</span></span>}
            {v.eta && <span>ETA <span style={{ color:C.green }}>{v.eta}</span></span>}
          </div>
        </div>
      </div>

      {/* ── 3 data columns ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", borderBottom:`1px solid ${C.border}` }}>

        {/* Latest AIS fix */}
        <DataCol title="Latest AIS fix" icon="◉" color={C.aqua}>
          {l ? (<>
            <KV label="Latitude"        value={fmtCoord(l.lat, "lat")} hl/>
            <KV label="Longitude"       value={fmtCoord(l.lon, "lon")} hl/>
            <KV label="Speed over ground" value={`${l.speed_kn.toFixed(1)} kn`} color={C.aqua}/>
            <KV label="Course over ground" value={`${l.cog.toFixed(1)}°`}/>
            <KV label="True heading"    value={l.heading != null && l.heading !== 511 ? `${l.heading}°` : "—"}/>
            <KV label="Rate of turn"    value={l.sensors?.rot != null ? `${l.sensors.rot.toFixed(1)} °/min` : "—"}/>
            <KV label="Position accuracy" value={l.sensors?.raim === true ? "< 10 m (DGPS)" : l.sensors?.raim === false ? "> 10 m" : "—"} color={l.sensors?.raim === true ? C.green : undefined}/>
            <KV label="Nav status"      value={l.nav_status ?? "—"} color={l.nav_status ? C.amber : undefined}/>
            <KV label="Source"          value={l.source}/>
            <KV label="Source count"    value={`${l.source_count} concurrent`} color={l.source_count >= 2 ? C.green : C.dim}/>
            <KV label="Received"        value={ago(l.age_sec)} color={l.age_sec < 120 ? C.green : l.age_sec < 600 ? C.amber : C.red}/>
          </>) : <div style={{ color:C.faint, fontSize:12, padding:"12px 0" }}>No live data</div>}
        </DataCol>

        {/* Vessel */}
        <DataCol title="Vessel" icon="▣" color={C.green}>
          <KV label="Name"            value={e.name ?? "—"} hl/>
          <KV label="Type"            value={e.type_text ?? "—"}/>
          <KV label="Ship type code"  value={e.ship_type != null ? String(e.ship_type) : "—"}/>
          <KV label="Length / Beam"   value={e.length_m ? `${e.length_m} m / ${e.beam_m ?? "?"} m` : "—"}/>
          <KV label="Draught (max)"   value={e.domain_meta?.draught_max != null ? `${e.domain_meta.draught_max} m` : "—"}/>
          <KV label="Draught (now)"   value={v.draught_m != null ? `${v.draught_m} m` : "—"} color={v.draught_m != null ? C.amber : undefined}/>
          <KV label="Gross tonnage"   value={e.domain_meta?.gross_tonnage != null ? String(e.domain_meta.gross_tonnage) : "—"}/>
          <KV label="Deadweight"      value={e.domain_meta?.deadweight_t != null ? `${e.domain_meta.deadweight_t} DWT` : "—"}/>
          <KV label="Year built"      value={e.domain_meta?.year_built != null ? String(e.domain_meta.year_built) : "—"}/>
          <KV label="Flag"            value={cc ? ccToName(cc) : "—"}/>
          <KV label="Home port"       value={e.domain_meta?.home_port ?? "—"}/>
          <KV label="First seen"      value={fmtDate(e.first_seen)}/>
        </DataCol>

        {/* Voyage */}
        <DataCol title="Voyage" icon="▲" color={C.violet}>
          <KV label="Departure"       value={e.domain_meta?.home_port ?? (cc ? ccToName(cc) : "—")} hl/>
          <KV label="Destination"     value={v.destination ?? "—"} hl/>
          <KV label="Matched port"    value={e.domain_meta?.matched_port ?? "—"}/>
          <KV label="ATD"             value={st.first_seen ? fmtDate(st.first_seen) : "—"}/>
          <KV label="ETA (reported)"  value={v.eta ?? "—"} color={v.eta ? C.aqua2 : undefined}/>
          <KV label="ETA (computed)"  value={
            (totalNm > 0 && st.avg_sog_kn_7d && st.avg_sog_kn_7d > 0.5 && l)
              ? (() => {
                  const hoursLeft = (totalNm * 1.3) / st.avg_sog_kn_7d; // rough remaining
                  const eta = new Date(Date.now() + hoursLeft * 3600_000);
                  return fmtDateTime(eta.toISOString());
                })()
              : "—"
          } color={C.cyan}/>
          <KV label="Nav status"      value={v.nav_status ?? "—"} color={v.nav_status ? C.amber : undefined}/>
          <KV label="Progress"        value={totalNm > 0 ? `${Math.min(99, Math.round(totalNm / 10))}%` : "—"}/>
          <KV label="Distance covered" value={totalNm > 0 ? `${totalNm.toFixed(0)} nm` : "—"} color={C.cyan}/>
          <KV label="Avg speed (7d)"  value={st.avg_sog_kn_7d != null ? `${st.avg_sog_kn_7d.toFixed(1)} kn` : "—"}/>
          <KV label="Max speed (7d)"  value={st.max_sog_kn_7d != null ? `${st.max_sog_kn_7d.toFixed(1)} kn` : "—"}/>
        </DataCol>
      </div>

      {/* ── Charts row 1: Speed+Draught + Compass ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:"20px 24px", borderRight:`1px solid ${C.border}` }}>
          <SectionHead icon="◉" color={C.aqua} title="Speed & draught · 48 h"
            legend={<><LegDot c={C.aqua}/>speed kn <LegDot c={C.amber} style={{marginLeft:10}}/>draught m</>}/>
          <SpeedDraughtChart data={ch.speed_ts ?? []} draughtM={v.draught_m}/>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <SectionHead icon="◈" color={C.violet} title="Course distribution · 7 d" legend="compass rose"/>
          <CompassRose data={ch.cog_hist ?? []}/>
        </div>
      </div>

      {/* ── Charts row 2: Heatmap + Activity donut ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:"20px 24px", borderRight:`1px solid ${C.border}` }}>
          <SectionHead icon="■" color={C.green} title="Reception heatmap · 7 d × 24 h"
            legend={<><LegDot c={`${C.green}30`}/>low <LegDot c={C.green} style={{marginLeft:8}}/>high</>}/>
          <Heatmap data={ch.heatmap ?? []}/>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <SectionHead icon="◐" color={C.cyan} title="Activity · 7 d" legend="at-sea vs at-port"/>
          <ActivityDonut activity={ch.activity}/>
        </div>
      </div>

      {/* ── Charts row 3: Cumulative + AIS types ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:"20px 24px", borderRight:`1px solid ${C.border}` }}>
          <SectionHead icon="↗" color={C.violet} title="Cumulative distance · 7 d" legend={`${totalNm.toFixed(1)} nm total`}/>
          <CumulativeChart data={ch.cumulative ?? []}/>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <SectionHead icon="▤" color={C.violet} title="AIS message types · 7 d" legend={`${(ch.msg_types ?? []).length} types`}/>
          <MsgTypeChart data={ch.msg_types ?? []}/>
        </div>
      </div>

      {/* ── Charts row 4: Source bars + Weather ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:"20px 24px", borderRight:`1px solid ${C.border}` }}>
          <SectionHead icon="≈" color={C.green} title="Source breakdown · 1 h" legend={`${sr.length} sources`}/>
          <SourceBars sources={sr}/>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <SectionHead icon="☁" color={C.cyan} title="Weather at position" legend="open-meteo marine"/>
          <WeatherWidget weather={weather} lat={l?.lat} lon={l?.lon}/>
        </div>
      </div>

      {/* ── Speed gauge + CO₂ row ── */}
      <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:"20px 24px", borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", alignItems:"center" }}>
          <SectionHead icon="◉" color={C.aqua} title="Speed gauge" legend="live"/>
          <SpeedGauge speed={l?.speed_kn ?? 0} maxSpeed={st.max_sog_kn_7d ?? 15}/>
        </div>
        <div style={{ padding:"20px 24px" }}>
          <SectionHead icon="♻" color={co2?.color ?? C.dim} title="CO₂ & fuel estimate" legend="IMO CII formula"/>
          {co2 && l ? (
            <Co2Panel co2={co2} speedKn={l.speed_kn} lengthM={e.length_m}/>
          ) : (
            <div style={{ color:C.faint, fontSize:12 }}>Vessel not under way</div>
          )}
        </div>
      </div>

      {/* ── Events timeline (if any) ── */}
      {(data.events ?? []).length > 0 && (
        <div style={{ padding:"20px 24px", borderBottom:`1px solid ${C.border}` }}>
          <SectionHead icon="◆" color={C.amber} title="Events · 7 d" legend={`${data.events.length} detected`}/>
          <EventsTimeline events={data.events}/>
        </div>
      )}

      {/* ── Evidence ── */}
      <div style={{ padding:"22px 24px", borderBottom:`1px solid ${C.border}`,
        background:`radial-gradient(600px 200px at 80% 0%,${C.aqua}09,transparent 60%)` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <h2 style={{ margin:0, fontSize:14, color:"#fff", fontWeight:600, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:C.aqua, boxShadow:`0 0 12px ${C.aqua}` }}/>
            Evidence chain
          </h2>
          <span style={{ fontSize:10, color:C.violet, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:600 }}>AISS BEVISCHAIN</span>
        </div>
        {ev.has_track && <EvidenceTree evidence={ev} stats={st}/>}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginTop:14 }}>
          <TrustCard color={C.aqua}>
            <BigMetric n={l?.source_count ?? 0} color={C.aqua} unit="sources"/>
            <div style={{ fontSize:10, color:C.dim, marginTop:6, lineHeight:1.6 }}>Concurrent sources reporting right now.</div>
            {sr.length > 0 && <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:8 }}>{sr.map(s => <Pill key={s.name} color={C.green}>{s.name} ({s.n})</Pill>)}</div>}
          </TrustCard>
          <TrustCard color={C.green}>
            <BigMetric n={st.fixes_7d} color={C.green} unit="fixes · 7d"/>
            <div style={{ fontSize:10, color:C.dim, marginTop:6, lineHeight:1.6 }}>CRC-verified positions last 7 days.</div>
            <MiniBarChart color={C.green} data={(ch.speed_ts ?? []).slice(-8).map(b => b.n)}/>
          </TrustCard>
          <TrustCard color={C.violet}>
            <BigMetric n={ev.has_track ? (ev.dp_points ?? 0) : 0} color={C.violet} unit="D·P points"/>
            <div style={{ fontSize:10, color:C.dim, marginTop:6, lineHeight:1.6 }}>
              {ev.has_track ? `${fmtN(ev.raw_points ?? 0)} raw → ε ${ev.epsilon_m ?? "?"}m` : "No compressed track yet"}
            </div>
          </TrustCard>
          <TrustCard color={C.cyan}>
            <BigMetric n={Math.round(totalNm)} color={C.cyan} unit="NM · 7d"/>
            <div style={{ fontSize:10, color:C.dim, marginTop:6, lineHeight:1.6 }}>Sailed distance by Haversine.</div>
            <MiniBarChart color={C.cyan} data={(ch.cumulative ?? []).map(d => d.nm)}/>
          </TrustCard>
        </div>
        {ev.merkle_root_hex && (
          <div style={{ marginTop:12, padding:"10px 14px", borderRadius:7, background:"rgba(4,12,20,0.7)", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10, overflow:"hidden" }}>
            <span style={{ color:C.violet, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:700, flexShrink:0 }}>MERKLE ROOT</span>
            <span style={{ color:C.aqua2, fontSize:11, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>0x{ev.merkle_root_hex}</span>
            <button onClick={() => navigator.clipboard.writeText(`0x${ev.merkle_root_hex}`)} style={{ background:"transparent", border:`1px solid ${C.border}`, color:C.dim, fontFamily:C.mono, fontSize:10, padding:"3px 8px", borderRadius:4, cursor:"pointer" }}>copy</button>
          </div>
        )}
      </div>

      {/* ── Mini-map ── */}
      {l && (
        <div style={{ padding:"20px 24px", borderBottom:`1px solid ${C.border}` }}>
          <SectionHead icon="◎" color={C.aqua} title="Position preview"
            legend={`${fmtCoord(l.lat,"lat")} · ${fmtCoord(l.lon,"lon")}`}/>
          <MiniMap lat={l.lat} lon={l.lon} name={e.name}/>
        </div>
      )}

      {/* ── Field inventory ── */}
      <div style={{ padding:"20px 24px", borderBottom:`1px solid ${C.border}` }}>
        <SectionHead icon="▤" color={C.dim} title="Field inventory" legend="data availability status"/>
        <FieldInventory entity={e} last={l} voyage={v} evidence={ev} weather={weather}/>
      </div>

      {/* ── Footer ── */}
      <div style={{ padding:"16px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", background:C.panel }}>
        <Link href="/map" style={{ color:C.aqua, textDecoration:"none", fontSize:11 }}>← back to map</Link>
        <span style={{ fontSize:9, color:C.ghost, letterSpacing:"0.2em", textTransform:"uppercase" }}>free to read · trusted to write · aiss.network</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════════════════════════════ */

function SpeedDraughtChart({ data, draughtM }: { data: SpeedBucket[]; draughtM: number | null }) {
  if (!data.length) return <div style={{ height:150, display:"grid", placeItems:"center", color:C.faint, fontSize:12 }}>No speed data yet</div>;
  const W = 600, H = 140, PAD = 4;
  const maxS = Math.max(...data.map(d => d.max_sog), 1);
  const toX = (i: number) => PAD + (i / (data.length - 1 || 1)) * (W - PAD * 2);
  const toY = (v: number) => H - PAD - (v / maxS) * (H - PAD * 2 - 10);
  const avgPts = data.map((d, i) => `${toX(i)},${toY(d.avg_sog)}`).join(" ");
  const maxPts = data.map((d, i) => `${toX(i)},${toY(d.max_sog)}`).join(" ");
  const fillPts = `${PAD},${H} ${avgPts} ${toX(data.length - 1)},${H}`;

  // Draught line (constant, as fraction of speed axis for overlay)
  const draughtY = draughtM != null ? toY(draughtM * 0.5) : null; // scale draught loosely

  return (
    <div style={{ background:`${C.aqua}06`, border:`1px solid ${C.aqua}14`, borderRadius:10, padding:10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:150, display:"block" }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.aqua} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={C.aqua} stopOpacity="0.02"/>
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1="0" y1={toY(maxS*f)} x2={W} y2={toY(maxS*f)} stroke={`${C.aqua}14`} strokeDasharray="2 4"/>
        ))}
        <polygon fill="url(#sg)" points={fillPts}/>
        <polyline fill="none" stroke={`${C.green}80`} strokeWidth="1.5" strokeDasharray="4 3" points={maxPts}/>
        <polyline fill="none" stroke={C.aqua} strokeWidth="2" strokeLinejoin="round" points={avgPts}/>
        {/* Draught reference line */}
        {draughtY != null && (
          <>
            <line x1="0" y1={draughtY} x2={W} y2={draughtY} stroke={C.amber} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.7"/>
            <text x={W - 4} y={draughtY - 4} fill={C.amber} fontSize="9" textAnchor="end" fontFamily="var(--font-jetbrains,monospace)">draught {draughtM}m</text>
          </>
        )}
        <circle cx={toX(data.length - 1)} cy={toY(data[data.length - 1].avg_sog)} r="3" fill={C.aqua}/>
        <text x="4" y="12" fill={C.dim} fontSize="9" fontFamily="var(--font-jetbrains,monospace)">kn</text>
        <text x={W - 4} y="12" fill={C.dim} fontSize="9" textAnchor="end" fontFamily="var(--font-jetbrains,monospace)">{maxS.toFixed(1)} max</text>
        <text x="0" y={H - 2} fill={C.faint} fontSize="9" fontFamily="var(--font-jetbrains,monospace)">-48h</text>
        <text x={W/2} y={H - 2} fill={C.faint} fontSize="9" textAnchor="middle" fontFamily="var(--font-jetbrains,monospace)">-24h</text>
        <text x={W} y={H - 2} fill={C.faint} fontSize="9" textAnchor="end" fontFamily="var(--font-jetbrains,monospace)">now</text>
      </svg>
    </div>
  );
}

function SpeedGauge({ speed, maxSpeed }: { speed: number; maxSpeed: number }) {
  const max = Math.max(maxSpeed * 1.2, 5);
  const pct = Math.min(speed / max, 1);
  const startAngle = -225, endAngle = 45, sweep = 270;
  const currentAngle = startAngle + pct * sweep;
  const R = 70, cx = 85, cy = 85;
  const arc = (deg: number) => ({ x: cx + R * Math.cos(deg * Math.PI / 180), y: cy + R * Math.sin(deg * Math.PI / 180) });
  const start = arc(startAngle), end = arc(currentAngle), bgEnd = arc(endAngle);
  const largeArc = (currentAngle - startAngle) > 180 ? 1 : 0;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = startAngle + (i / 10) * sweep;
    const p1 = arc(a), r2 = a * Math.PI / 180;
    const p2 = { x: cx + (R - 8) * Math.cos(r2), y: cy + (R - 8) * Math.sin(r2) };
    const lp = { x: cx + (R + 14) * Math.cos(r2), y: cy + (R + 14) * Math.sin(r2) };
    return { p1, p2, lp, val: (i / 10 * max).toFixed(0), major: i % 5 === 0 };
  });
  return (
    <svg viewBox="0 0 170 130" style={{ width:170, height:130 }}>
      <path d={`M ${start.x} ${start.y} A ${R} ${R} 0 1 1 ${bgEnd.x} ${bgEnd.y}`} fill="none" stroke={`${C.aqua}18`} strokeWidth="6" strokeLinecap="round"/>
      {pct > 0.01 && <path d={`M ${start.x} ${start.y} A ${R} ${R} 0 ${largeArc} 1 ${end.x} ${end.y}`} fill="none" stroke={C.aqua} strokeWidth="6" strokeLinecap="round" style={{ filter:`drop-shadow(0 0 6px ${C.aqua})` }}/>}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.p1.x} y1={t.p1.y} x2={t.p2.x} y2={t.p2.y} stroke={t.major ? C.dim : C.ghost} strokeWidth={t.major ? 1.5 : 0.7}/>
          {t.major && <text x={t.lp.x} y={t.lp.y} textAnchor="middle" dominantBaseline="middle" fill={C.faint} fontSize="8" fontFamily="var(--font-jetbrains,monospace)">{t.val}</text>}
        </g>
      ))}
      <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="4" fill={C.aqua}/>
      <text x={cx} y={cy + 24} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800" fontFamily="var(--font-jetbrains,monospace)">{speed.toFixed(1)}</text>
      <text x={cx} y={cy + 35} textAnchor="middle" fill={C.dim} fontSize="8" fontFamily="var(--font-jetbrains,monospace)">KNOTS</text>
    </svg>
  );
}

function CompassRose({ data }: { data: CogBin[] }) {
  if (!data.length) return <div style={{ height:200, display:"grid", placeItems:"center", color:C.faint, fontSize:12 }}>No course data</div>;
  const maxN = Math.max(...data.map(d => d.n), 1);
  const cx = 100, cy = 100, R = 75;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <svg viewBox="0 0 200 200" style={{ width:190, height:190 }}>
        {[1, 0.66, 0.33].map(f => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke={`${C.aqua}14`}/>)}
        {[{deg:0,lbl:"N"},{deg:90,lbl:"E"},{deg:180,lbl:"S"},{deg:270,lbl:"W"}].map(c => (
          <text key={c.lbl} x={cx + Math.sin(c.deg*Math.PI/180)*(R+12)} y={cy - Math.cos(c.deg*Math.PI/180)*(R+12) + 4} textAnchor="middle" fill={C.dim} fontFamily="var(--font-jetbrains,monospace)" fontSize="10">{c.lbl}</text>
        ))}
        {data.map(d => {
          const a = d.bin_deg * Math.PI / 180;
          const len = (d.n / maxN) * R;
          return <line key={d.bin_deg} x1={cx} y1={cy} x2={cx + Math.sin(a)*len} y2={cy - Math.cos(a)*len}
            stroke={C.violet} strokeWidth="7" strokeLinecap="round" opacity={0.3 + (d.n/maxN)*0.7}/>;
        })}
        <circle cx={cx} cy={cy} r="3" fill="#fff"/>
      </svg>
      {(() => {
        const dom = data.reduce((a,b) => b.n > a.n ? b : a, data[0]);
        return <div style={{ fontSize:10, color:C.faint, marginTop:4 }}>dominant: <span style={{ color:C.violet }}>{dom.bin_deg}°</span></div>;
      })()}
    </div>
  );
}

function Heatmap({ data }: { data: HeatCell[] }) {
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const maxN = Math.max(...data.map(d => d.n), 1);
  const lookup: Record<string, number> = {};
  data.forEach(d => { lookup[`${d.dow}-${d.hr}`] = d.n; });
  return (
    <div>
      <div style={{ display:"flex", gap:2, marginLeft:40, marginBottom:4, fontSize:8, color:C.faint }}>
        {Array.from({length:24},(_,i) => <span key={i} style={{ flex:1, textAlign:"center" }}>{i%3===0 ? String(i).padStart(2,"0") : ""}</span>)}
      </div>
      {DAYS.map((day, dow) => (
        <div key={day} style={{ display:"flex", gap:2, alignItems:"center", marginBottom:2 }}>
          <span style={{ width:36, fontSize:9, color:C.faint, textAlign:"right", paddingRight:6, flexShrink:0 }}>{day}</span>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(24,1fr)", gap:2, flex:1 }}>
            {Array.from({length:24},(_,hr) => {
              const n = lookup[`${dow}-${hr}`] ?? 0;
              return <div key={hr} style={{ aspectRatio:"1", borderRadius:2, background: n>0 ? `rgba(0,230,118,${0.08+(n/maxN)*0.82})` : `${C.aqua}0a` }} title={`${day} ${hr}:00 — ${n}`}/>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityDonut({ activity }: { activity: Activity }) {
  if (!activity || activity.total_fixes === 0) return <div style={{ height:200, display:"grid", placeItems:"center", color:C.faint, fontSize:12 }}>No activity data</div>;
  const cx = 90, cy = 90, R = 65, sw = 14;
  const C2 = 2 * Math.PI * R;
  const seaLen = (activity.at_sea_pct / 100) * C2;
  const portLen = (activity.at_port_pct / 100) * C2;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <svg viewBox="0 0 180 180" style={{ width:180, height:180 }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={`${C.amber}30`} strokeWidth={sw}
          strokeDasharray={`${portLen} ${C2}`} strokeDashoffset={-seaLen} transform={`rotate(-90 ${cx} ${cy})`}/>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={C.aqua} strokeWidth={sw}
          strokeDasharray={`${seaLen} ${C2}`} transform={`rotate(-90 ${cx} ${cy})`}
          style={{ filter:`drop-shadow(0 0 4px ${C.aqua}60)` }}/>
        <text x={cx} y={cy-8} textAnchor="middle" fill="#fff" fontSize="20" fontWeight="800" fontFamily="var(--font-jetbrains,monospace)">{activity.at_sea_pct}%</text>
        <text x={cx} y={cy+8} textAnchor="middle" fill={C.dim} fontSize="9" fontFamily="var(--font-jetbrains,monospace)">AT SEA</text>
        <text x={cx} y={cy+22} textAnchor="middle" fill={C.faint} fontSize="8" fontFamily="var(--font-jetbrains,monospace)">{activity.total_fixes} fixes</text>
      </svg>
      <div style={{ display:"flex", gap:16, marginTop:4, fontSize:10 }}>
        <span><LegDot c={C.aqua}/>At sea · {activity.at_sea_fixes}</span>
        <span><LegDot c={`${C.amber}60`}/>At port · {activity.at_port_fixes}</span>
      </div>
    </div>
  );
}

function CumulativeChart({ data }: { data: CumulDay[] }) {
  if (!data.length) return <div style={{ height:130, display:"grid", placeItems:"center", color:C.faint, fontSize:12 }}>No distance data</div>;
  const W = 500, H = 120, PAD = 4;
  let running = 0;
  const cumul = data.map(d => { running += d.nm; return { ...d, total: running }; });
  const maxT = Math.max(...cumul.map(c => c.total), 0.1);
  const toX = (i: number) => PAD + (i / (cumul.length - 1 || 1)) * (W - PAD * 2);
  const toY = (v: number) => H - PAD - 12 - (v / maxT) * (H - PAD * 2 - 20);
  const pts = cumul.map((c, i) => `${toX(i)},${toY(c.total)}`).join(" ");
  const fillPts = `${PAD},${H-12} ${pts} ${toX(cumul.length-1)},${H-12}`;
  return (
    <div style={{ background:`${C.violet}06`, border:`1px solid ${C.violet}14`, borderRadius:10, padding:10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:130, display:"block" }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.violet} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={C.violet} stopOpacity="0.02"/>
          </linearGradient>
        </defs>
        {cumul.map((c, i) => {
          const barH = Math.max(2, (c.nm / maxT) * (H - PAD * 2 - 20));
          return <rect key={`b${i}`} x={toX(i)-8} y={H-12-barH} width={16} height={barH} fill={`${C.violet}15`} rx={2}/>;
        })}
        <polygon fill="url(#vg)" points={fillPts}/>
        <polyline fill="none" stroke={C.violet} strokeWidth="2.5" strokeLinejoin="round" points={pts}/>
        {cumul.map((c, i) => <circle key={i} cx={toX(i)} cy={toY(c.total)} r="3" fill={C.violet}/>)}
        {cumul.map((c, i) => (
          <text key={i} x={toX(i)} y={H-1} textAnchor="middle" fill={C.faint} fontSize="8" fontFamily="var(--font-jetbrains,monospace)">
            {new Date(c.day).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}
          </text>
        ))}
        <text x="4" y="12" fill={C.dim} fontSize="9" fontFamily="var(--font-jetbrains,monospace)">NM</text>
        <text x={W-4} y="12" fill={C.violet} fontSize="9" textAnchor="end" fontFamily="var(--font-jetbrains,monospace)">{maxT.toFixed(1)} total</text>
      </svg>
    </div>
  );
}

function MsgTypeChart({ data }: { data: MsgType[] }) {
  if (!data.length) return <div style={{ height:120, display:"grid", placeItems:"center", color:C.faint, fontSize:12 }}>No message type data</div>;
  const total = data.reduce((s, d) => s + d.n, 0);
  const COLORS = [C.aqua, C.green, C.violet, C.cyan, C.amber, C.red];
  return (
    <div>
      <div style={{ display:"flex", height:18, borderRadius:5, overflow:"hidden", marginBottom:10 }}>
        {data.map((d, i) => (
          <div key={d.msg_type} style={{ width:`${(d.n/total)*100}%`, background:COLORS[i%COLORS.length], minWidth:2 }}
            title={`Type ${d.msg_type}: ${d.n}`}/>
        ))}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {data.map((d, i) => (
          <div key={d.msg_type} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:7, height:7, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }}/>
            <span style={{ fontSize:11, color:C.ink, flex:1 }}>Type {d.msg_type} <span style={{ color:C.faint }}>· {MSG_TYPE_LABELS[d.msg_type] ?? "—"}</span></span>
            <span style={{ fontSize:11, color:COLORS[i%COLORS.length], fontWeight:600 }}>{fmtN(d.n)}</span>
            <span style={{ fontSize:9, color:C.faint, width:38, textAlign:"right" }}>{((d.n/total)*100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceBars({ sources }: { sources: VesselDetail["sources"] }) {
  if (!sources.length) return <div style={{ color:C.faint, fontSize:12, padding:"20px 0" }}>No sources in the last hour</div>;
  const maxN = Math.max(...sources.map(s => s.n), 1);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
      {sources.map(s => {
        const pct = (s.n / maxN) * 100;
        const color = pct > 60 ? C.green : pct > 30 ? C.aqua : C.amber;
        return (
          <div key={s.name} style={{ display:"grid", gridTemplateColumns:"110px 1fr 50px", gap:10, alignItems:"center" }}>
            <span style={{ fontSize:11, color:C.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</span>
            <div style={{ height:5, background:`${C.aqua}15`, borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(to right,${color},${C.aqua})`, borderRadius:3 }}/>
            </div>
            <span style={{ fontSize:11, color, textAlign:"right" }}>{s.n}</span>
          </div>
        );
      })}
    </div>
  );
}

function WeatherWidget({ weather, lat, lon }: { weather: Weather | null; lat?: number; lon?: number }) {
  if (!weather) return <div style={{ display:"grid", placeItems:"center", height:120, color:C.faint, fontSize:12 }}>{lat ? "Loading weather…" : "No position"}</div>;
  const bf = weather.wind_kn < 1 ? 0 : weather.wind_kn < 4 ? 1 : weather.wind_kn < 7 ? 2 : weather.wind_kn < 11 ? 3 : weather.wind_kn < 17 ? 4 : weather.wind_kn < 22 ? 5 : weather.wind_kn < 28 ? 6 : weather.wind_kn < 34 ? 7 : 8;
  const bfColor = bf <= 3 ? C.green : bf <= 5 ? C.amber : C.red;
  const items = [
    { label:"Air temp", value:`${weather.temp_c.toFixed(1)}°C`, color:C.amber },
    { label:"Wind", value:`${weather.wind_kn.toFixed(0)} kn · ${weather.wind_dir}°`, color:C.cyan },
    { label:"Waves", value:`${weather.wave_m.toFixed(1)} m · ${weather.wave_period.toFixed(0)}s`, color:C.aqua },
    { label:"Current", value:`${weather.current_kn.toFixed(1)} kn · ${weather.current_dir}°`, color:C.green },
  ];
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
        {items.map(it => (
          <div key={it.label} style={{ padding:"8px 12px", borderRadius:7, background:`${it.color}08`, border:`1px solid ${it.color}20` }}>
            <div style={{ fontSize:9, color:C.faint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:3 }}>{it.label}</div>
            <div style={{ fontSize:14, fontWeight:700, color:it.color }}>{it.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:6, background:`${bfColor}10`, border:`1px solid ${bfColor}25` }}>
        <span style={{ fontSize:16, fontWeight:800, color:bfColor }}>BF {bf}</span>
        <span style={{ fontSize:10, color:C.dim }}>Beaufort scale</span>
        <div style={{ flex:1 }}/><span style={{ fontSize:9, color:C.faint }}>open-meteo.com</span>
      </div>
    </div>
  );
}

function Co2Panel({ co2, speedKn, lengthM }: { co2: ReturnType<typeof co2Estimate>; speedKn: number; lengthM: number | null }) {
  const ratings = ["A","B","C","D","E"];
  const colors: Record<string, string> = { A:C.green, B:C.aqua, C:C.amber, D:C.amber, E:C.red };
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:14 }}>
        {ratings.map(r => (
          <div key={r} style={{ flex:1, textAlign:"center", padding:"8px 4px", borderRadius:6,
            background: r === co2.ciiRating ? `${co2.color}20` : "transparent",
            border:`1px solid ${r === co2.ciiRating ? co2.color : C.ghost}`,
            color: r === co2.ciiRating ? co2.color : C.faint,
            fontWeight: r === co2.ciiRating ? 800 : 400, fontSize:14 }}>
            {r}
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
        <div style={{ padding:"10px 12px", borderRadius:8, background:`${co2.color}08`, border:`1px solid ${co2.color}20` }}>
          <div style={{ fontSize:9, color:C.faint, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>CO₂/day</div>
          <div style={{ fontSize:18, fontWeight:700, color:co2.color }}>{co2.tonsPerDay.toFixed(1)}<span style={{ fontSize:10, color:C.dim }}> t</span></div>
        </div>
        <div style={{ padding:"10px 12px", borderRadius:8, background:`${C.amber}08`, border:`1px solid ${C.amber}20` }}>
          <div style={{ fontSize:9, color:C.faint, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Fuel/day</div>
          <div style={{ fontSize:18, fontWeight:700, color:C.amber }}>{(co2.tonsPerDay/3.114).toFixed(1)}<span style={{ fontSize:10, color:C.dim }}> t</span></div>
        </div>
        <div style={{ padding:"10px 12px", borderRadius:8, background:`${C.dim}08`, border:`1px solid ${C.ghost}` }}>
          <div style={{ fontSize:9, color:C.faint, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>At {speedKn.toFixed(1)} kn</div>
          <div style={{ fontSize:14, fontWeight:600, color:C.dim }}>{(speedKn * 1.852).toFixed(1)}<span style={{ fontSize:10 }}> km/h</span></div>
        </div>
      </div>
      <div style={{ marginTop:8, fontSize:10, color:C.faint }}>* Estimate based on IMO CII formula. Actual consumption depends on vessel type, load, weather.</div>
    </div>
  );
}

function EventsTimeline({ events }: { events: VesselEvent[] }) {
  const EVENT_COLORS: Record<string, string> = { nav_status_change:C.amber, departure:C.green, arrival:C.violet };
  const EVENT_ICONS: Record<string, string> = { nav_status_change:"⚠", departure:"▶", arrival:"■" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:0, position:"relative", paddingLeft:20 }}>
      <div style={{ position:"absolute", left:8, top:4, bottom:4, width:2, background:`${C.aqua}20`, borderRadius:1 }}/>
      {events.slice(0,15).map((ev, i) => {
        const color = EVENT_COLORS[ev.event_type] ?? C.dim;
        return (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"7px 0", position:"relative" }}>
            <div style={{ position:"absolute", left:-14, top:11, width:10, height:10, borderRadius:"50%", background:C.bg, border:`2px solid ${color}` }}/>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ color, fontSize:11, fontWeight:600 }}>{EVENT_ICONS[ev.event_type] ?? "●"} {ev.event_type.replace(/_/g," ")}</span>
                <span style={{ fontSize:10, color:C.faint }}>{fmtDateTime(ev.t)}</span>
              </div>
              <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>
                {ev.event_type === "nav_status_change" && ev.detail?.from && ev.detail?.to
                  ? `${ev.detail.from} → ${ev.detail.to}`
                  : ev.detail?.speed_kn != null ? `Speed: ${Number(ev.detail.speed_kn).toFixed(1)} kn` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceTree({ evidence, stats }: { evidence: VesselDetail["evidence"]; stats: VesselDetail["stats"] }) {
  const nodes = [
    { label:"RAW FIXES", value:fmtN(evidence.raw_points ?? stats.fixes_7d), color:C.green, desc:"CRC-verified AIS" },
    { label:"SEGMENTS", value:String(evidence.segment_count), color:C.aqua, desc:"Continuous segments" },
    { label:"D·P COMPRESS", value:`${fmtN(evidence.dp_points ?? 0)} pts`, color:C.violet, desc:`ε ${evidence.epsilon_m ?? "?"}m` },
    { label:"MERKLE ROOT", value:evidence.merkle_root_hex ? "SIGNED" : "PENDING", color:evidence.merkle_root_hex ? C.green : C.amber, desc:evidence.merkle_root_hex ? "Cryptographically signed" : "Awaiting signature" },
  ];
  return (
    <div style={{ padding:"12px 14px", borderRadius:9, background:"rgba(4,12,20,0.5)", border:`1px solid ${C.violet}20`, marginBottom:14 }}>
      <div style={{ fontSize:9, color:C.violet, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:700, marginBottom:12 }}>EVIDENCE PIPELINE</div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        {nodes.map((n, i) => (
          <div key={n.label} style={{ display:"flex", alignItems:"center", flex:1 }}>
            <div style={{ padding:"10px 12px", borderRadius:7, border:`1px solid ${n.color}30`, background:`${n.color}08`, textAlign:"center", flex:1 }}>
              <div style={{ fontSize:15, fontWeight:800, color:n.color }}>{n.value}</div>
              <div style={{ fontSize:8, color:n.color, letterSpacing:"0.1em", textTransform:"uppercase", marginTop:3, fontWeight:700 }}>{n.label}</div>
              <div style={{ fontSize:9, color:C.faint, marginTop:2 }}>{n.desc}</div>
            </div>
            {i < nodes.length - 1 && <div style={{ width:28, textAlign:"center", color:C.ghost, fontSize:12, flexShrink:0 }}>→</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMap({ lat, lon, name }: { lat: number; lon: number; name: string | null }) {
  const zoom = 11;
  const bbox = { w:(lon-0.12).toFixed(4), s:(lat-0.07).toFixed(4), e:(lon+0.12).toFixed(4), n:(lat+0.07).toFixed(4) };
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox.w},${bbox.s},${bbox.e},${bbox.n}&layer=mapnik&marker=${lat.toFixed(5)},${lon.toFixed(5)}`;
  return (
    <div style={{ width:"100%", height:260, borderRadius:10, overflow:"hidden", position:"relative", border:`1px solid ${C.border}` }}>
      <iframe src={src} width="100%" height="100%" style={{ border:"none", display:"block", filter:"saturate(0.35) brightness(0.45) hue-rotate(185deg)", colorScheme:"dark" }} title="vessel position" loading="lazy"/>
      <div style={{ position:"absolute", bottom:8, right:8, background:"rgba(4,12,20,0.85)", border:`1px solid ${C.border}`, borderRadius:5, padding:"4px 8px", fontSize:9, color:C.dim, pointerEvents:"none" }}>
        {name ?? "Unknown"} · {fmtCoord(lat,"lat")} {fmtCoord(lon,"lon")}
      </div>
    </div>
  );
}

function FieldInventory({ entity, last, voyage, evidence, weather }: {
  entity: VesselDetail["entity"]; last: VesselDetail["last"];
  voyage: VesselDetail["voyage"]; evidence: VesselDetail["evidence"];
  weather: Weather | null;
}) {
  type S = "yes"|"soon"|"derived"|"future";
  const F: { field:string; status:S; note:string }[] = [
    { field:"MMSI",              status:"yes",     note:"From AIS message" },
    { field:"Name",              status:entity.name?"yes":"soon", note:entity.name?"From static AIS":"Awaiting type-5" },
    { field:"IMO",               status:entity.imo?"yes":"soon",  note:entity.imo?"Available":"Needs ship_type backfill" },
    { field:"Callsign",          status:entity.callsign?"yes":"soon", note:"From static AIS type-5" },
    { field:"Ship type",         status:entity.ship_type!=null?"yes":"soon", note:"Roadmap #1 blocker" },
    { field:"AIS Class A/B",     status:"soon",    note:"Needs msg_type in sensors" },
    { field:"Dimensions",        status:entity.length_m?"yes":"soon", note:"From static AIS" },
    { field:"Gross tonnage",     status:entity.domain_meta?.gross_tonnage?"yes":"future", note:"External vessel DB" },
    { field:"Deadweight",        status:entity.domain_meta?.deadweight_t?"yes":"future", note:"External vessel DB" },
    { field:"Year built",        status:entity.domain_meta?.year_built?"yes":"future", note:"External vessel DB" },
    { field:"Home port",         status:entity.domain_meta?.home_port?"yes":"future", note:"External vessel DB" },
    { field:"Flag / MID",        status:"yes",     note:"Derived from MMSI prefix" },
    { field:"Lat / Lon",         status:last?"yes":"soon", note:"From position report" },
    { field:"SOG / COG",         status:last?"yes":"soon", note:"From position report" },
    { field:"True heading",      status:last?.heading!=null?"yes":"soon", note:"Gyrocompass HDG" },
    { field:"Rate of turn",      status:"soon",    note:"ROT from msg 1-3 (not yet in sensors)" },
    { field:"Position accuracy", status:"soon",    note:"RAIM bit from msg 1-3" },
    { field:"Nav status",        status:voyage.nav_status?"yes":"soon", note:"From AIS msg 1-3" },
    { field:"Destination",       status:voyage.destination?"yes":"soon", note:"From static type-5" },
    { field:"ETA (reported)",    status:voyage.eta?"yes":"soon", note:"From static type-5" },
    { field:"ETA (computed)",    status:"derived", note:"Distance / avg speed" },
    { field:"Draught (now)",     status:voyage.draught_m!=null?"yes":"soon", note:"From type-5 static" },
    { field:"Draught (max)",     status:"future",  note:"External vessel DB" },
    { field:"Source count",      status:"yes",     note:"Multi-source verification" },
    { field:"D·P track",         status:evidence.has_track?"yes":"soon", note:"Douglas-Peucker compression" },
    { field:"Merkle root",       status:evidence.merkle_root_hex?"yes":"future", note:"Cryptographic signing" },
    { field:"Speed chart (48h)", status:"yes",     note:"30-min buckets" },
    { field:"COG histogram",     status:"yes",     note:"7d compass rose" },
    { field:"Reception heatmap", status:"yes",     note:"7d × 24h" },
    { field:"Cumulative dist.",  status:"derived", note:"Haversine from positions" },
    { field:"Activity ratio",    status:"derived", note:"SOG threshold" },
    { field:"CO₂ / CII",         status:"derived", note:"IMO CII formula" },
    { field:"Weather",           status:weather?"yes":"derived", note:"Open-Meteo marine API" },
    { field:"Events timeline",   status:"yes",     note:"Speed/nav transitions" },
    { field:"AIS msg types",     status:"yes",     note:"Distribution chart" },
    { field:"Mini-map",          status:"yes",     note:"OSM iframe embed" },
    { field:"RAIM accuracy",     status:"future",  note:"From msg 1-3 bits" },
    { field:"UN/LOCODE match",   status:"future",  note:"Fuzzy port matching" },
    { field:"Distance to shore", status:"future",  note:"PostGIS ST_Distance" },
    { field:"Evidence tree",     status:"yes",     note:"Pipeline visualization" },
    { field:"Vessel photo",      status:"future",  note:"External photo API" },
    { field:"Port calls gantt",  status:"future",  note:"Arrival/departure history" },
  ];
  const cols: Record<S, string> = { yes:C.green, soon:C.amber, derived:C.aqua, future:C.faint };
  const lbl: Record<S, string> = { yes:"YES", soon:"SOON", derived:"CALC", future:"TODO" };
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 24px" }}>
      {F.map(f => (
        <div key={f.field} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", borderBottom:`1px dashed ${C.aqua}0c` }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.08em", color:cols[f.status], width:46, flexShrink:0, textAlign:"center", padding:"2px 3px", border:`1px solid ${cols[f.status]}35`, borderRadius:3, background:`${cols[f.status]}08` }}>{lbl[f.status]}</span>
          <span style={{ fontSize:11, color:C.ink, flex:1 }}>{f.field}</span>
          <span style={{ fontSize:9, color:C.faint }}>{f.note}</span>
        </div>
      ))}
    </div>
  );
}

function MiniBarChart({ color, data }: { color: string; data: number[] }) {
  if (!data.length) return null;
  const max = Math.max(...data, 0.1);
  return (
    <div style={{ marginTop:10, height:24, display:"flex", alignItems:"flex-end", gap:3 }}>
      {data.map((v, i) => {
        const h = Math.max(0.05, v / max);
        return <div key={i} style={{ flex:1, background:color, borderRadius:2, height:`${h*100}%`, opacity:0.3+h*0.7 }}/>;
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BUILDING BLOCKS
   ═══════════════════════════════════════════════════════════════ */

function Loading({ mmsi }: { mmsi: number }) {
  return <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", color:C.faint, fontFamily:C.mono, fontSize:14 }}>Loading vessel {mmsi}…</div>;
}
function ErrorView({ error }: { error: string | null }) {
  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, fontFamily:C.mono }}>
      <div style={{ fontSize:14, color:C.red }}>{error ?? "Unknown error"}</div>
      <Link href="/map" style={{ fontSize:12, color:C.aqua }}>← back to map</Link>
    </div>
  );
}
function SectionHead({ icon, color, title, legend }: { icon: string; color: string; title: string; legend: React.ReactNode }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:14 }}>
      <h4 style={{ margin:0, fontSize:13, fontWeight:600, color:"#fff", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ color }}>{icon}</span>{title}
      </h4>
      <span style={{ fontSize:10, color:C.faint, letterSpacing:"0.08em", textTransform:"uppercase" }}>{legend}</span>
    </div>
  );
}
function LegDot({ c, style }: { c: string; style?: React.CSSProperties }) {
  return <span style={{ display:"inline-block", width:8, height:8, borderRadius:2, background:c, marginRight:5, verticalAlign:"middle", ...style }}/>;
}
function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, border:`1px solid ${color}50`, borderRadius:999, padding:"3px 9px", fontSize:9, color, background:`${color}10`, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600 }}>{children}</span>;
}
function IdBlock({ label, value, color }: { label: string; value: string | null; color: string }) {
  return <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
    <span style={{ fontSize:9, color, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:700 }}>{label}</span>
    <span style={{ fontSize:13, color:value ? "#fff" : C.faint, fontWeight:600 }}>{value ?? "—"}</span>
  </div>;
}
function StatCell({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return <div style={{ padding:"12px 14px", borderLeft:`1px solid ${C.border}` }}>
    <div style={{ fontSize:9, color:C.faint, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:700, marginBottom:4 }}>{label}</div>
    <div style={{ fontSize:20, fontWeight:800, color, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{value}</div>
    <div style={{ fontSize:9, color:C.dim, marginTop:4 }}>{sub}</div>
  </div>;
}
function Kpi({ big, color, label, sub }: { big: string; color: string; label: string; sub: string }) {
  // Format numbers with thin space separator (e.g. "1 247")
  const fmt = big.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
  return <div style={{ padding:"22px 20px", borderLeft:`1px solid ${C.border}` }}>
    <div style={{ fontSize:44, fontWeight:800, color, lineHeight:1, fontVariantNumeric:"tabular-nums", letterSpacing:"-0.02em" }}>{fmt}</div>
    <div style={{ fontSize:12, color:C.ink, marginTop:8, fontWeight:600, letterSpacing:"0.01em" }}>{label}</div>
    <div style={{ fontSize:10, color:C.faint, marginTop:3 }}>{sub}</div>
  </div>;
}
function DataCol({ title, icon, color, children }: { title: string; icon: string; color: string; children: React.ReactNode }) {
  return <div style={{ padding:"22px 28px", borderLeft:`1px solid ${C.border}` }}>
    <h3 style={{ margin:"0 0 16px", fontSize:10, textTransform:"uppercase", letterSpacing:"0.2em", fontWeight:700, color, display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}`, flexShrink:0 }}/>
      {title}
    </h3>
    {children}
  </div>;
}
function KV({ label, value, hl, color }: { label: string; value: string; hl?: boolean; color?: string }) {
  return <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"7px 0", borderBottom:`1px solid ${C.aqua}0c` }}>
    <span style={{ fontSize:11, color:C.dim, flexShrink:0 }}>{label}</span>
    <span style={{ fontSize:12, color:color ?? (hl ? "#fff" : C.ink), fontWeight:hl ? 600 : 400, textAlign:"right", marginLeft:12 }}>{value}</span>
  </div>;
}
function TrustCard({ color, children }: { color: string; children: React.ReactNode }) {
  return <div style={{ padding:14, borderRadius:9, background:"rgba(4,12,20,0.55)", border:`1px solid ${color}35`, position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:0, left:0, height:2, width:"100%", background:`linear-gradient(to right,${color},transparent)` }}/>
    {children}
  </div>;
}
function BigMetric({ n, color, unit }: { n: number; color: string; unit: string }) {
  return <div style={{ fontSize:24, fontWeight:800, color, lineHeight:1 }}>{fmtN(n)}<span style={{ fontSize:11, color:C.dim, marginLeft:6, fontWeight:400 }}>{unit}</span></div>;
}
function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize:10, fontFamily:C.mono, letterSpacing:"0.04em", padding:"3px 7px", borderRadius:5, border:`1px solid ${color}50`, background:`${color}10`, color, display:"inline-flex", alignItems:"center", gap:4 }}>
    <span style={{ width:4, height:4, borderRadius:"50%", background:color }}/>
    {children}
  </span>;
}

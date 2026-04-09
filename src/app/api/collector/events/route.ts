import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

let seq = 0;

export async function GET(req: NextRequest) {
  const since = parseInt(req.nextUrl.searchParams.get("since") ?? "0");

  try {
    // Hent seneste positioner fra entity_last — viser live aktivitet
    const { data, error } = await supabase
      .from("entity_last")
      .select(`
        entity_id, lat, lon, speed, bearing, t, updated_at,
        entities!inner(domain_meta, entity_type)
      `)
      .eq("entities.entity_type", "vessel")
      .gt("updated_at", new Date(Date.now() - 60_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error || !data) return NextResponse.json([]);

    const events = data.map((row: any) => {
      seq++;
      const mmsi = row.entities?.domain_meta?.mmsi ?? "?"
      const sog = row.speed ? (row.speed / 0.514444).toFixed(1) : "0.0"
      return {
        seq,
        t: new Date(row.updated_at).getTime(),
        type: "collect",
        msg: `MMSI ${mmsi}  ${row.lat?.toFixed(4)} ${row.lon?.toFixed(4)}  ${sog}kn`,
      };
    });

    // Kun events nyere end since
    const fresh = events.filter(e => e.seq > since);
    return NextResponse.json(fresh);
  } catch {
    return NextResponse.json([]);
  }
}

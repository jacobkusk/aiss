import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  // `since` er unix ms timestamp — ikke seq nummer
  const sinceMs = parseInt(req.nextUrl.searchParams.get("since") ?? "0");
  const sinceIso = new Date(sinceMs || Date.now() - 10 * 60_000).toISOString();

  try {
    const { data, error } = await supabase
      .from("entity_last")
      .select(`entity_id, lat, lon, speed, updated_at, entities!inner(domain_meta, entity_type)`)
      .eq("entities.entity_type", "vessel")
      .gt("updated_at", sinceIso)
      .order("updated_at", { ascending: true })
      .limit(30);

    if (error || !data) return NextResponse.json([]);

    const events = data.map((row: any, i: number) => {
      const ts = new Date(row.updated_at).getTime();
      const mmsi = row.entities?.domain_meta?.mmsi ?? "?"
      const sog = row.speed ? (row.speed / 0.514444).toFixed(1) : "0.0"
      return {
        seq: ts * 1000 + i,  // unik: ms timestamp + position i batch
        t: ts,
        type: "collect" as const,
        msg: `MMSI ${mmsi}  ${row.lat?.toFixed(4)} ${row.lon?.toFixed(4)}  ${sog}kn`,
      };
    });

    return NextResponse.json(events);
  } catch {
    return NextResponse.json([]);
  }
}

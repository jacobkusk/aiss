import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  const sinceMs = parseInt(req.nextUrl.searchParams.get("since") ?? "0");
  const sinceEpoch = sinceMs ? sinceMs / 1000 : (Date.now() / 1000 - 10 * 60);

  try {
    const { data, error } = await supabase
      .from("positions")
      .select("mmsi, lat, lon, sog, t, name")
      .gt("t", sinceEpoch)
      .order("t", { ascending: true })
      .limit(40);

    console.log("[events] data:", data?.length, "error:", error?.message, "sinceEpoch:", sinceEpoch);
    if (error || !data) return NextResponse.json([]);

    const events = data.map((row: any, i: number) => {
      const ts = Math.round(row.t * 1000);
      const sog = row.sog != null ? Number(row.sog).toFixed(1) : "0.0";
      const label = row.name ?? `MMSI ${row.mmsi}`;
      return {
        seq: ts * 1000 + i,
        t: ts,
        type: "collect" as const,
        msg: `${label}  ${Number(row.lat).toFixed(4)} ${Number(row.lon).toFixed(4)}  ${sog}kn`,
      };
    });

    return NextResponse.json(events);
  } catch (e: any) {
    console.error("[events] catch:", e?.message);
    return NextResponse.json([]);
  }
}

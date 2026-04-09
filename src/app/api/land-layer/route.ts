import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 3600; // cache 1 hour

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const min_lon = parseFloat(p.get("min_lon") ?? "-180");
  const min_lat = parseFloat(p.get("min_lat") ?? "-90");
  const max_lon = parseFloat(p.get("max_lon") ?? "180");
  const max_lat = parseFloat(p.get("max_lat") ?? "90");

  const { data, error } = await supabase.rpc("get_land_layer", {
    min_lon, min_lat, max_lon, max_lat,
  });

  if (error) {
    console.error("[land-layer]", error);
    return NextResponse.json({ type: "FeatureCollection", features: [] });
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  const [statsResult, rpcHealthResult, liveResult] = await Promise.all([
    supabase.rpc("get_system_stats"),
    supabase.rpc("get_rpc_health"),
    supabase
      .from("positions_v2")
      .select("entity_id", { count: "exact", head: false })
      .gt("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString()),
  ]);

  if (statsResult.error) return NextResponse.json({ error: statsResult.error.message }, { status: 500 });

  // Count unique vessels seen in last 2 min
  const uniqueIds = new Set((liveResult.data ?? []).map((r: { entity_id: string }) => r.entity_id));

  return NextResponse.json({
    ...statsResult.data,
    rpc_health: rpcHealthResult.data ?? [],
    vessels_live_2min: uniqueIds.size,
  });
}

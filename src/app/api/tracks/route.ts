import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface GpsPoint {
  lat: number;
  lon: number;
  t: number; // epoch seconds
  speed?: number;
  heading?: number;
  accuracy?: number;
}

/**
 * POST /api/tracks
 *
 * Upload a batch of GPS points from a phone app.
 * Requires Supabase Auth JWT in Authorization header.
 *
 * Body: { points: GpsPoint[], device_name?: string }
 * Response: { ok, point_count, time_marks, mmsi, start_time, end_time }
 */
export async function POST(req: NextRequest) {
  // Auth: get JWT from header
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }
  const token = auth.slice(7);

  // Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Parse body
  let body: { points?: GpsPoint[]; device_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { points, device_name } = body;

  // Validate
  if (!Array.isArray(points) || points.length < 2) {
    return NextResponse.json({ error: "Need at least 2 points" }, { status: 400 });
  }
  if (points.length > 10000) {
    return NextResponse.json({ error: "Max 10000 points per batch" }, { status: 400 });
  }

  // Validate each point
  for (const p of points) {
    if (typeof p.lat !== "number" || typeof p.lon !== "number" || typeof p.t !== "number") {
      return NextResponse.json({ error: "Each point needs lat, lon, t (epoch seconds)" }, { status: 400 });
    }
    if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) {
      return NextResponse.json({ error: "Coordinates out of range" }, { status: 400 });
    }
  }

  // Call RPC with user's token (auth.uid() will work inside the function)
  const authedClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data, error } = await authedClient.rpc("upload_gps_track", {
    p_points: points,
    p_device_name: device_name || null,
  });

  if (error) {
    console.error("[tracks] RPC error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

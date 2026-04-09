import { NextRequest, NextResponse } from "next/server";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since") ?? "0";
  try {
    const res = await fetch(`http://localhost:3099/events?since=${since}`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 503 });
  }
}

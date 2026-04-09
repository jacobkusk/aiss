import { NextResponse } from "next/server";

export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch("http://localhost:3099/health", {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: "down" }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getCachedHistory } from "@/lib/cached-history";

function parseLimit(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: NextRequest) {
  try {
    const since = request.nextUrl.searchParams.get("since");
    const maxRuns = parseLimit(request.nextUrl.searchParams.get("maxRuns"), 900, 20, 2000);

    const history = await getCachedHistory(since ?? undefined, maxRuns);

    const response = NextResponse.json(history);
    response.headers.set(
      "Cache-Control",
      "private, max-age=60, stale-while-revalidate=300",
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

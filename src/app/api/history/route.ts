import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { ActionsHistoryResponse } from "@/lib/types";

function getConvexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? null;
}

function parseLimit(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

type UntypedConvexHttpClient = {
  action: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

export async function GET(request: NextRequest) {
  try {
    const convexUrl = getConvexUrl();
    if (!convexUrl) {
      return NextResponse.json(
        {
          error:
            "Missing NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL). Run `bunx convex dev --once` and ensure env vars are loaded.",
        },
        { status: 500 },
      );
    }

    const since = request.nextUrl.searchParams.get("since");
    const maxRuns = parseLimit(request.nextUrl.searchParams.get("maxRuns"), 900, 20, 2000);

    const convex = new ConvexHttpClient(convexUrl) as unknown as UntypedConvexHttpClient;

    const history = await convex.query("history:getHistory", {
      since: since ?? undefined,
      maxRuns,
    });

    return NextResponse.json(history as ActionsHistoryResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";

type UntypedConvexHttpClient = {
  query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

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

function isAuthorized(request: NextRequest) {
  const expected = process.env.TEAMS_PULL_TOKEN;
  if (!expected) {
    return true;
  }
  const provided = request.headers.get("x-teams-token");
  return provided === expected;
}

async function handleListNotifications(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convexUrl = getConvexUrl();
  if (!convexUrl) {
    return NextResponse.json(
      {
        error:
          "Missing NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL). Ensure Convex URL env vars are configured.",
      },
      { status: 500 },
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 10, 1, 50);
  const lookbackHours = parseLimit(request.nextUrl.searchParams.get("lookbackHours"), 168, 1, 336);
  const workflowsCsv = request.nextUrl.searchParams.get("workflows");
  const workflows =
    workflowsCsv && workflowsCsv.trim().length > 0
      ? workflowsCsv
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : undefined;

  try {
    const convex = new ConvexHttpClient(convexUrl) as unknown as UntypedConvexHttpClient;
    const payload = await convex.query("alerts:getPendingTeamsFailures", {
      limit,
      lookbackHours,
      workflows,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleListNotifications(request);
}

export async function POST(request: NextRequest) {
  return handleListNotifications(request);
}

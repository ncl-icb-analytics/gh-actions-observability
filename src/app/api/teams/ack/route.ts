import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";

type UntypedConvexHttpClient = {
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

function getConvexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? null;
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.TEAMS_PULL_TOKEN;
  if (!expected) {
    return true;
  }
  const provided = request.headers.get("x-teams-token");
  return provided === expected;
}

export async function POST(request: NextRequest) {
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

  try {
    const body = (await request.json()) as { runIds?: unknown };
    const runIds = Array.isArray(body.runIds)
      ? body.runIds.filter((value): value is number => Number.isInteger(value))
      : [];
    if (runIds.length === 0) {
      return NextResponse.json({ error: "runIds must be a non-empty array of integers" }, { status: 400 });
    }

    const convex = new ConvexHttpClient(convexUrl) as unknown as UntypedConvexHttpClient;
    const payload = await convex.mutation("alerts:acknowledgeTeamsFailures", {
      runIds,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

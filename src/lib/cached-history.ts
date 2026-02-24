import { cacheLife, cacheTag } from "next/cache";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { ActionsHistoryResponse } from "./types";

/**
 * Cached server function for snapshot fetches. Shared by SSR (page.tsx) and
 * the /api/history route. Completed runs are immutable, so an aggressive
 * 'hours' cache profile is safe — the live tail handles real-time updates.
 */
export async function getCachedHistory(
  since?: string,
  maxRuns?: number,
): Promise<ActionsHistoryResponse> {
  "use cache";
  cacheLife("hours");
  cacheTag("history");

  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing CONVEX_URL");
  const convex = new ConvexHttpClient(url);
  return (await convex.query(api.history.getHistory, {
    since: since ?? undefined,
    maxRuns: maxRuns ?? 900,
  })) as ActionsHistoryResponse;
}

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const runStatus = v.union(v.literal("queued"), v.literal("in_progress"), v.literal("completed"));
const runConclusion = v.union(
  v.literal("success"),
  v.literal("failure"),
  v.literal("neutral"),
  v.literal("cancelled"),
  v.literal("skipped"),
  v.literal("timed_out"),
  v.literal("action_required"),
  v.literal("stale"),
  v.literal("startup_failure"),
  v.null(),
);

const runArgs = {
  runId: v.number(),
  name: v.string(),
  workflowName: v.string(),
  branch: v.string(),
  event: v.string(),
  status: runStatus,
  conclusion: runConclusion,
  url: v.string(),
  actor: v.string(),
  runNumber: v.number(),
  prNumbers: v.array(v.number()),
  createdAt: v.string(),
  updatedAt: v.string(),
  startedAt: v.string(),
  updatedAtMs: v.number(),
  durationMs: v.number(),
  failureSummary: v.optional(v.string()),
  failurePoints: v.optional(v.array(v.string())),
};

function arraysEqual<T>(a: T[] | undefined, b: T[] | undefined) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function hasMeaningfulRunChange(existing: Record<string, unknown> | null, args: Record<string, unknown>) {
  if (!existing) {
    return true;
  }
  return (
    existing.name !== args.name ||
    existing.workflowName !== args.workflowName ||
    existing.branch !== args.branch ||
    existing.event !== args.event ||
    existing.status !== args.status ||
    existing.conclusion !== args.conclusion ||
    existing.url !== args.url ||
    existing.actor !== args.actor ||
    existing.runNumber !== args.runNumber ||
    existing.createdAt !== args.createdAt ||
    existing.updatedAt !== args.updatedAt ||
    existing.startedAt !== args.startedAt ||
    existing.updatedAtMs !== args.updatedAtMs ||
    existing.durationMs !== args.durationMs ||
    (existing.failureSummary ?? undefined) !== args.failureSummary ||
    !arraysEqual(existing.prNumbers as number[] | undefined, args.prNumbers as number[] | undefined) ||
    !arraysEqual(existing.failurePoints as string[] | undefined, args.failurePoints as string[] | undefined)
  );
}

export const getSyncState = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("syncState")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});

export const setSyncState = internalMutation({
  args: {
    key: v.string(),
    owner: v.string(),
    repo: v.string(),
    lastSyncMs: v.number(),
    lastSyncedAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        owner: args.owner,
        repo: args.repo,
        lastSyncMs: args.lastSyncMs,
        lastSyncedAt: args.lastSyncedAt,
        lastError: args.lastError,
      });
      return;
    }

    await ctx.db.insert("syncState", args);
  },
});

export const upsertRun = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();

    if (!hasMeaningfulRunChange(existing as Record<string, unknown> | null, args as Record<string, unknown>)) {
      return { changed: false };
    }

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { changed: true };
    }

    await ctx.db.insert("runs", args);
    return { changed: true };
  },
});

export const upsertRunsBatch = internalMutation({
  args: {
    runs: v.array(v.object(runArgs)),
  },
  handler: async (ctx, args) => {
    let changed = 0;
    for (const run of args.runs) {
      const existing = await ctx.db
        .query("runs")
        .withIndex("by_run_id", (q) => q.eq("runId", run.runId))
        .unique();

      if (!hasMeaningfulRunChange(existing as Record<string, unknown> | null, run as Record<string, unknown>)) {
        continue;
      }

      if (existing) {
        await ctx.db.patch(existing._id, run);
      } else {
        await ctx.db.insert("runs", run);
      }
      changed += 1;
    }

    return { changed };
  },
});

export const normalizeWorkflowNames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").collect();
    let updated = 0;
    for (const run of runs) {
      if (/^PR\s*#\d+$/i.test(run.workflowName.trim())) {
        await ctx.db.patch(run._id, { workflowName: "CodeRabbit QA" });
        updated += 1;
      }
    }
    return { updated, scanned: runs.length };
  },
});

export const getNonCompletedRuns = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(300, Math.max(1, args.limit ?? 120));
    const queuedRows = await ctx.db
      .query("runs")
      .withIndex("by_status_updated_at_ms", (q) => q.eq("status", "queued"))
      .order("desc")
      .take(limit);
    const inProgressRows = await ctx.db
      .query("runs")
      .withIndex("by_status_updated_at_ms", (q) => q.eq("status", "in_progress"))
      .order("desc")
      .take(limit);

    return [...queuedRows, ...inProgressRows]
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, limit);
  },
});

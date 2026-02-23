import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const alertChannel = v.union(v.literal("teams"), v.literal("teams_pull"));

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
  args: {
    runId: v.number(),
    name: v.string(),
    workflowName: v.string(),
    branch: v.string(),
    event: v.string(),
    status: v.union(v.literal("queued"), v.literal("in_progress"), v.literal("completed")),
    conclusion: v.union(
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
    ),
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return;
    }

    await ctx.db.insert("runs", args);
  },
});

export const getAlertByRunChannel = internalQuery({
  args: {
    runId: v.number(),
    channel: alertChannel,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("alertsSent")
      .withIndex("by_channel_run_id", (q) => q.eq("channel", args.channel).eq("runId", args.runId))
      .unique();
  },
});

export const insertAlert = internalMutation({
  args: {
    runId: v.number(),
    workflowName: v.string(),
    channel: alertChannel,
    sentAt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("alertsSent", args);
  },
});

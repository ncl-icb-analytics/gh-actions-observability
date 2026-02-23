import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

const runStatus = v.union(v.literal("queued"), v.literal("in_progress"), v.literal("completed"));

export default defineSchema({
  runs: defineTable({
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
  })
    .index("by_run_id", ["runId"])
    .index("by_updated_at_ms", ["updatedAtMs"]),

  syncState: defineTable({
    key: v.string(),
    owner: v.string(),
    repo: v.string(),
    lastSyncedAt: v.optional(v.string()),
    lastSyncMs: v.number(),
    lastError: v.optional(v.string()),
  }).index("by_key", ["key"]),
});

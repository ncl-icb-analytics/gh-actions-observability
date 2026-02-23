import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const failureConclusions = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

const teamsPullChannel = "teams_pull" as const;

function parseCsvList(value: string | undefined) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function shouldIncludeWorkflow(workflowName: string, allowList: string[]) {
  if (allowList.length === 0) {
    return workflowName === "dbt Deploy to Production";
  }
  return allowList.some((name) => name.toLowerCase() === workflowName.toLowerCase());
}

export const getPendingTeamsFailures = query({
  args: {
    limit: v.optional(v.number()),
    workflows: v.optional(v.array(v.string())),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, args.limit ?? 10));
    const lookbackHours = Math.min(24 * 14, Math.max(1, args.lookbackHours ?? 24 * 7));
    const lookbackMs = lookbackHours * 60 * 60 * 1000;
    const earliest = Date.now() - lookbackMs;
    const envAllowList = parseCsvList(process.env.TEAMS_ALERT_WORKFLOWS);
    const requestedAllowList = args.workflows ?? [];
    const allowList = requestedAllowList.length > 0 ? requestedAllowList : envAllowList;

    const recentRuns = await ctx.db
      .query("runs")
      .withIndex("by_updated_at_ms", (q) => q.gte("updatedAtMs", earliest))
      .order("desc")
      .take(800);

    const pending: Array<{
      runId: number;
      runNumber: number;
      workflowName: string;
      conclusion: string | null;
      summary: string;
      points: string[];
      url: string;
      actor: string;
      branch: string;
      event: string;
      updatedAt: string;
      updatedAtMs: number;
      prNumbers: number[];
      messageTitle: string;
      messageBody: string;
    }> = [];

    for (const run of recentRuns) {
      if (!failureConclusions.has(run.conclusion ?? "")) {
        continue;
      }
      if (!shouldIncludeWorkflow(run.workflowName, allowList)) {
        continue;
      }

      const alreadySent = await ctx.db
        .query("alertsSent")
        .withIndex("by_channel_run_id", (q) => q.eq("channel", teamsPullChannel).eq("runId", run.runId))
        .unique();
      if (alreadySent) {
        continue;
      }

      const summary =
        run.failureSummary ??
        `${run.workflowName}: run #${run.runNumber} ended with ${run.conclusion ?? "failure"}.`;
      const title = `${run.workflowName} #${run.runNumber} (${run.conclusion ?? "failure"})`;
      const body = [
        `What failed: ${summary}`,
        `Branch: ${run.branch} • Actor: ${run.actor} • Event: ${run.event}`,
        `Run: ${run.url}`,
      ].join("\n");

      pending.push({
        runId: run.runId,
        runNumber: run.runNumber,
        workflowName: run.workflowName,
        conclusion: run.conclusion,
        summary,
        points: (run.failurePoints ?? []).slice(0, 3),
        url: run.url,
        actor: run.actor,
        branch: run.branch,
        event: run.event,
        updatedAt: run.updatedAt,
        updatedAtMs: run.updatedAtMs,
        prNumbers: run.prNumbers ?? [],
        messageTitle: title,
        messageBody: body,
      });

      if (pending.length >= limit) {
        break;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      count: pending.length,
      notifications: pending,
    };
  },
});

export const acknowledgeTeamsFailures = mutation({
  args: {
    runIds: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    const nowIso = new Date().toISOString();
    for (const runId of args.runIds) {
      const existing = await ctx.db
        .query("alertsSent")
        .withIndex("by_channel_run_id", (q) => q.eq("channel", teamsPullChannel).eq("runId", runId))
        .unique();
      if (existing) {
        continue;
      }

      const run = await ctx.db
        .query("runs")
        .withIndex("by_run_id", (q) => q.eq("runId", runId))
        .unique();
      if (!run) {
        continue;
      }

      await ctx.db.insert("alertsSent", {
        runId,
        workflowName: run.workflowName,
        channel: teamsPullChannel,
        sentAt: nowIso,
      });
      inserted += 1;
    }

    return { acknowledged: inserted };
  },
});

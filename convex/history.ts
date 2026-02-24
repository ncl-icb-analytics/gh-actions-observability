import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const failureConclusions = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

type RunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | "startup_failure"
  | null;

type WorkflowRunsPayload = {
  workflow_runs: Array<{
    id: number;
    name: string;
    display_title: string;
    path?: string;
    head_branch: string;
    event: string;
    status: "queued" | "in_progress" | "completed";
    conclusion: RunConclusion;
    html_url: string;
    actor?: { login: string };
    run_number: number;
    pull_requests?: Array<{ number?: number }>;
    head_commit?: { message?: string };
    created_at: string;
    updated_at: string;
    run_started_at?: string;
  }>;
};

type WorkflowRun = WorkflowRunsPayload["workflow_runs"][number];

type JobsPayload = {
  jobs: Array<{
    id: number;
    name: string;
    conclusion: RunConclusion;
    steps?: Array<{
      name: string;
      conclusion: RunConclusion;
      number: number;
    }>;
  }>;
};

function parseDurationMs(startedAt: string, updatedAt: string) {
  const start = new Date(startedAt).getTime();
  const end = new Date(updatedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, end - start);
}

function resolveRunTitle(run: WorkflowRunsPayload["workflow_runs"][number]) {
  const commitSubject = run.head_commit?.message
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (commitSubject) {
    return commitSubject;
  }
  return run.display_title || run.name;
}

function fallbackWorkflowName(path?: string) {
  if (!path) {
    return "Unknown workflow";
  }
  const fileName = path.split("/").pop() ?? "Unknown workflow";
  return fileName.replace(".yml", "").replace(".yaml", "");
}

function normalizeWorkflowName(name: string) {
  if (/^PR\s*#\d+$/i.test(name.trim())) {
    return "CodeRabbit QA";
  }
  return name;
}

function stripAnsi(input: string) {
  return input.replace(/\u001B\[[0-9;]*m/g, "");
}

function normalizeLogLine(line: string) {
  return stripAnsi(line)
    .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s+/, "")
    .replace(/^::error::/, "")
    .replace(/^##\[error\]/, "")
    .trim();
}

function extractErrorHighlights(logText: string) {
  const patterns = [
    /Database Error/i,
    /Compilation Error/i,
    /Runtime Error/i,
    /Warning in test/i,
    /system\$get_dbt_log/i,
    /DBT job failed/i,
    /Error in model/i,
    /Error in test/i,
    /SQL compilation error/i,
    /\berror\b/i,
    /\bfailed\b/i,
  ];

  const lines = logText
    .split("\n")
    .map(normalizeLogLine)
    .filter((line) => line && line.length >= 8 && line.length <= 240)
    .filter((line) => !/^\[command\]/i.test(line))
    .filter((line) => !( /^Run\s+/i.test(line) && !/system\$get_dbt_log/i.test(line)))
    .filter((line) => !/^#/.test(line))
    .filter((line) => !/^##\[warning\]/i.test(line))
    .filter((line) => !/^print\(f?["']Error:/i.test(line))
    .filter((line) => !/result_text\.lower\(\)|command_success|^\s*if\s+.*:\s*$/i.test(line))
    .filter((line) => !/^Process completed with exit code \d+\.?$/i.test(line));

  const matches: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!patterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    if (!matches.includes(line)) {
      matches.push(line);
    }
    if (matches.length >= 6) {
      break;
    }
  }

  return matches;
}

function parseDbtSummary(highlights: string[]) {
  const modelNames = new Set<string>();
  let errorType: string | null = null;

  for (const line of highlights) {
    if (!errorType && /Database Error/i.test(line)) {
      errorType = "Database error";
    } else if (!errorType && /Compilation Error/i.test(line)) {
      errorType = "Compilation error";
    } else if (!errorType && /Runtime Error/i.test(line)) {
      errorType = "Runtime error";
    }

    const modelMatches = line.matchAll(
      /(?:Error \d+ in model|First error in model|Database Error in model)\s+'?([a-zA-Z0-9_]+)'?/gi,
    );
    for (const match of modelMatches) {
      if (match[1]) {
        modelNames.add(match[1]);
      }
    }
  }

  const models = Array.from(modelNames).slice(0, 3);
  if (!errorType && models.length === 0) {
    return null;
  }

  const modelPart =
    models.length > 0
      ? `Affects model${models.length > 1 ? "s" : ""}: ${models.join(", ")}.`
      : "No model name was parsed from logs.";

  return `${errorType ?? "dbt error"} in deployment. ${modelPart}`;
}

function summarizeFailure(job: JobsPayload["jobs"][number], highlights: string[]) {
  const failedStep =
    job.steps?.find((step) => failureConclusions.has(step.conclusion ?? "")) ??
    job.steps?.find((step) => step.conclusion === "failure");

  if (job.conclusion === "cancelled" && highlights.length === 0) {
    const msg = failedStep
      ? `${job.name}: job was cancelled while executing step ${failedStep.number} (${failedStep.name}).`
      : `${job.name}: job was cancelled before completion.`;
    return { summary: msg, points: [] as string[] };
  }

  if (highlights.length > 0) {
    const stepSuffix = failedStep ? ` (failed at step: ${failedStep.name})` : "";
    const dbtSummary = parseDbtSummary(highlights);
    const summary = dbtSummary
      ? `${job.name}${stepSuffix}: ${dbtSummary}`
      : `${job.name}${stepSuffix}: ${highlights[0]}`;

    return {
      summary,
      points: highlights.slice(0, 3).map((line) => `${job.name}: ${line}`),
    };
  }

  if (failedStep) {
    const msg = `${job.name}: step #${failedStep.number} (${failedStep.name}) ended with ${failedStep.conclusion}.`;
    return { summary: msg, points: [msg] };
  }

  const fallback = `${job.name}: job conclusion was ${job.conclusion}.`;
  return { summary: fallback, points: [fallback] };
}

async function ghFetchJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const body = await res.text();
    throw new Error(
      `GitHub API ${res.status}: ${body.slice(0, 200)}${remaining === "0" ? ` (rate limited, reset=${reset})` : ""}`,
    );
  }

  return (await res.json()) as T;
}

async function ghFetchText(path: string, token: string): Promise<string> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.text();
}

async function fetchWorkflowRuns(owner: string, repo: string, token: string, since: string | null, maxRuns: number) {
  const perPage = 100;
  const pages = Math.ceil(maxRuns / perPage);
  const allRuns: WorkflowRunsPayload["workflow_runs"] = [];

  for (let page = 1; page <= pages; page += 1) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    if (since) {
      params.set("created", `>=${since}`);
    }

    const payload = await ghFetchJson<WorkflowRunsPayload>(
      `/repos/${owner}/${repo}/actions/runs?${params.toString()}`,
      token,
    );

    if (payload.workflow_runs.length === 0) {
      break;
    }

    allRuns.push(...payload.workflow_runs);
    if (allRuns.length >= maxRuns || payload.workflow_runs.length < perPage) {
      break;
    }
  }

  return allRuns.slice(0, maxRuns);
}

async function fetchWorkflowRun(owner: string, repo: string, token: string, runId: number) {
  try {
    return await ghFetchJson<WorkflowRun>(`/repos/${owner}/${repo}/actions/runs/${runId}`, token);
  } catch (error) {
    if (error instanceof Error && /GitHub API 404:/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export const syncGithub: ReturnType<typeof action> = action({
  args: {
    since: v.optional(v.string()),
    maxRuns: v.optional(v.number()),
    detailsLimit: v.optional(v.number()),
    minIntervalMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      throw new Error("Missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO in Convex environment.");
    }

    const key = `${owner}/${repo}`;
    const minIntervalMs = args.minIntervalMs ?? 55_000;
    const state = await ctx.runQuery(internal.internalHistory.getSyncState, { key });
    if (state && Date.now() - state.lastSyncMs < minIntervalMs) {
      return { skipped: true, reason: "min_interval", lastSyncedAt: state.lastSyncedAt ?? null };
    }

    const maxRuns = Math.min(2000, Math.max(100, args.maxRuns ?? 1200));
    const detailsLimit = Math.min(400, Math.max(0, args.detailsLimit ?? 120));
    const effectiveSince =
      args.since ??
      (state?.lastSyncedAt
        ? new Date(new Date(state.lastSyncedAt).getTime() - 10 * 60 * 1000).toISOString()
        : null);

    try {
      const workflowRuns = await fetchWorkflowRuns(owner, repo, token, effectiveSince, maxRuns);
      const nonCompleted = await ctx.runQuery(internal.internalHistory.getNonCompletedRuns, { limit: 120 });
      const refreshedNonCompleted: WorkflowRun[] = [];

      for (const run of nonCompleted) {
        const refreshed = await fetchWorkflowRun(owner, repo, token, run.runId);
        if (refreshed) {
          refreshedNonCompleted.push(refreshed);
        }
      }

      const mergedRunMap = new Map<number, WorkflowRun>();
      for (const run of workflowRuns) {
        mergedRunMap.set(run.id, run);
      }
      for (const run of refreshedNonCompleted) {
        mergedRunMap.set(run.id, run);
      }

      const mergedRuns = Array.from(mergedRunMap.values()).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      const runsToUpsert: Array<{
        runId: number;
        name: string;
        workflowName: string;
        branch: string;
        event: string;
        status: "queued" | "in_progress" | "completed";
        conclusion: RunConclusion;
        url: string;
        actor: string;
        runNumber: number;
        prNumbers: number[];
        createdAt: string;
        updatedAt: string;
        startedAt: string;
        updatedAtMs: number;
        durationMs: number;
        failureSummary?: string;
        failurePoints?: string[];
      }> = [];

      for (let index = 0; index < mergedRuns.length; index += 1) {
        const run = mergedRuns[index];
        const startedAt = run.run_started_at ?? run.created_at;
        const base: {
          runId: number;
          name: string;
          workflowName: string;
          branch: string;
          event: string;
          status: "queued" | "in_progress" | "completed";
          conclusion: RunConclusion;
          url: string;
          actor: string;
          runNumber: number;
          prNumbers: number[];
          createdAt: string;
          updatedAt: string;
          startedAt: string;
          updatedAtMs: number;
          durationMs: number;
          failureSummary?: string;
          failurePoints?: string[];
        } = {
          runId: run.id,
          name: resolveRunTitle(run),
          workflowName: normalizeWorkflowName(run.name || fallbackWorkflowName(run.path)),
          branch: run.head_branch,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
          url: run.html_url,
          actor: run.actor?.login ?? "unknown",
          runNumber: run.run_number,
          prNumbers: (run.pull_requests ?? [])
            .map((pr) => pr.number)
            .filter((num): num is number => typeof num === "number"),
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          startedAt,
          updatedAtMs: new Date(run.updated_at).getTime(),
          durationMs: parseDurationMs(startedAt, run.updated_at),
          failureSummary: undefined,
          failurePoints: undefined,
        };

        if (run.status === "completed" && run.conclusion !== "success" && index < detailsLimit) {
          try {
            const jobsPayload = await ghFetchJson<JobsPayload>(
              `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`,
              token,
            );
            const failedJobs = jobsPayload.jobs.filter((job) => failureConclusions.has(job.conclusion ?? ""));

            if (failedJobs.length > 0) {
              const job = failedJobs[0];
              let highlights: string[] = [];
              try {
                const logText = await ghFetchText(`/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, token);
                highlights = extractErrorHighlights(logText.slice(-120_000));
              } catch {
                // Ignore log detail errors; fallback summary still useful.
              }

              const failure = summarizeFailure(job, highlights);
              base.failureSummary = failure.summary;
              base.failurePoints = failure.points;
            }
          } catch {
            base.failureSummary = "Failed to load detailed failure info for this run.";
          }
        }

        runsToUpsert.push(base);
      }

      // Batch upserts reduce function-call overhead and subscription churn.
      for (let i = 0; i < runsToUpsert.length; i += 200) {
        await ctx.runMutation(internal.internalHistory.upsertRunsBatch, {
          runs: runsToUpsert.slice(i, i + 200),
        });
      }

      await ctx.runMutation(internal.internalHistory.setSyncState, {
        key,
        owner,
        repo,
        lastSyncMs: Date.now(),
        lastSyncedAt: new Date().toISOString(),
        lastError: undefined,
      });

      return { synced: mergedRuns.length, refreshedInProgress: refreshedNonCompleted.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      await ctx.runMutation(internal.internalHistory.setSyncState, {
        key,
        owner,
        repo,
        lastSyncMs: Date.now(),
        lastSyncedAt: state?.lastSyncedAt,
        lastError: message,
      });
      throw error;
    }
  },
});

export const getHistory = query({
  args: {
    since: v.optional(v.string()),
    maxRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const owner = process.env.GITHUB_OWNER ?? "unknown";
    const repo = process.env.GITHUB_REPO ?? "unknown";
    const key = `${owner}/${repo}`;
    const maxRuns = Math.min(2000, Math.max(20, args.maxRuns ?? 900));
    const parsedSinceMs = args.since ? new Date(args.since).getTime() : Number.NaN;
    const sinceMs = Number.isFinite(parsedSinceMs) ? parsedSinceMs : null;
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    const rows =
      sinceMs === null
        ? await ctx.db.query("runs").withIndex("by_updated_at_ms").order("desc").take(maxRuns)
        : await ctx.db
            .query("runs")
            .withIndex("by_updated_at_ms", (q) => q.gte("updatedAtMs", sinceMs))
            .order("desc")
            .take(maxRuns);

    return {
      owner,
      repo,
      generatedAt: state?.lastSyncedAt ?? null,
      runs: rows.map((row: Doc<"runs">) => ({
        id: row.runId,
        name: row.name,
        workflowName: row.workflowName,
        branch: row.branch,
        event: row.event,
        status: row.status,
        conclusion: row.conclusion,
        url: row.url,
        actor: row.actor,
        runNumber: row.runNumber,
        prNumbers: row.prNumbers,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        startedAt: row.startedAt,
        durationMs: row.durationMs,
        failureSummary: row.failureSummary ?? null,
        failurePoints: row.failurePoints ?? [],
      })),
    };
  },
});

// Lightweight tail query — does NOT read syncState, so the reactive
// subscription is only invalidated when actual run documents change.
export const getRecentRuns = query({
  args: {
    since: v.string(),
    maxRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRuns = Math.min(500, Math.max(10, args.maxRuns ?? 200));
    const sinceMs = new Date(args.since).getTime();
    if (!Number.isFinite(sinceMs)) {
      return [];
    }

    const rows = await ctx.db
      .query("runs")
      .withIndex("by_updated_at_ms", (q) => q.gte("updatedAtMs", sinceMs))
      .order("desc")
      .take(maxRuns);

    return rows.map((row: Doc<"runs">) => ({
      id: row.runId,
      name: row.name,
      workflowName: row.workflowName,
      branch: row.branch,
      event: row.event,
      status: row.status,
      conclusion: row.conclusion,
      url: row.url,
      actor: row.actor,
      runNumber: row.runNumber,
      prNumbers: row.prNumbers,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      failureSummary: row.failureSummary ?? null,
      failurePoints: row.failurePoints ?? [],
    }));
  },
});

// Tiny reactive query — reads only syncState (1 doc), provides "last synced"
// timestamp to the UI without coupling it to the heavier run queries.
export const getSyncTimestamp = query({
  args: {},
  handler: async (ctx) => {
    const key = `${process.env.GITHUB_OWNER ?? "unknown"}/${process.env.GITHUB_REPO ?? "unknown"}`;
    const state = await ctx.db
      .query("syncState")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return state?.lastSyncedAt ?? null;
  },
});

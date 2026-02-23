import { NextRequest, NextResponse } from "next/server";
import type { ActionsHistoryResponse, ActionsRun, RunConclusion } from "@/lib/types";

type WorkflowRunsPayload = {
  workflow_runs: Array<{
    id: number;
    name: string;
    display_title: string;
    path: string;
    head_branch: string;
    event: string;
    status: ActionsRun["status"];
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

type Job = {
  id: number;
  name: string;
  conclusion: RunConclusion;
  steps?: Array<{
    name: string;
    conclusion: RunConclusion;
    number: number;
  }>;
};

type JobsPayload = {
  jobs: Job[];
};

const failureConclusions = new Set<RunConclusion>([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

const logErrorPatterns = [
  /Database Error/i,
  /Compilation Error/i,
  /Runtime Error/i,
  /Failure in test/i,
  /Warning in test/i,
  /Got \d+ results,\s+configured to warn if/i,
  /system\$get_dbt_log/i,
  /DBT job failed/i,
  /SQL compilation error/i,
  /Encountered an error/i,
  /permission denied/i,
  /Traceback \(most recent call last\):/i,
  /\berror\b/i,
  /\bfailed\b/i,
];

function getRepo() {
  const full = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (owner && repo) {
    return { owner, repo };
  }

  if (full && full.includes("/")) {
    const [parsedOwner, parsedRepo] = full.split("/");
    if (parsedOwner && parsedRepo) {
      return { owner: parsedOwner, repo: parsedRepo };
    }
  }

  return null;
}

function githubHeaders(accept = "application/vnd.github+json") {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("Missing GITHUB_TOKEN environment variable.");
  }

  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub API ${res.status}: ${errorText.slice(0, 250)}`);
  }

  return (await res.json()) as T;
}

async function ghFetchText(path: string): Promise<string> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders("application/vnd.github+json"),
    cache: "no-store",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub API ${res.status}: ${errorText.slice(0, 250)}`);
  }

  return res.text();
}

function fallbackWorkflowName(path: string) {
  const fileName = path.split("/").pop() ?? "Unknown workflow";
  return fileName.replace(".yml", "").replace(".yaml", "");
}

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

function isUsefulLogLine(line: string) {
  if (!line) {
    return false;
  }
  if (line.length < 8 || line.length > 240) {
    return false;
  }
  if (/^\[command\]/i.test(line)) {
    return false;
  }
  if (/^Run\s+/i.test(line) && !/system\$get_dbt_log/i.test(line)) {
    return false;
  }
  if (/^#/.test(line)) {
    return false;
  }
  if (/^##\[warning\]/i.test(line)) {
    return false;
  }
  if (/^print\(f?["']Error:/i.test(line)) {
    return false;
  }
  if (/result_text\.lower\(\)|command_success|^\s*if\s+.*:\s*$/i.test(line)) {
    return false;
  }
  if (/^Process completed with exit code \d+\.?$/i.test(line)) {
    return false;
  }
  return true;
}

function scoreLogLine(line: string) {
  if (/system\$get_dbt_log/i.test(line)) {
    return 5;
  }
  if (/Warning in test|Got \d+ results,\s+configured to warn if/i.test(line)) {
    return 4;
  }
  if (/Database Error|Compilation Error|Runtime Error|Failure in test/i.test(line)) {
    return 5;
  }
  if (/Error in model|Error in test|SQL compilation error/i.test(line)) {
    return 4;
  }
  if (/Traceback \(most recent call last\):|Exception/i.test(line)) {
    return 3;
  }
  if (/\berror\b/i.test(line)) {
    return 2;
  }
  if (/\bfailed\b/i.test(line)) {
    return 1;
  }
  return 0;
}

function truncate(text: string, max = 180) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function extractErrorHighlights(logText: string, limit = 3) {
  const lines = logText
    .split("\n")
    .map(normalizeLogLine)
    .filter(isUsefulLogLine);

  const candidates: Array<{ line: string; score: number; recency: number }> = [];
  let recency = 0;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!logErrorPatterns.some((pattern) => pattern.test(line))) {
      continue;
    }

    candidates.push({ line, score: scoreLogLine(line), recency });
    recency += 1;
  }

  const deduped = Array.from(
    new Map(
      candidates
        .sort((a, b) => b.score - a.score || a.recency - b.recency)
        .map((candidate) => [candidate.line, candidate]),
    ).values(),
  );

  return deduped.slice(0, limit).map((candidate) => candidate.line);
}

function getFailedStep(job: Job) {
  return (
    job.steps?.find((step) => failureConclusions.has(step.conclusion)) ??
    job.steps?.find((step) => step.conclusion === "failure")
  );
}

async function getJobFailureHighlights(owner: string, repo: string, jobId: number) {
  const rawLog = await ghFetchText(`/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`);
  const tail = rawLog.slice(-120_000);
  return extractErrorHighlights(tail, 6);
}

function parseDbtDiagnostics(highlights: string[]) {
  const modelNames = new Set<string>();
  let hasDatabaseError = false;
  let hasCompilationError = false;
  let hasRuntimeError = false;

  for (const line of highlights) {
    if (/Database Error/i.test(line)) {
      hasDatabaseError = true;
    }
    if (/Compilation Error/i.test(line)) {
      hasCompilationError = true;
    }
    if (/Runtime Error/i.test(line)) {
      hasRuntimeError = true;
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
  const errorType = hasDatabaseError
    ? "Database error"
    : hasCompilationError
      ? "Compilation error"
      : hasRuntimeError
        ? "Runtime error"
        : null;

  if (!errorType && models.length === 0) {
    return null;
  }

  const modelPart =
    models.length > 0
      ? `Affects model${models.length > 1 ? "s" : ""}: ${models.join(", ")}.`
      : "No model name was parsed from logs.";

  return `${errorType ?? "dbt error"} in deployment. ${modelPart}`;
}

function parseDbtOperationalContext(highlights: string[]) {
  const joined = highlights.join("\n");
  const testMatch = joined.match(/Warning in test\s+([a-zA-Z0-9_]+)/i);
  const warnThresholdMatch = joined.match(/Got\s+(\d+)\s+results,\s+configured to warn if\s+([^\n]+)/i);
  const snowflakeLogMatch = joined.match(/system\$get_dbt_log\('([^']+)'\)/i);
  const hasDbtJobFailure = /DBT job failed/i.test(joined);

  const points: string[] = [];

  if (testMatch?.[1] && warnThresholdMatch?.[1] && warnThresholdMatch?.[2]) {
    points.push(
      `Test warning threshold exceeded: ${testMatch[1]} returned ${warnThresholdMatch[1]} rows (warn condition: ${warnThresholdMatch[2]}).`,
    );
  } else if (testMatch?.[1]) {
    points.push(`Test warning detected in ${testMatch[1]}.`);
  }

  if (snowflakeLogMatch?.[1]) {
    points.push(`Snowflake debug log is available via system$get_dbt_log('${snowflakeLogMatch[1]}').`);
  }

  if (hasDbtJobFailure && points.length === 0) {
    points.push("dbt Cloud reported a generic job failure before model-level diagnostics were emitted.");
  }

  return {
    summaryNote: points[0] ?? null,
    points,
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeMessageCore(value: string) {
  const normalized = normalizeText(value);
  const parts = normalized.split(": ");
  if (parts.length < 2) {
    return normalized;
  }
  return parts.slice(1).join(": ");
}

function dedupePoints(summary: string, points: string[]) {
  const summaryNorm = normalizeText(summary);
  const summaryCoreNorm = normalizeMessageCore(summary);
  return Array.from(new Set(points)).filter((point) => {
    const pointNorm = normalizeText(point);
    const pointCoreNorm = normalizeMessageCore(point);
    return (
      pointNorm !== summaryNorm &&
      !summaryNorm.includes(pointNorm) &&
      pointCoreNorm !== summaryCoreNorm &&
      !summaryCoreNorm.includes(pointCoreNorm)
    );
  });
}

function summarizeJobFailure(job: Job, highlights: string[]) {
  const failedStep = getFailedStep(job);
  const hasStrongDiagnostic = highlights.some((line) =>
    /Database Error|Compilation Error|Runtime Error|Error in model|Error in test|SQL compilation error|Traceback|Exception/i.test(
      line,
    ),
  );

  if (job.conclusion === "cancelled" && !hasStrongDiagnostic) {
    const cancelledMessage = failedStep
      ? `${job.name}: job was cancelled while executing step ${failedStep.number} (${failedStep.name}).`
      : `${job.name}: job was cancelled before completion.`;
    return {
      summary: cancelledMessage,
      points: [],
    };
  }

  if (highlights.length > 0) {
    const stepSuffix = failedStep ? ` (failed at step: ${failedStep.name})` : "";
    const dbtSummary = parseDbtDiagnostics(highlights);
    const dbtContext = parseDbtOperationalContext(highlights);
    const summary =
      dbtSummary && dbtContext.summaryNote
        ? `${job.name}${stepSuffix}: ${dbtSummary} ${dbtContext.summaryNote}`
        : dbtSummary
          ? `${job.name}${stepSuffix}: ${dbtSummary}`
          : dbtContext.summaryNote
            ? `${job.name}${stepSuffix}: ${dbtContext.summaryNote}`
            : `${job.name}${stepSuffix}: ${truncate(highlights[0])}`;
    const points = [
      ...dbtContext.points.map((point) => `${job.name}: ${truncate(point)}`),
      ...highlights
      .slice(0, 2)
      .map((highlight) => `${job.name}: ${truncate(highlight)}`),
    ];
    return { summary, points };
  }

  if (!failedStep) {
    return {
      summary: `${job.name}: job conclusion was ${job.conclusion}.`,
      points: [`${job.name}: job conclusion was ${job.conclusion}.`],
    };
  }

  const fallback = `${job.name}: step #${failedStep.number} (${failedStep.name}) ended with ${failedStep.conclusion}.`;
  return {
    summary: fallback,
    points: [fallback],
  };
}

async function buildFailureSummary(owner: string, repo: string, jobs: Job[]) {
  const failedJobs = jobs.filter((job) => failureConclusions.has(job.conclusion));

  if (failedJobs.length === 0) {
    return {
      summary: "Run did not succeed, but no failed job details were returned by GitHub.",
      points: [] as string[],
    };
  }

  const inspectJobs = failedJobs.slice(0, 2);
  const insights = await Promise.all(
    inspectJobs.map(async (job) => {
      try {
        const highlights = await getJobFailureHighlights(owner, repo, job.id);
        return summarizeJobFailure(job, highlights);
      } catch {
        return summarizeJobFailure(job, []);
      }
    }),
  );

  const points = Array.from(new Set(insights.flatMap((insight) => insight.points))).slice(0, 4);

  const extraJobs = failedJobs.length - inspectJobs.length;
  const summaryBase = insights[0]?.summary ?? "Workflow failed with no details.";
  const summary =
    failedJobs.length === 1
      ? summaryBase
      : `${failedJobs.length} jobs failed. Primary issue: ${summaryBase}${extraJobs > 0 ? ` (+${extraJobs} more failed job${extraJobs > 1 ? "s" : ""})` : ""}`;

  return { summary, points: dedupePoints(summary, points) };
}

async function getFailureDetails(owner: string, repo: string, runId: number) {
  const jobsPayload = await ghFetch<JobsPayload>(
    `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`,
  );

  return buildFailureSummary(owner, repo, jobsPayload.jobs);
}

async function fetchWorkflowRuns(
  owner: string,
  repo: string,
  opts: { since: string | null; maxRuns: number },
) {
  const perPage = 100;
  const pages = Math.ceil(opts.maxRuns / perPage);
  const allRuns: WorkflowRunsPayload["workflow_runs"] = [];

  for (let page = 1; page <= pages; page += 1) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
    });

    if (opts.since) {
      params.set("created", `>=${opts.since}`);
    }

    const payload = await ghFetch<WorkflowRunsPayload>(
      `/repos/${owner}/${repo}/actions/runs?${params.toString()}`,
    );

    if (payload.workflow_runs.length === 0) {
      break;
    }

    allRuns.push(...payload.workflow_runs);
    if (allRuns.length >= opts.maxRuns || payload.workflow_runs.length < perPage) {
      break;
    }
  }

  return allRuns.slice(0, opts.maxRuns);
}

export async function GET(request: NextRequest) {
  try {
    const repoConfig = getRepo();
    if (!repoConfig) {
      return NextResponse.json(
        {
          error:
            "Set GITHUB_OWNER and GITHUB_REPO (or GITHUB_REPOSITORY=owner/repo) in your environment.",
        },
        { status: 400 },
      );
    }

    const { owner, repo } = repoConfig;
    const rawMaxRuns = request.nextUrl.searchParams.get("maxRuns") ?? "1200";
    const maxRuns = Math.min(2000, Math.max(100, Number.parseInt(rawMaxRuns, 10) || 1200));
    const rawDetailsLimit = request.nextUrl.searchParams.get("detailsLimit") ?? "150";
    const detailsLimit = Math.min(400, Math.max(0, Number.parseInt(rawDetailsLimit, 10) || 150));
    const since = request.nextUrl.searchParams.get("since");

    const workflowRuns = await fetchWorkflowRuns(owner, repo, { since, maxRuns });

    const runs = await Promise.all(
      workflowRuns.map(async (run, index): Promise<ActionsRun> => {
        const startedAt = run.run_started_at ?? run.created_at;
        const base: ActionsRun = {
          id: run.id,
          name: resolveRunTitle(run),
          workflowName: run.name || fallbackWorkflowName(run.path),
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
          durationMs: parseDurationMs(startedAt, run.updated_at),
          failureSummary: null,
          failurePoints: [],
        };

        if (run.status !== "completed" || run.conclusion === "success") {
          return base;
        }

        if (index >= detailsLimit) {
          return base;
        }

        try {
          const failureDetails = await getFailureDetails(owner, repo, run.id);
          return {
            ...base,
            failureSummary: failureDetails.summary,
            failurePoints: failureDetails.points,
          };
        } catch {
          return {
            ...base,
            failureSummary: "Failed to load detailed failure info for this run.",
          };
        }
      }),
    );

    const response: ActionsHistoryResponse = {
      owner,
      repo,
      generatedAt: new Date().toISOString(),
      runs,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexConnectionState, useQuery } from "convex/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActionsHistoryResponse, ActionsRun } from "@/lib/types";

const EMPTY_RUNS: ActionsRun[] = [];
const chartAnimationMs = 180;
type PeriodFilter = "24h" | "7d" | "30d" | "90d" | "all";

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All fetched runs" },
];

function formatDuration(durationMs: number) {
  const totalSec = Math.round(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function formatMinutes(durationMs: number) {
  return Math.round(durationMs / 60_000);
}

function formatTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatAxisTime(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDurationFromSeconds(secondsValue: number) {
  const seconds = Math.max(0, Math.round(secondsValue));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (remainder === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainder}s`;
}

function formatDurationAxisTick(secondsValue: number) {
  const seconds = Math.max(0, Math.round(secondsValue));
  if (seconds < 120) {
    return `${seconds}s`;
  }
  return `${Math.round(seconds / 60)}m`;
}

function getPeriodStart(period: PeriodFilter, endTime: Date) {
  if (period === "all") {
    return null;
  }
  const map: Record<Exclude<PeriodFilter, "all">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  return new Date(endTime.getTime() - map[period]);
}

function getPeriodSinceIso(period: PeriodFilter) {
  if (period === "all") {
    return null;
  }
  const start = getPeriodStart(period, new Date());
  return start?.toISOString() ?? null;
}

function getMaxRunsForPeriod(period: PeriodFilter) {
  switch (period) {
    case "24h":
      return 200;
    case "7d":
      return 500;
    case "30d":
      return 900;
    case "90d":
      return 1400;
    case "all":
      return 1500;
  }
}

function statusTone(run: ActionsRun) {
  if (run.status !== "completed") {
    return "bg-amber-100 text-amber-800 ring-amber-200";
  }
  if (run.conclusion === "success") {
    return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
  return "bg-rose-100 text-rose-800 ring-rose-200";
}

function getDisplayFailurePoints(run: ActionsRun) {
  if (!run.failureSummary) {
    return run.failurePoints;
  }
  const summaryNorm = run.failureSummary.trim().replace(/\s+/g, " ").toLowerCase();
  return run.failurePoints.filter((point) => {
    const pointNorm = point.trim().replace(/\s+/g, " ").toLowerCase();
    return pointNorm !== summaryNorm && !summaryNorm.includes(pointNorm);
  });
}

function extractFailureHeadline(summary: string | null) {
  if (!summary) {
    return null;
  }
  const firstColon = summary.indexOf(": ");
  if (firstColon === -1) {
    return summary;
  }
  return summary.slice(firstColon + 2);
}

export function ActionsDashboard({
  initialData = null,
}: {
  initialData?: ActionsHistoryResponse | null;
}) {
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [prFilter, setPrFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("30d");
  const [query, setQuery] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showAllFailures, setShowAllFailures] = useState(false);
  const [showConnectionWarning, setShowConnectionWarning] = useState(false);
  const since = useMemo(() => getPeriodSinceIso(periodFilter), [periodFilter]);
  const connectionState = useConvexConnectionState();
  const liveData = useQuery("history:getHistory" as never, {
    since: since ?? undefined,
    maxRuns: getMaxRunsForPeriod(periodFilter),
  } as never) as ActionsHistoryResponse | undefined;
  const data = liveData ?? initialData;
  const loading = data === null || data === undefined;

  useEffect(() => {
    if (connectionState.isWebSocketConnected || connectionState.hasInflightRequests) {
      const clearTimeoutId = window.setTimeout(() => setShowConnectionWarning(false), 0);
      return () => window.clearTimeout(clearTimeoutId);
    }
    const timeout = window.setTimeout(() => setShowConnectionWarning(true), 2500);
    return () => window.clearTimeout(timeout);
  }, [connectionState.hasInflightRequests, connectionState.isWebSocketConnected]);

  const runs = data?.runs ?? EMPTY_RUNS;
  const generatedAt = data?.generatedAt;
  const periodEnd = useMemo(
    () => (generatedAt ? new Date(generatedAt) : new Date()),
    [generatedAt],
  );
  const periodStart = useMemo(
    () => getPeriodStart(periodFilter, periodEnd),
    [periodFilter, periodEnd],
  );

  const runsInPeriod = useMemo(() => {
    if (!periodStart) {
      return runs;
    }
    const threshold = periodStart.getTime();
    return runs.filter((run) => new Date(run.updatedAt).getTime() >= threshold);
  }, [runs, periodStart]);

  const workflowOptions = useMemo(
    () => Array.from(new Set(runsInPeriod.map((run) => run.workflowName))).sort((a, b) => a.localeCompare(b)),
    [runsInPeriod],
  );

  const branchOptions = useMemo(
    () => Array.from(new Set(runsInPeriod.map((run) => run.branch))).sort((a, b) => a.localeCompare(b)),
    [runsInPeriod],
  );

  const prOptions = useMemo(
    () => Array.from(new Set(runsInPeriod.flatMap((run) => run.prNumbers))).sort((a, b) => b - a),
    [runsInPeriod],
  );

  const effectiveWorkflowFilter =
    workflowFilter === "all" || workflowOptions.includes(workflowFilter) ? workflowFilter : "all";
  const effectiveBranchFilter =
    branchFilter === "all" || branchOptions.includes(branchFilter) ? branchFilter : "all";
  const effectivePrFilter =
    prFilter === "all" || prOptions.includes(Number(prFilter)) ? prFilter : "all";

  const filteredRuns = useMemo(() => {
    const selectedPr = effectivePrFilter === "all" ? null : Number(effectivePrFilter);
    const normalizedQuery = query.trim().toLowerCase();

    return runsInPeriod.filter((run) => {
      if (effectiveWorkflowFilter !== "all" && run.workflowName !== effectiveWorkflowFilter) {
        return false;
      }

      if (effectiveBranchFilter !== "all" && run.branch !== effectiveBranchFilter) {
        return false;
      }

      if (selectedPr !== null && !run.prNumbers.includes(selectedPr)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchBlob = [run.workflowName, run.name, run.branch, run.actor, `${run.runNumber}`, run.prNumbers.join(" ")]
        .join(" ")
        .toLowerCase();

      return searchBlob.includes(normalizedQuery);
    });
  }, [runsInPeriod, effectiveWorkflowFilter, effectiveBranchFilter, effectivePrFilter, query]);

  const summary = useMemo(() => {
    const completed = filteredRuns.filter((run) => run.status === "completed");
    const successful = completed.filter((run) => run.conclusion === "success");
    const failed = completed.filter((run) => run.conclusion !== "success");

    const successRate = completed.length === 0 ? 0 : Math.round((successful.length / completed.length) * 100);
    const totalDurationMs = completed.reduce((acc, run) => acc + run.durationMs, 0);

    return {
      total: filteredRuns.length,
      completed: completed.length,
      successful: successful.length,
      failed: failed.length,
      successRate,
      totalDurationMs,
    };
  }, [filteredRuns]);

  const minutesByDayData = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const run of filteredRuns) {
      if (run.status !== "completed") {
        continue;
      }
      const day = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(run.updatedAt));
      grouped.set(day, (grouped.get(day) ?? 0) + run.durationMs);
    }

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, durationMs]) => ({
        day,
        minutes: Number((durationMs / 60_000).toFixed(1)),
      }));
  }, [filteredRuns]);

  const trendData = useMemo(() => {
    const sorted = [...filteredRuns].sort(
      (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    );

    return sorted.slice(-40).map((run) => ({
        ts: new Date(run.updatedAt).getTime(),
        runNumber: run.runNumber,
        workflowName: run.workflowName,
        durationSeconds: Number((run.durationMs / 1000).toFixed(1)),
      }));
  }, [filteredRuns]);

  const passFailByDateData = useMemo(() => {
    const map = new Map<string, { day: string; success: number; failed: number }>();

    for (const run of filteredRuns) {
      if (run.status !== "completed") {
        continue;
      }

      const day = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(run.updatedAt));

      const current = map.get(day) ?? { day, success: 0, failed: 0 };
      if (run.conclusion === "success") {
        current.success += 1;
      } else {
        current.failed += 1;
      }
      map.set(day, current);
    }

    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [filteredRuns]);

  const failureByWorkflowTypeData = useMemo(() => {
    const map = new Map<string, { workflow: string; failed: number; success: number }>();

    for (const run of filteredRuns) {
      if (run.status !== "completed") {
        continue;
      }
      const current = map.get(run.workflowName) ?? {
        workflow: run.workflowName,
        failed: 0,
        success: 0,
      };
      if (run.conclusion === "success") {
        current.success += 1;
      } else {
        current.failed += 1;
      }
      map.set(run.workflowName, current);
    }

    return Array.from(map.values())
      .sort((a, b) => b.failed - a.failed || b.success - a.success)
      .slice(0, 8);
  }, [filteredRuns]);

  const pieData = useMemo(
    () => [
      { name: "Success", value: summary.successful, color: "#10b981" },
      { name: "Failed", value: summary.failed, color: "#f43f5e" },
    ],
    [summary.failed, summary.successful],
  );

  const topWorkflows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runsInPeriod) {
      counts.set(run.workflowName, (counts.get(run.workflowName) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name]) => name);
  }, [runsInPeriod]);

  const recentFailedRuns = useMemo(() => {
    return [...filteredRuns]
      .filter((run) => run.status === "completed" && run.conclusion !== "success")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [filteredRuns]);
  const visibleRecentFailedRuns = showAllFailures ? recentFailedRuns : recentFailedRuns.slice(0, 3);

  const reportingPeriodLabel = useMemo(() => {
    if (periodFilter === "all") {
      if (runs.length === 0) {
        return "All fetched runs (no data loaded yet)";
      }
      const sorted = [...runs].sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      );
      const start = new Date(sorted[0].updatedAt);
      const end = new Date(sorted[sorted.length - 1].updatedAt);
      return `All fetched runs: ${formatDate(start)} to ${formatDate(end)}`;
    }

    if (!periodStart) {
      return "Reporting period unavailable";
    }

    return `${PERIOD_OPTIONS.find((option) => option.value === periodFilter)?.label}: ${formatDate(periodStart)} to ${formatDate(periodEnd)}`;
  }, [periodFilter, periodStart, periodEnd, runs]);

  const hasRunsInPeriod = runsInPeriod.length > 0;
  const hasVisibleRuns = filteredRuns.length > 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_500px_at_20%_0%,#dbeafe_0%,#f8fafc_60%)] px-5 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">GitHub Actions Observability</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{data ? `${data.owner}/${data.repo}` : "Repository"}</h1>
            <p className="text-sm text-slate-600">
              Last refresh: {data ? formatTime(data.generatedAt) : "-"} •{" "}
              Data source: Convex cache
            </p>
          </div>
          <p className="mt-1 text-sm text-slate-600">Reporting period: {reportingPeriodLabel}</p>
        </header>

        {showConnectionWarning && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Realtime connection to Convex is not established yet.
          </section>
        )}

        <section className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-lg shadow-slate-900/5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Filters</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((current) => !current)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {showAdvancedFilters ? "Hide filters" : "More filters"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkflowFilter("all");
                  setBranchFilter("all");
                  setPrFilter("all");
                  setQuery("");
                  setShowAllFailures(false);
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear filters
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <label className="space-y-1 text-xs text-slate-600">
              Period
              <select
                value={periodFilter}
                onChange={(event) => setPeriodFilter(event.target.value as PeriodFilter)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs text-slate-600">
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="workflow, branch, PR, run #, actor"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </label>
          </div>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
              Quick Workflow Filters
            </p>
            <div className="flex flex-wrap gap-2">
              {topWorkflows.map((workflow) => (
                <button
                  key={workflow}
                  type="button"
                  onClick={() => setWorkflowFilter(workflow)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                    workflowFilter === workflow
                      ? "bg-sky-100 text-sky-800 ring-sky-300"
                      : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {workflow}
                </button>
              ))}
            </div>
          </div>

          {showAdvancedFilters && (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-xs text-slate-600">
                  Workflow (Action)
                  <select
                    value={effectiveWorkflowFilter}
                    onChange={(event) => setWorkflowFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="all">All workflows</option>
                    {workflowOptions.map((workflow) => (
                      <option key={workflow} value={workflow}>
                        {workflow}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs text-slate-600">
                  Branch
                  <select
                    value={effectiveBranchFilter}
                    onChange={(event) => setBranchFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="all">All branches</option>
                    {branchOptions.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs text-slate-600">
                  PR
                  <select
                    value={effectivePrFilter}
                    onChange={(event) => setPrFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="all">All PRs</option>
                    {prOptions.map((prNumber) => (
                      <option key={prNumber} value={String(prNumber)}>
                        PR #{prNumber}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
        </section>

        {loading && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            Loading live run data...
          </section>
        )}

        {!loading && !hasRunsInPeriod && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            No actions ran in the selected reporting period.
          </section>
        )}

        {!loading && hasRunsInPeriod && !hasVisibleRuns && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            No runs match the current branch/workflow/PR/search filters in this period.
          </section>
        )}

        {!loading && hasVisibleRuns && (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <MetricCard label="Failures" value={summary.failed} />
              <MetricCard label="Success Rate" value={`${summary.successRate}%`} />
              <MetricCard label="Total Minutes (Est.)" value={formatMinutes(summary.totalDurationMs)} />
            </section>
            <p className="text-sm text-slate-600">
              {summary.total} visible runs in this view.
            </p>
            <p className="text-xs text-slate-500">
              `Total Minutes (Est.)` uses workflow run durations. GitHub Usage Metrics reports billed job-minutes, so values will differ.
            </p>

            {recentFailedRuns.length > 0 && (
              <section className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-rose-900">Recent Failures</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-rose-700">{visibleRecentFailedRuns.length} shown</span>
                    {recentFailedRuns.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setShowAllFailures((current) => !current)}
                        className="rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        {showAllFailures ? "Show less" : `View all (${recentFailedRuns.length})`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {visibleRecentFailedRuns.map((run) => (
                    <a
                      key={`failure-${run.id}`}
                      href={run.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-md border border-rose-100 bg-white px-3 py-2 text-sm hover:border-rose-300"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium text-slate-900">
                          {run.workflowName} #{run.runNumber}
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {run.prNumbers.length > 0
                              ? `· PR #${run.prNumbers[0]} by ${run.actor}`
                              : `· by ${run.actor}`}
                          </span>
                        </p>
                        <span className="text-xs text-slate-500">{formatTime(run.updatedAt)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-rose-900">
                        What failed: {extractFailureHeadline(run.failureSummary) ?? run.name}
                      </p>
                      {getDisplayFailurePoints(run).length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {getDisplayFailurePoints(run)
                            .slice(0, 2)
                            .map((point) => (
                              <li key={`quick-${run.id}-${point}`} className="break-words">
                                {point}
                              </li>
                            ))}
                        </ul>
                      )}
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Analytics</h2>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Run Duration Trend" className="lg:col-span-2">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      minTickGap={32}
                      tick={{ fontSize: 11 }}
                      tickFormatter={formatAxisTime}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatDurationAxisTick} />
                    <Tooltip
                      formatter={(value) => formatDurationFromSeconds(Number(value ?? 0))}
                      labelFormatter={(value, payload) => {
                        const row = payload?.[0]?.payload as
                          | { runNumber?: number; workflowName?: string }
                          | undefined;
                        const runLabel = row?.runNumber ? `Run #${row.runNumber}` : "Run";
                        const workflowLabel = row?.workflowName ? ` - ${row.workflowName}` : "";
                        return `${formatTime(new Date(Number(value)).toISOString())} (${runLabel}${workflowLabel})`;
                      }}
                    />
                    <Line
                      dataKey="durationSeconds"
                      type="linear"
                      stroke="#0284c7"
                      strokeWidth={3}
                      dot={false}
                      animationDuration={chartAnimationMs}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Outcome Split">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Tooltip />
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={80}
                      animationDuration={chartAnimationMs}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <text
                      x="50%"
                      y="48%"
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-slate-900 text-2xl font-semibold"
                    >
                      {summary.successRate}%
                    </text>
                    <text
                      x="50%"
                      y="60%"
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-slate-500 text-xs"
                    >
                      success
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section>
              <ChartCard title="Actions Minutes by Day (Estimated)">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={minutesByDayData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="m" />
                    <Tooltip formatter={(value) => `${value ?? 0} min`} />
                    <Bar
                      dataKey="minutes"
                      fill="#0ea5e9"
                      radius={[4, 4, 0, 0]}
                      animationDuration={chartAnimationMs}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Pass / Fail by Workflow Type">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={failureByWorkflowTypeData} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="workflow" width={160} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar
                      dataKey="success"
                      stackId="a"
                      fill="#10b981"
                      radius={[4, 0, 0, 4]}
                      animationDuration={chartAnimationMs}
                    />
                    <Bar
                      dataKey="failed"
                      stackId="a"
                      fill="#f43f5e"
                      radius={[0, 4, 4, 0]}
                      animationDuration={chartAnimationMs}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title={
                  workflowFilter === "all"
                    ? "Pass / Fail by Date (Filtered)"
                    : `Pass / Fail by Date (${workflowFilter})`
                }
              >
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={passFailByDateData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar
                      dataKey="success"
                      stackId="a"
                      fill="#10b981"
                      radius={[0, 0, 4, 4]}
                      animationDuration={chartAnimationMs}
                    />
                    <Bar
                      dataKey="failed"
                      stackId="a"
                      fill="#f43f5e"
                      radius={[4, 4, 0, 0]}
                      animationDuration={chartAnimationMs}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="rounded-2xl border border-white/70 bg-white/85 p-4 shadow-lg shadow-slate-900/5 backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Run History (Filtered)</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{filteredRuns.length} run(s)</span>
                  {loading && <span className="text-xs text-slate-500">Loading...</span>}
                </div>
              </div>

              <div className="space-y-3">
                {filteredRuns.map((run) => {
                  const displayFailurePoints = getDisplayFailurePoints(run);
                  return (
                    <article key={run.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <a
                            href={run.url}
                            className="text-sm font-semibold text-slate-900 hover:text-sky-700"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {run.workflowName} #{run.runNumber}
                          </a>
                          <p className="text-sm text-slate-600">{run.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {run.branch} • {run.event} • {run.actor} • {formatTime(run.updatedAt)}
                          </p>
                          {run.prNumbers.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {run.prNumbers.map((prNumber) => (
                                <button
                                  key={`${run.id}-${prNumber}`}
                                  type="button"
                                  onClick={() => setPrFilter(String(prNumber))}
                                  className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200"
                                >
                                  PR #{prNumber}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${statusTone(run)}`}>
                            {run.status === "completed" ? run.conclusion || "unknown" : run.status}
                          </span>
                          <span className="text-xs text-slate-500">{formatDuration(run.durationMs)}</span>
                        </div>
                      </div>

                      {run.failureSummary && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                          <p className="text-sm font-medium text-rose-800">Failure summary</p>
                          <p className="mt-1 text-sm text-rose-900">{run.failureSummary}</p>
                          {displayFailurePoints.length > 0 && (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-900">
                              {displayFailurePoints.map((point) => (
                                <li key={point}>{point}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/90 p-4 shadow-lg shadow-slate-900/5 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-white/70 bg-white/90 p-4 shadow-lg shadow-slate-900/5 ${className ?? ""}`}>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </div>
  );
}

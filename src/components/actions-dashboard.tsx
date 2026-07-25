"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexConnectionState, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActionsHistoryResponse, ActionsRun } from "@/lib/types";

const EMPTY_RUNS: ActionsRun[] = [];
const chartAnimationMs = 180;
const initialVisibleRuns = 25;

type PeriodFilter = "24h" | "7d" | "30d" | "90d" | "all";
type RunView = "all" | "failed" | "running" | "successful";
type IconName =
  | "activity"
  | "arrow-up-right"
  | "branch"
  | "check"
  | "chevron"
  | "clock"
  | "filter"
  | "pulse"
  | "search"
  | "warning"
  | "workflow"
  | "x";

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string; shortLabel: string }> = [
  { value: "24h", label: "Last 24 hours", shortLabel: "24h" },
  { value: "7d", label: "Last 7 days", shortLabel: "7d" },
  { value: "30d", label: "Last 30 days", shortLabel: "30d" },
  { value: "90d", label: "Last 90 days", shortLabel: "90d" },
  { value: "all", label: "All fetched runs", shortLabel: "All" },
];

const RUN_VIEW_OPTIONS: Array<{ value: RunView; label: string }> = [
  { value: "all", label: "All runs" },
  { value: "failed", label: "Failed" },
  { value: "running", label: "Running" },
  { value: "successful", label: "Successful" },
];

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function formatDurationAxis(minutes: number) {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.round(minutes / 60)}h`;
}

function formatTime(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value: string | null) {
  if (!value) return "not yet";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "unknown";
  const differenceMinutes = Math.round((time - Date.now()) / 60_000);
  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(differenceMinutes) < 60) return relative.format(differenceMinutes, "minute");
  const differenceHours = Math.round(differenceMinutes / 60);
  if (Math.abs(differenceHours) < 24) return relative.format(differenceHours, "hour");
  return relative.format(Math.round(differenceHours / 24), "day");
}

function formatShortDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

function getPeriodMs(period: PeriodFilter) {
  const durations: Record<Exclude<PeriodFilter, "all">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  return period === "all" ? null : durations[period];
}

function getFetchSinceIso(period: PeriodFilter) {
  const duration = getPeriodMs(period);
  if (!duration) return null;
  return new Date(Date.now() - duration * 2).toISOString();
}

function getMaxRunsForPeriod(period: PeriodFilter) {
  switch (period) {
    case "24h":
      return 300;
    case "7d":
      return 700;
    case "30d":
      return 1400;
    case "90d":
    case "all":
      return 2000;
  }
}

function isFailedRun(run: ActionsRun) {
  return run.status === "completed" && run.conclusion !== "success";
}

function statusLabel(run: ActionsRun) {
  if (run.status === "in_progress") return "Running";
  if (run.status === "queued") return "Queued";
  if (run.conclusion === "success") return "Passed";
  if (run.conclusion === "cancelled") return "Cancelled";
  if (run.conclusion === "timed_out") return "Timed out";
  return "Failed";
}

function statusTone(run: ActionsRun) {
  if (run.status !== "completed") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (run.conclusion === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (run.conclusion === "cancelled" || run.conclusion === "skipped") {
    return "border-slate-200 bg-slate-50 text-slate-600";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function statusDotTone(run: ActionsRun) {
  if (run.status !== "completed") return "bg-amber-500";
  if (run.conclusion === "success") return "bg-emerald-500";
  if (run.conclusion === "cancelled" || run.conclusion === "skipped") return "bg-slate-400";
  return "bg-rose-500";
}

function extractFailureHeadline(summary: string | null, fallback: string) {
  if (!summary) return fallback;
  const firstColon = summary.indexOf(": ");
  return firstColon === -1 ? summary : summary.slice(firstColon + 2);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeRuns(runs: ActionsRun[]) {
  const completed = runs.filter((run) => run.status === "completed");
  const successful = completed.filter((run) => run.conclusion === "success");
  const failed = completed.filter((run) => run.conclusion !== "success");
  const active = runs.filter((run) => run.status !== "completed");
  const durations = completed.map((run) => run.durationMs).filter((duration) => duration > 0);

  return {
    total: runs.length,
    completed: completed.length,
    successful: successful.length,
    failed: failed.length,
    active: active.length,
    successRate:
      completed.length === 0 ? 0 : Math.round((successful.length / completed.length) * 100),
    medianDurationMs: median(durations),
  };
}

function runMatchesView(run: ActionsRun, view: RunView) {
  if (view === "failed") return isFailedRun(run);
  if (view === "running") return run.status !== "completed";
  if (view === "successful") return run.status === "completed" && run.conclusion === "success";
  return true;
}

export function ActionsDashboard({
  initialData = null,
}: {
  initialData?: ActionsHistoryResponse | null;
}) {
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [prFilter, setPrFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("7d");
  const [runView, setRunView] = useState<RunView>("all");
  const [query, setQuery] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showAllFailures, setShowAllFailures] = useState(false);
  const [visibleRunCount, setVisibleRunCount] = useState(initialVisibleRuns);
  const [showConnectionWarning, setShowConnectionWarning] = useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  const connectionState = useConvexConnectionState();

  const [snapshot, setSnapshot] = useState<ActionsHistoryResponse | null>(initialData);
  const [tailSince, setTailSince] = useState<string>(() => {
    const base = initialData?.generatedAt
      ? new Date(initialData.generatedAt).getTime()
      : Date.now();
    return new Date(base - 2 * 60_000).toISOString();
  });
  const lastSnapshotSyncedAt = useRef<string | null>(initialData?.generatedAt ?? null);

  const fetchSnapshot = useCallback(async (period: PeriodFilter) => {
    try {
      const params = new URLSearchParams();
      const since = getFetchSinceIso(period);
      if (since) params.set("since", since);
      params.set("maxRuns", String(getMaxRunsForPeriod(period)));
      const response = await fetch(`/api/history?${params}`);
      if (!response.ok) throw new Error(`snapshot fetch ${response.status}`);
      const result: ActionsHistoryResponse = await response.json();
      setSnapshot(result);
      lastSnapshotSyncedAt.current = result.generatedAt;
      setTailSince(new Date(Date.now() - 2 * 60_000).toISOString());
    } catch (error) {
      console.warn("[snapshot] fetch failed, keeping previous:", error);
    }
  }, []);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchSnapshot(periodFilter);
  }, [periodFilter, fetchSnapshot]);

  const generatedAt = useQuery(api.history.getSyncTimestamp) ?? snapshot?.generatedAt ?? null;

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (generatedAt && generatedAt !== lastSnapshotSyncedAt.current) {
        fetchSnapshot(periodFilter);
      }
    }, 30 * 60_000);
    return () => window.clearInterval(interval);
  }, [periodFilter, fetchSnapshot, generatedAt]);

  const tailRuns = useQuery(api.history.getRecentRuns, {
    since: tailSince,
    maxRuns: 200,
  }) as ActionsRun[] | undefined;

  const data = useMemo<ActionsHistoryResponse | null>(() => {
    if (!snapshot) return null;
    if (!tailRuns || tailRuns.length === 0) {
      return { ...snapshot, generatedAt };
    }
    const runMap = new Map<number, ActionsRun>();
    for (const run of snapshot.runs) runMap.set(run.id, run);
    for (const run of tailRuns) runMap.set(run.id, run);
    return {
      owner: snapshot.owner,
      repo: snapshot.repo,
      generatedAt,
      runs: Array.from(runMap.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    };
  }, [snapshot, tailRuns, generatedAt]);

  useEffect(() => {
    const connected =
      connectionState.isWebSocketConnected || connectionState.hasInflightRequests;
    if (connected) {
      setHasConnectedOnce(true);
      setShowConnectionWarning(false);
      return;
    }
    if (!hasConnectedOnce) return;
    const timeout = window.setTimeout(() => setShowConnectionWarning(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [
    connectionState.hasInflightRequests,
    connectionState.isWebSocketConnected,
    hasConnectedOnce,
  ]);

  const runs = data?.runs ?? EMPTY_RUNS;
  const periodEnd = useMemo(
    () => (generatedAt ? new Date(generatedAt) : new Date()),
    [generatedAt],
  );
  const periodMs = getPeriodMs(periodFilter);
  const currentStartMs = periodMs ? periodEnd.getTime() - periodMs : null;
  const previousStartMs =
    periodMs && currentStartMs !== null ? currentStartMs - periodMs : null;

  const currentPeriodRuns = useMemo(() => {
    if (currentStartMs === null) return runs;
    return runs.filter((run) => new Date(run.updatedAt).getTime() >= currentStartMs);
  }, [currentStartMs, runs]);

  const previousPeriodRuns = useMemo(() => {
    if (currentStartMs === null || previousStartMs === null) return EMPTY_RUNS;
    return runs.filter((run) => {
      const updatedAt = new Date(run.updatedAt).getTime();
      return updatedAt >= previousStartMs && updatedAt < currentStartMs;
    });
  }, [currentStartMs, previousStartMs, runs]);

  const workflowOptions = useMemo(
    () =>
      Array.from(new Set(currentPeriodRuns.map((run) => run.workflowName))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [currentPeriodRuns],
  );
  const branchOptions = useMemo(
    () =>
      Array.from(new Set(currentPeriodRuns.map((run) => run.branch))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [currentPeriodRuns],
  );
  const actorOptions = useMemo(
    () =>
      Array.from(new Set(currentPeriodRuns.map((run) => run.actor))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [currentPeriodRuns],
  );
  const prOptions = useMemo(
    () =>
      Array.from(new Set(currentPeriodRuns.flatMap((run) => run.prNumbers))).sort(
        (a, b) => b - a,
      ),
    [currentPeriodRuns],
  );

  const effectiveWorkflowFilter =
    workflowFilter === "all" || workflowOptions.includes(workflowFilter)
      ? workflowFilter
      : "all";
  const effectiveBranchFilter =
    branchFilter === "all" || branchOptions.includes(branchFilter) ? branchFilter : "all";
  const effectiveActorFilter =
    actorFilter === "all" || actorOptions.includes(actorFilter) ? actorFilter : "all";
  const effectivePrFilter =
    prFilter === "all" || prOptions.includes(Number(prFilter)) ? prFilter : "all";

  const matchesDimensions = useCallback(
    (run: ActionsRun) => {
      if (
        effectiveWorkflowFilter !== "all" &&
        run.workflowName !== effectiveWorkflowFilter
      ) {
        return false;
      }
      if (effectiveBranchFilter !== "all" && run.branch !== effectiveBranchFilter) {
        return false;
      }
      if (effectiveActorFilter !== "all" && run.actor !== effectiveActorFilter) {
        return false;
      }
      if (
        effectivePrFilter !== "all" &&
        !run.prNumbers.includes(Number(effectivePrFilter))
      ) {
        return false;
      }
      return true;
    },
    [
      effectiveActorFilter,
      effectiveBranchFilter,
      effectivePrFilter,
      effectiveWorkflowFilter,
    ],
  );

  const scopedRuns = useMemo(
    () => currentPeriodRuns.filter(matchesDimensions),
    [currentPeriodRuns, matchesDimensions],
  );
  const scopedPreviousRuns = useMemo(
    () => previousPeriodRuns.filter(matchesDimensions),
    [previousPeriodRuns, matchesDimensions],
  );
  const summary = useMemo(() => summarizeRuns(scopedRuns), [scopedRuns]);
  const previousSummary = useMemo(
    () => summarizeRuns(scopedPreviousRuns),
    [scopedPreviousRuns],
  );
  const successRateDelta =
    periodFilter === "all" || previousSummary.completed === 0
      ? null
      : summary.successRate - previousSummary.successRate;

  const explorerRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return scopedRuns.filter((run) => {
      if (!runMatchesView(run, runView)) return false;
      if (!normalizedQuery) return true;
      return [
        run.workflowName,
        run.name,
        run.branch,
        run.actor,
        run.runNumber,
        ...run.prNumbers,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, runView, scopedRuns]);

  useEffect(() => {
    setVisibleRunCount(initialVisibleRuns);
  }, [
    effectiveActorFilter,
    effectiveBranchFilter,
    effectivePrFilter,
    effectiveWorkflowFilter,
    periodFilter,
    query,
    runView,
  ]);

  const recentFailures = useMemo(() => {
    const cutoff = periodEnd.getTime() - 48 * 60 * 60_000;
    return scopedRuns
      .filter((run) => isFailedRun(run) && new Date(run.updatedAt).getTime() >= cutoff)
      .sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [periodEnd, scopedRuns]);
  const visibleFailures = showAllFailures
    ? recentFailures
    : recentFailures.slice(0, 5);

  const workflowStats = useMemo(() => {
    const grouped = new Map<string, ActionsRun[]>();
    for (const run of scopedRuns) {
      const workflowRuns = grouped.get(run.workflowName) ?? [];
      workflowRuns.push(run);
      grouped.set(run.workflowName, workflowRuns);
    }
    return Array.from(grouped.entries())
      .map(([workflow, workflowRuns]) => {
        const stats = summarizeRuns(workflowRuns);
        return {
          workflow,
          runs: stats.total,
          failed: stats.failed,
          successRate: stats.successRate,
          medianMinutes: Number((stats.medianDurationMs / 60_000).toFixed(1)),
        };
      })
      .sort((a, b) => b.failed - a.failed || a.successRate - b.successRate)
      .slice(0, 8);
  }, [scopedRuns]);

  const reliabilityTrend = useMemo(() => {
    const grouped = new Map<
      string,
      { day: string; completed: number; successful: number; failed: number }
    >();
    for (const run of scopedRuns) {
      if (run.status !== "completed") continue;
      const day = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(run.updatedAt));
      const current = grouped.get(day) ?? {
        day,
        completed: 0,
        successful: 0,
        failed: 0,
      };
      current.completed += 1;
      if (run.conclusion === "success") current.successful += 1;
      else current.failed += 1;
      grouped.set(day, current);
    }
    return Array.from(grouped.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((item) => ({
        ...item,
        successRate:
          item.completed === 0 ? 0 : Math.round((item.successful / item.completed) * 100),
      }));
  }, [scopedRuns]);

  const hasActiveFilters =
    effectiveWorkflowFilter !== "all" ||
    effectiveBranchFilter !== "all" ||
    effectiveActorFilter !== "all" ||
    effectivePrFilter !== "all";

  const clearFilters = () => {
    setWorkflowFilter("all");
    setBranchFilter("all");
    setActorFilter("all");
    setPrFilter("all");
    setQuery("");
    setRunView("all");
    setShowAllFailures(false);
  };

  if (!data) {
    return <LoadingDashboard />;
  }

  return (
    <main className="min-h-screen bg-[#f4f6f9] text-slate-950">
      <header className="border-b border-white/10 bg-[#0b1220] text-white">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/10 text-sky-300 shadow-inner">
              <Icon name="workflow" className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  {data.owner}/{data.repo}
                </p>
                <span className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:inline">
                  Actions
                </span>
              </div>
              <p className="truncate text-xs text-slate-400">Workflow operations</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
            <span
              className={`size-2 rounded-full ${
                showConnectionWarning ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            <span className="hidden sm:inline">
              {showConnectionWarning ? "Reconnecting" : "Live"}
            </span>
            <span className="hidden text-slate-600 sm:inline">•</span>
            <span title={formatTime(data.generatedAt)}>
              Updated {formatRelativeTime(data.generatedAt)}
            </span>
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm shadow-slate-950/[0.03] backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriodFilter(option.value)}
                aria-pressed={periodFilter === option.value}
                title={option.label}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  periodFilter === option.value
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {option.shortLabel}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:flex"
              >
                <Icon name="x" className="size-3.5" />
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((current) => !current)}
              aria-expanded={showAdvancedFilters}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                showAdvancedFilters || hasActiveFilters
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <Icon name="filter" className="size-3.5" />
              Filters
              {hasActiveFilters && (
                <span className="grid size-4 place-items-center rounded-full bg-sky-600 text-[9px] text-white">
                  {
                    [
                      effectiveWorkflowFilter,
                      effectiveBranchFilter,
                      effectiveActorFilter,
                      effectivePrFilter,
                    ].filter((value) => value !== "all").length
                  }
                </span>
              )}
            </button>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="border-t border-slate-100 bg-white">
            <div className="mx-auto grid max-w-[1480px] gap-3 px-4 py-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
              <FilterSelect
                label="Workflow"
                value={effectiveWorkflowFilter}
                onChange={setWorkflowFilter}
                options={workflowOptions}
                allLabel="All workflows"
              />
              <FilterSelect
                label="Branch"
                value={effectiveBranchFilter}
                onChange={setBranchFilter}
                options={branchOptions}
                allLabel="All branches"
              />
              <FilterSelect
                label="Actor"
                value={effectiveActorFilter}
                onChange={setActorFilter}
                options={actorOptions}
                allLabel="All actors"
              />
              <label className="space-y-1 text-xs font-medium text-slate-500">
                Pull request
                <select
                  value={effectivePrFilter}
                  onChange={(event) => setPrFilter(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="all">All pull requests</option>
                  {prOptions.map((prNumber) => (
                    <option key={prNumber} value={String(prNumber)}>
                      PR #{prNumber}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        {showConnectionWarning && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Icon name="warning" className="size-4 shrink-0" />
            Live updates are reconnecting. Cached run data remains available.
          </div>
        )}

        <section aria-labelledby="overview-heading">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                Current health
              </p>
              <h1 id="overview-heading" className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                {summary.failed > 0
                  ? `${summary.failed} run${summary.failed === 1 ? "" : "s"} need attention`
                  : summary.active > 0
                    ? `${summary.active} workflow${summary.active === 1 ? "" : "s"} in progress`
                    : "All workflows are healthy"}
              </h1>
            </div>
            <p className="hidden text-xs text-slate-500 sm:block">
              {PERIOD_OPTIONS.find((option) => option.value === periodFilter)?.label}
              {hasActiveFilters ? " · filtered" : ""}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon="pulse"
              label="Success rate"
              value={`${summary.successRate}%`}
              detail={
                successRateDelta === null
                  ? `${summary.completed} completed runs`
                  : `${successRateDelta >= 0 ? "+" : ""}${successRateDelta} pts vs previous period`
              }
              tone={
                summary.successRate >= 95
                  ? "positive"
                  : summary.successRate >= 85
                    ? "warning"
                    : "negative"
              }
            />
            <MetricCard
              icon="warning"
              label="Failed"
              value={summary.failed}
              detail={
                summary.failed === 0
                  ? "No failed runs"
                  : `${recentFailures.length} in the last 48 hours`
              }
              tone={summary.failed > 0 ? "negative" : "positive"}
            />
            <MetricCard
              icon="activity"
              label="Runs"
              value={summary.total}
              detail={
                summary.active > 0
                  ? `${summary.active} currently active`
                  : "No workflows currently active"
              }
              tone={summary.active > 0 ? "info" : "neutral"}
            />
            <MetricCard
              icon="clock"
              label="Median duration"
              value={formatDuration(summary.medianDurationMs)}
              detail="Completed workflow runs"
              tone="neutral"
            />
          </div>
        </section>

        <section
          aria-labelledby="attention-heading"
          className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]"
        >
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.04]">
            <SectionHeader
              eyebrow="Needs attention"
              title="Recent failures"
              description="Failed runs from the last 48 hours, newest first."
              icon="warning"
              action={
                recentFailures.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllFailures((current) => !current)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {showAllFailures ? "Show fewer" : `View all ${recentFailures.length}`}
                  </button>
                ) : null
              }
            />

            {visibleFailures.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {visibleFailures.map((run) => (
                  <a
                    key={run.id}
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group grid gap-3 px-4 py-4 transition hover:bg-slate-50/80 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full bg-rose-500" />
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {run.workflowName}
                          <span className="ml-1.5 font-mono text-xs font-medium text-slate-400">
                            #{run.runNumber}
                          </span>
                        </p>
                      </div>
                      <p className="mt-1.5 line-clamp-2 pl-4 text-sm leading-5 text-slate-700">
                        {extractFailureHeadline(run.failureSummary, run.name)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Icon name="branch" className="size-3.5" />
                          {run.branch}
                        </span>
                        {run.prNumbers[0] && <span>PR #{run.prNumbers[0]}</span>}
                        <span>{run.actor}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 pl-4 sm:flex-col sm:items-end sm:justify-center sm:pl-0">
                      <span className="text-xs text-slate-500">{formatRelativeTime(run.updatedAt)}</span>
                      <span className="flex items-center gap-1 text-xs font-semibold text-sky-700 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                        Open run
                        <Icon name="arrow-up-right" className="size-3.5" />
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center px-6 py-10 text-center">
                <div>
                  <div className="mx-auto grid size-11 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                    <Icon name="check" className="size-5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">
                    No recent failures
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Nothing has failed in this view during the last 48 hours.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.04]">
            <SectionHeader
              eyebrow="By workflow"
              title="Reliability watch"
              description="Lowest-performing workflows in this view."
              icon="workflow"
            />
            {workflowStats.length > 0 ? (
              <div className="divide-y divide-slate-100 px-4">
                {workflowStats.slice(0, 6).map((workflow) => (
                  <button
                    type="button"
                    key={workflow.workflow}
                    onClick={() => setWorkflowFilter(workflow.workflow)}
                    className="group w-full py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-slate-800 group-hover:text-sky-700">
                        {workflow.workflow}
                      </p>
                      <span
                        className={`shrink-0 font-mono text-xs font-semibold ${
                          workflow.successRate >= 95
                            ? "text-emerald-600"
                            : workflow.successRate >= 85
                              ? "text-amber-600"
                              : "text-rose-600"
                        }`}
                      >
                        {workflow.successRate}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          workflow.successRate >= 95
                            ? "bg-emerald-500"
                            : workflow.successRate >= 85
                              ? "bg-amber-500"
                              : "bg-rose-500"
                        }`}
                        style={{ width: `${workflow.successRate}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {workflow.runs} runs · {workflow.failed} failed
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No workflow data for this period.
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="trends-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Trends
            </p>
            <h2 id="trends-heading" className="mt-1 text-xl font-semibold tracking-tight">
              Performance over time
            </h2>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
            <ChartCard
              title="Daily reliability"
              description="Success rate with failed-run volume."
            >
              {reliabilityTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart
                    data={reliabilityTrend}
                    margin={{ top: 12, right: 4, bottom: 0, left: -18 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e8edf3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={26}
                    />
                    <YAxis
                      yAxisId="rate"
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="failures"
                      orientation="right"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#cbd5e1" }}
                      axisLine={false}
                      tickLine={false}
                      width={24}
                    />
                    <Tooltip content={<ReliabilityTooltip />} />
                    <Bar
                      yAxisId="failures"
                      dataKey="failed"
                      name="Failed"
                      fill="#fecdd3"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={18}
                      animationDuration={chartAnimationMs}
                    />
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="successRate"
                      name="Success rate"
                      stroke="#0284c7"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4, fill: "#0284c7", strokeWidth: 0 }}
                      animationDuration={chartAnimationMs}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart />
              )}
            </ChartCard>

            <ChartCard
              title="Median duration"
              description="Typical run time for the busiest workflows."
            >
              {workflowStats.length > 0 ? (
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart
                    data={[...workflowStats]
                      .sort((a, b) => b.runs - a.runs)
                      .slice(0, 6)}
                    layout="vertical"
                    margin={{ top: 12, right: 10, bottom: 0, left: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e8edf3"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tickFormatter={formatDurationAxis}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="workflow"
                      width={112}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      tickFormatter={(value) =>
                        value.length > 17 ? `${value.slice(0, 16)}…` : value
                      }
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<DurationTooltip />} />
                    <Bar
                      dataKey="medianMinutes"
                      name="Median duration"
                      fill="#334155"
                      radius={[0, 5, 5, 0]}
                      animationDuration={chartAnimationMs}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          </div>
        </section>

        <section
          aria-labelledby="runs-heading"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.04]"
        >
          <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Run explorer
                </p>
                <h2 id="runs-heading" className="mt-1 text-xl font-semibold tracking-tight">
                  Workflow history
                </h2>
              </div>
              <label className="relative block w-full lg:max-w-sm">
                <span className="sr-only">Search runs</span>
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search workflow, branch, PR or actor"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-1 overflow-x-auto">
              {RUN_VIEW_OPTIONS.map((option) => {
                const count =
                  option.value === "all"
                    ? scopedRuns.length
                    : scopedRuns.filter((run) => runMatchesView(run, option.value)).length;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRunView(option.value)}
                    aria-pressed={runView === option.value}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      runView === option.value
                        ? "bg-slate-900 text-white"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    }`}
                  >
                    {option.label}
                    <span
                      className={`font-mono text-[10px] ${
                        runView === option.value ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {explorerRuns.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">
                      <th className="px-5 py-2.5">Run</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Branch</th>
                      <th className="hidden px-4 py-2.5 lg:table-cell">Actor</th>
                      <th className="px-4 py-2.5">Duration</th>
                      <th className="px-4 py-2.5">Updated</th>
                      <th className="w-10 px-4 py-2.5">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {explorerRuns.slice(0, visibleRunCount).map((run) => (
                      <RunTableRow
                        key={run.id}
                        run={run}
                        onSelectPr={(prNumber) => setPrFilter(String(prNumber))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {explorerRuns.slice(0, visibleRunCount).map((run) => (
                  <RunMobileRow
                    key={run.id}
                    run={run}
                    onSelectPr={(prNumber) => setPrFilter(String(prNumber))}
                  />
                ))}
              </div>

              <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:px-5">
                <p className="text-xs text-slate-500">
                  Showing {Math.min(visibleRunCount, explorerRuns.length)} of{" "}
                  {explorerRuns.length} runs
                </p>
                {visibleRunCount < explorerRuns.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleRunCount((count) => count + 25)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Load 25 more
                    <Icon name="chevron" className="size-3.5" />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="grid min-h-64 place-items-center px-6 py-10 text-center">
              <div>
                <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500">
                  <Icon name="search" className="size-5" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">No matching runs</p>
                <p className="mt-1 text-sm text-slate-500">
                  Try a different status, search term, period, or filter.
                </p>
                {(query || hasActiveFilters || runView !== "all") && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-3 text-xs font-semibold text-sky-700 hover:text-sky-800"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <footer className="flex flex-col justify-between gap-2 border-t border-slate-200 py-2 text-xs text-slate-400 sm:flex-row">
          <span>Data served from the Convex run cache with live updates.</span>
          <span>
            Duration reflects workflow elapsed time, not GitHub billed job-minutes.
          </span>
        </footer>
      </div>
    </main>
  );
}

function LoadingDashboard() {
  return (
    <main className="min-h-screen bg-[#f4f6f9] text-slate-950">
      <header className="h-16 bg-[#0b1220]" />
      <div className="h-14 border-b border-slate-200 bg-white" />
      <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-7 sm:px-6 lg:px-8">
        <div className="h-8 w-72 animate-pulse rounded-lg bg-slate-200" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white"
            />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.65fr_0.85fr]">
          <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  detail: string;
  tone: "positive" | "negative" | "warning" | "info" | "neutral";
}) {
  const tones = {
    positive: "bg-emerald-50 text-emerald-700",
    negative: "bg-rose-50 text-rose-700",
    warning: "bg-amber-50 text-amber-700",
    info: "bg-sky-50 text-sky-700",
    neutral: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/[0.04] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`grid size-9 place-items-center rounded-xl ${tones[tone]}`}>
          <Icon name={icon} className="size-4.5" />
        </div>
      </div>
      <p
        className={`mt-3 text-xs ${
          tone === "negative"
            ? "font-medium text-rose-600"
            : tone === "positive"
              ? "font-medium text-emerald-600"
              : "text-slate-500"
        }`}
      >
        {detail}
      </p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  icon,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: IconName;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-5">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          <Icon name={icon} className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.04]">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
      <div className="px-2 pb-3 pt-1 sm:px-4">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="grid h-[270px] place-items-center text-sm text-slate-400">
      No completed runs to chart.
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function RunTableRow({
  run,
  onSelectPr,
}: {
  run: ActionsRun;
  onSelectPr: (prNumber: number) => void;
}) {
  return (
    <tr className="group transition hover:bg-slate-50/80">
      <td className="max-w-md px-5 py-3">
        <a
          href={run.url}
          target="_blank"
          rel="noreferrer"
          className="block min-w-0"
        >
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${statusDotTone(run)}`} />
            <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-sky-700">
              {run.workflowName}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-slate-400">
              #{run.runNumber}
            </span>
          </div>
          <p
            className={`mt-0.5 truncate pl-4 text-xs ${
              isFailedRun(run) && run.failureSummary ? "text-rose-600" : "text-slate-500"
            }`}
          >
            {isFailedRun(run) && run.failureSummary
              ? extractFailureHeadline(run.failureSummary, run.name)
              : run.name}
          </p>
        </a>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(run)}`}
        >
          {statusLabel(run)}
        </span>
      </td>
      <td className="max-w-40 px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <Icon name="branch" className="size-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{run.branch}</span>
        </div>
        {run.prNumbers[0] && (
          <button
            type="button"
            onClick={() => onSelectPr(run.prNumbers[0])}
            className="mt-1 text-[10px] font-semibold text-sky-700 hover:text-sky-800"
          >
            PR #{run.prNumbers[0]}
          </button>
        )}
      </td>
      <td className="hidden max-w-36 truncate px-4 py-3 text-xs text-slate-500 lg:table-cell">
        {run.actor}
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-500">
        {formatDuration(run.durationMs)}
      </td>
      <td
        className="whitespace-nowrap px-4 py-3 text-xs text-slate-500"
        title={formatTime(run.updatedAt)}
      >
        {formatRelativeTime(run.updatedAt)}
      </td>
      <td className="px-4 py-3">
        <a
          href={run.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${run.workflowName} run ${run.runNumber}`}
          className="grid size-7 place-items-center rounded-lg text-slate-300 transition group-hover:bg-white group-hover:text-sky-700 group-hover:shadow-sm"
        >
          <Icon name="arrow-up-right" className="size-3.5" />
        </a>
      </td>
    </tr>
  );
}

function RunMobileRow({
  run,
  onSelectPr,
}: {
  run: ActionsRun;
  onSelectPr: (prNumber: number) => void;
}) {
  return (
    <article className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <a href={run.url} target="_blank" rel="noreferrer" className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {run.workflowName}
            <span className="ml-1.5 font-mono text-[11px] font-medium text-slate-400">
              #{run.runNumber}
            </span>
          </p>
          <p
            className={`mt-1 line-clamp-2 text-xs leading-5 ${
              isFailedRun(run) && run.failureSummary ? "text-rose-600" : "text-slate-500"
            }`}
          >
            {isFailedRun(run) && run.failureSummary
              ? extractFailureHeadline(run.failureSummary, run.name)
              : run.name}
          </p>
        </a>
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(run)}`}
        >
          {statusLabel(run)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="flex min-w-0 items-center gap-1">
          <Icon name="branch" className="size-3.5 shrink-0" />
          <span className="max-w-40 truncate">{run.branch}</span>
        </span>
        <span>{run.actor}</span>
        <span>{formatDuration(run.durationMs)}</span>
        <span>{formatRelativeTime(run.updatedAt)}</span>
        {run.prNumbers[0] && (
          <button
            type="button"
            onClick={() => onSelectPr(run.prNumbers[0])}
            className="font-semibold text-sky-700"
          >
            PR #{run.prNumbers[0]}
          </button>
        )}
      </div>
    </article>
  );
}

function ReliabilityTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const successRate = payload.find((item) => item.dataKey === "successRate")?.value ?? 0;
  const failed = payload.find((item) => item.dataKey === "failed")?.value ?? 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl shadow-slate-950/10">
      <p className="font-semibold text-slate-900">{formatShortDate(String(label))}</p>
      <p className="mt-1 text-sky-700">{successRate}% success</p>
      <p className="text-rose-600">
        {failed} failed run{failed === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function DurationTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="max-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl shadow-slate-950/10">
      <p className="truncate font-semibold text-slate-900">{label}</p>
      <p className="mt-1 text-slate-600">
        Median {formatDuration((payload[0]?.value ?? 0) * 60_000)}
      </p>
    </div>
  );
}

function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    activity: (
      <path d="M4 12h3l2-7 4 14 2-7h5" />
    ),
    "arrow-up-right": (
      <>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </>
    ),
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10M8 8c4 0 3-2 8-2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    filter: <path d="M4 6h16M7 12h10M10 18h4" />,
    pulse: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M7 12h2l1.5-4 3 8 1.5-4h2" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    warning: (
      <>
        <path d="M10.3 4.2 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    workflow: (
      <>
        <rect x="3" y="4" width="6" height="6" rx="2" />
        <rect x="15" y="14" width="6" height="6" rx="2" />
        <path d="M9 7h3a4 4 0 0 1 4 4v3M6 10v4a3 3 0 0 0 3 3h6" />
      </>
    ),
    x: <path d="m7 7 10 10M17 7 7 17" />,
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}

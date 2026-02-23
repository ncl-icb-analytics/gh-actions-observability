"use client";

import { useEffect, useMemo, useState } from "react";
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

const refreshMs = 60_000;
const EMPTY_RUNS: ActionsRun[] = [];
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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

export function ActionsDashboard() {
  const [data, setData] = useState<ActionsHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [prFilter, setPrFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("30d");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const params = new URLSearchParams({
          maxRuns: "1500",
          detailsLimit: "160",
        });
        const since = getPeriodSinceIso(periodFilter);
        if (since) {
          params.set("since", since);
        }

        const response = await fetch(`/api/history?${params.toString()}`, { cache: "no-store" });
        const json = (await response.json()) as ActionsHistoryResponse | { error: string };

        if (!response.ok || "error" in json) {
          throw new Error("error" in json ? json.error : "Unable to load history");
        }

        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, refreshMs);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [periodFilter]);

  const runs = data?.runs ?? EMPTY_RUNS;
  const periodEnd = useMemo(
    () => (data?.generatedAt ? new Date(data.generatedAt) : new Date()),
    [data?.generatedAt],
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

  useEffect(() => {
    if (workflowFilter !== "all" && !workflowOptions.includes(workflowFilter)) {
      setWorkflowFilter("all");
    }
  }, [workflowFilter, workflowOptions]);

  useEffect(() => {
    if (branchFilter !== "all" && !branchOptions.includes(branchFilter)) {
      setBranchFilter("all");
    }
  }, [branchFilter, branchOptions]);

  useEffect(() => {
    if (prFilter !== "all" && !prOptions.includes(Number(prFilter))) {
      setPrFilter("all");
    }
  }, [prFilter, prOptions]);

  const filteredRuns = useMemo(() => {
    const selectedPr = prFilter === "all" ? null : Number(prFilter);
    const normalizedQuery = query.trim().toLowerCase();

    return runsInPeriod.filter((run) => {
      if (workflowFilter !== "all" && run.workflowName !== workflowFilter) {
        return false;
      }

      if (branchFilter !== "all" && run.branch !== branchFilter) {
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
  }, [runsInPeriod, workflowFilter, branchFilter, prFilter, query]);

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
        minutes: Number((run.durationMs / 60_000).toFixed(2)),
      }));
  }, [filteredRuns]);

  const workflowData = useMemo(() => {
    const map = new Map<string, { workflow: string; success: number; failed: number }>();

    for (const run of filteredRuns) {
      if (run.status !== "completed") {
        continue;
      }
      const current = map.get(run.workflowName) ?? { workflow: run.workflowName, success: 0, failed: 0 };
      if (run.conclusion === "success") {
        current.success += 1;
      } else {
        current.failed += 1;
      }
      map.set(run.workflowName, current);
    }

    return Array.from(map.values())
      .sort((a, b) => b.success + b.failed - (a.success + a.failed))
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
    <main className="min-h-screen bg-[radial-gradient(1200px_500px_at_20%_0%,#dbeafe_0%,#f8fafc_60%)] px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-lg shadow-slate-900/5 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">GitHub Actions Observability</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{data ? `${data.owner}/${data.repo}` : "Repository"}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Polling every {Math.round(refreshMs / 1000)}s. Last refresh: {data ? formatTime(data.generatedAt) : "-"}
          </p>
          <p className="mt-1 text-sm text-slate-600">Reporting period: {reportingPeriodLabel}</p>
        </header>

        {error && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
            {error}
            <div className="mt-1 text-sm">Set `GITHUB_TOKEN` and repository env vars before loading this dashboard.</div>
          </section>
        )}

        <section className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-lg shadow-slate-900/5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Focus History</h2>
            <button
              type="button"
              onClick={() => {
                setWorkflowFilter("all");
                setBranchFilter("all");
                setPrFilter("all");
                setQuery("");
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear filters
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
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
              Workflow (Action)
              <select
                value={workflowFilter}
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
                value={branchFilter}
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
                value={prFilter}
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

            <label className="space-y-1 text-xs text-slate-600">
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="workflow, branch, run #, actor"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
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
        </section>

        {!hasRunsInPeriod && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            No actions ran in the selected reporting period.
          </section>
        )}

        {hasRunsInPeriod && !hasVisibleRuns && (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
            No runs match the current branch/workflow/PR/search filters in this period.
          </section>
        )}

        {hasVisibleRuns && (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <MetricCard label="Visible Runs" value={summary.total} />
              <MetricCard label="Success Rate" value={`${summary.successRate}%`} />
              <MetricCard label="Failures" value={summary.failed} />
              <MetricCard label="Total Minutes (Est.)" value={formatMinutes(summary.totalDurationMs)} />
            </section>
            <p className="text-xs text-slate-500">
              `Total Minutes (Est.)` uses workflow run durations. GitHub Usage Metrics reports billed job-minutes, so values will differ.
            </p>

            <section className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Run Duration Trend" className="lg:col-span-2">
                <ResponsiveContainer width="100%" height={260}>
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
                    <YAxis tick={{ fontSize: 11 }} unit="m" />
                    <Tooltip
                      formatter={(value) => `${value ?? 0} min`}
                      labelFormatter={(value, payload) => {
                        const row = payload?.[0]?.payload as
                          | { runNumber?: number; workflowName?: string }
                          | undefined;
                        const runLabel = row?.runNumber ? `Run #${row.runNumber}` : "Run";
                        const workflowLabel = row?.workflowName ? ` - ${row.workflowName}` : "";
                        return `${formatTime(new Date(Number(value)).toISOString())} (${runLabel}${workflowLabel})`;
                      }}
                    />
                    <Line dataKey="minutes" type="linear" stroke="#0284c7" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Outcome Split">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Tooltip />
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section>
              <ChartCard title="Actions Minutes by Day (Estimated)">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={minutesByDayData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="m" />
                    <Tooltip formatter={(value) => `${value ?? 0} min`} />
                    <Bar dataKey="minutes" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section>
              <ChartCard title="Workflow Reliability (Filtered)">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={workflowData} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="workflow" width={170} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="success" stackId="a" fill="#10b981" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="failed" stackId="a" fill="#f43f5e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section className="rounded-2xl border border-white/70 bg-white/85 p-5 shadow-lg shadow-slate-900/5 backdrop-blur">
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
                    <article key={run.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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

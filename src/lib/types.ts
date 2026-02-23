export type RunStatus = "queued" | "in_progress" | "completed";

export type RunConclusion =
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

export type ActionsRun = {
  id: number;
  name: string;
  workflowName: string;
  branch: string;
  event: string;
  status: RunStatus;
  conclusion: RunConclusion;
  url: string;
  actor: string;
  runNumber: number;
  prNumbers: number[];
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  durationMs: number;
  failureSummary: string | null;
  failurePoints: string[];
};

export type ActionsHistoryResponse = {
  owner: string;
  repo: string;
  generatedAt: string;
  runs: ActionsRun[];
};

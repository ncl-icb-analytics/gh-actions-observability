import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep Convex cache warm; sync incremental GitHub Actions history.
crons.interval(
  "sync-github-actions-history",
  { minutes: 1 },
  internal.history.syncGithubInternal,
  {
    maxRuns: 300,
    detailsLimit: 50,
    minIntervalMs: 55_000,
  },
);

export default crons;

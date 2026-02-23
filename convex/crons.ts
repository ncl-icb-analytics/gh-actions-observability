import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Keep Convex cache warm; sync incremental GitHub Actions history.
crons.interval(
  "sync-github-actions-history",
  { minutes: 1 },
  api.history.syncGithub,
  {
    maxRuns: 300,
    detailsLimit: 50,
    minIntervalMs: 55_000,
  },
);

export default crons;

import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Keep Convex cache warm; sync incremental GitHub Actions history.
crons.interval(
  "sync-github-actions-history",
  { minutes: 5 },
  api.history.syncGithub,
  {
    maxRuns: 1200,
    detailsLimit: 80,
    minIntervalMs: 240_000,
  },
);

export default crons;

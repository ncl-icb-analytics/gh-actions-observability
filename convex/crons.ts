import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
const syncGithubAction = makeFunctionReference<"action">("history:syncGithub");

// Keep Convex cache warm; sync incremental GitHub Actions history.
crons.interval(
  "sync-github-actions-history",
  { minutes: 1 },
  syncGithubAction,
  {
    maxRuns: 300,
    detailsLimit: 50,
    minIntervalMs: 55_000,
  },
);

export default crons;

# GitHub Actions Observability

A Next.js dashboard for GitHub Actions reliability and failure diagnostics, backed by Convex for cached historical data.

## Architecture

The app uses a cache-first architecture to reduce GitHub API pressure and improve UI responsiveness.

- Frontend: Next.js App Router + React + Recharts
- API facade: `GET /api/history` in Next.js
- Data store + sync engine: Convex
- Source of truth for run ingestion: GitHub Actions REST API

### Data flow

1. Convex cron (`convex/crons.ts`) runs every 5 minutes.
2. Cron executes `history:syncGithub` (Convex action).
3. Sync action fetches incremental run history from GitHub and upserts into Convex tables.
4. Sync enriches failed runs with job/log-derived failure summaries.
5. Next.js route `/api/history` reads from Convex cache (`history:getHistory`) and returns dashboard payload.
6. Dashboard polls `/api/history` every 5 minutes.

This means user requests do not directly call GitHub APIs.

## Key components

- Next API route: `src/app/api/history/route.ts`
  - Reads from Convex via `ConvexHttpClient`
- Dashboard UI: `src/components/actions-dashboard.tsx`
  - Filtering, charts, failure-first UX
- Convex schema: `convex/schema.ts`
  - `runs`, `syncState`
- Convex sync logic: `convex/history.ts`
  - GitHub fetch, parsing, incremental upsert, failure summarization
- Convex internal db helpers: `convex/internalHistory.ts`
- Convex schedule: `convex/crons.ts`

## Environment variables

### Next.js / Vercel

- `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL` locally)
  - Convex deployment URL used by `/api/history`

### Convex deployment

Set in Convex env (`bunx convex env set --prod ...`):

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `TEAMS_WEBHOOK_URL` (optional; enables alert posting)
- `TEAMS_ALERT_WORKFLOWS` (optional CSV, e.g. `dbt Deploy to Production,dbt PR Validation`)

## Local development (Bun)

1. Install deps:

```bash
bun install
```

2. Start Convex local dev deployment:

```bash
bunx convex dev --typecheck disable
```

3. Start Next.js:

```bash
bunx next dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Deployment

### Convex production

```bash
bunx convex deploy -y --typecheck disable
bunx convex env set --prod GITHUB_TOKEN <token>
bunx convex env set --prod GITHUB_OWNER <owner>
bunx convex env set --prod GITHUB_REPO <repo>
bunx convex env set --prod TEAMS_WEBHOOK_URL <teams-webhook-url>
bunx convex env set --prod TEAMS_ALERT_WORKFLOWS "dbt Deploy to Production"
```

Optional initial backfill:

```bash
bunx convex run --prod history:syncGithub '{"since":"2026-01-01T00:00:00.000Z","maxRuns":1200,"detailsLimit":80,"minIntervalMs":0}'
```

### Vercel

Set `CONVEX_URL` for `development`, `preview`, and `production` to your Convex prod URL.

## Teams alert setup

This repository now supports sending Teams alerts directly from Convex sync.

1. In Teams, open the destination channel.
2. Create a workflow using the trigger `When a Teams webhook request is received`.
3. Add a `Post message in a chat or channel` action to the same channel.
4. In the message template, map fields from the webhook payload:
   - `workflow`, `runNumber`, `repository`, `branch`, `actor`, `summary`, `runUrl`
5. Copy the generated webhook URL.
6. Set `TEAMS_WEBHOOK_URL` in Convex prod env.
7. Optionally set `TEAMS_ALERT_WORKFLOWS` CSV to restrict which workflows send alerts.

Payload shape sent by Convex:

```json
{
  "repository": "owner/repo",
  "workflow": "dbt Deploy to Production",
  "runNumber": 43,
  "runId": 123456789,
  "runUrl": "https://github.com/owner/repo/actions/runs/123456789",
  "status": "failure",
  "actor": "octocat",
  "branch": "main",
  "event": "push",
  "summary": "Deploy Changed Models + Downstream: ...",
  "points": ["Deploy Changed Models + Downstream: Error ..."],
  "occurredAt": "2026-02-23T03:11:00Z"
}
```

Alert deduplication is by run ID + channel, so each failed run sends one Teams alert.

## Notes on metrics

- `Total Minutes (Est.)` is computed from workflow run durations in cached run data.
- GitHub Usage Metrics uses billed job-minutes, so values may differ.

## Troubleshooting

### Convex dashboard "Connection Issue" (local)

If using local deployment, ensure Convex is running:

```bash
bunx convex dev --typecheck disable
```

### Empty data after deploy

- Check Convex env vars (`bunx convex env list --prod`)
- Trigger one manual sync (`bunx convex run --prod history:syncGithub ...`)
- Verify `CONVEX_URL` in Vercel project env

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

User requests do not call GitHub APIs directly.

## Key components

- Next API route: `src/app/api/history/route.ts`
- Dashboard UI: `src/components/actions-dashboard.tsx`
- Convex schema: `convex/schema.ts` (`runs`, `syncState`)
- Convex sync logic: `convex/history.ts`
- Convex internal db helpers: `convex/internalHistory.ts`
- Convex schedule: `convex/crons.ts`

## Environment variables

### Next.js / Vercel

- `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL` locally)

### Convex deployment

Set in Convex env (`bunx convex env set --prod ...`):

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

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
```

Optional initial backfill:

```bash
bunx convex run --prod history:syncGithub '{"since":"2026-01-01T00:00:00.000Z","maxRuns":1200,"detailsLimit":80,"minIntervalMs":0}'
```

### Vercel

Set `CONVEX_URL` for `development`, `preview`, and `production` to your Convex prod URL.

## Teams notifications

Teams notifications are handled via the GitHub Notifications app in Teams (not custom app endpoints in this repo).

Example subscriptions:

```text
@GitHub Notifications subscribe ncl-icb-analytics/dbt-ncl-analytics workflows:{name:"dbt Deploy to Production",event:"push",branch:"main"}
@GitHub Notifications subscribe ncl-icb-analytics/dbt-ncl-analytics commits:main
```

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

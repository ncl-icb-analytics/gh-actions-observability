# AGENTS.md

## Purpose

Operational architecture notes for humans and coding agents working in this repository.

## System overview

This project is a GitHub Actions observability dashboard with Convex-backed caching.

- Presentation: Next.js (`src/app`, `src/components`)
- Backend facade: Next API route `src/app/api/history/route.ts`
- Persistent cache + ingestion engine: Convex (`convex/`)
- Upstream provider: GitHub Actions REST API

The request path should read from Convex cache, not call GitHub directly.

## Data model

Defined in `convex/schema.ts`:

- `runs`
  - canonical run facts (workflow, branch, status, conclusion, actor, duration)
  - parsed failure diagnostics (`failureSummary`, `failurePoints`)
  - indexes:
    - `by_run_id`
    - `by_updated_at_ms`
- `syncState`
  - sync cursor and health metadata per repo
  - index:
    - `by_key`
- `alertsSent`
  - tracks deduplicated outbound notifications
  - current channel support: `teams`
  - index:
    - `by_run_id`

## Sync behavior

- Cron schedule: `convex/crons.ts`
  - interval: every 5 minutes
  - job: `api.history.syncGithub`
- Sync implementation: `convex/history.ts`
  - incremental fetch via `since`/cursor window
  - max runs per sync capped for API safety
  - failed runs enriched via jobs/log parsing
  - optional Teams notifications for selected failed workflows
  - upsert through internal mutations in `convex/internalHistory.ts`

## Request behavior

- Dashboard calls `GET /api/history`
- Route loads from Convex query `history:getHistory`
- No direct GitHub API calls from this route
- Teams pull API routes:
  - `GET|POST /api/teams/notifications` -> `alerts:getPendingTeamsFailures`
  - `POST /api/teams/ack` -> `alerts:acknowledgeTeamsFailures`

## Environment contracts

### Convex env

Required for sync action:

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `TEAMS_WEBHOOK_URL` (optional)
- `TEAMS_ALERT_WORKFLOWS` (optional CSV workflow-name allowlist)

### Next/Vercel env

Required for API route:

- `CONVEX_URL` (preferred in hosted env)
- `NEXT_PUBLIC_CONVEX_URL` (used in local workflows)
- `TEAMS_PULL_TOKEN` (optional shared secret for Teams pull endpoints)

## Local workflow (Bun-first)

- Install: `bun install`
- Start Convex local deployment: `bunx convex dev --typecheck disable`
- Start Next app: `bunx next dev`

## Production workflow

1. Deploy Convex code:
   - `bunx convex deploy -y --typecheck disable`
2. Ensure Convex prod env vars are set.
3. Ensure Vercel `CONVEX_URL` points to Convex prod URL.
4. Push to `main` to trigger Vercel deploy.

## Guardrails

- Do not commit credentials from `.env.local`.
- Avoid increasing sync frequency below 5 minutes without rate-limit analysis.
- Keep failure parsing deterministic and concise; avoid full-log storage.
- Preserve filter + failure-first UX in dashboard edits.
- Keep Teams alerting idempotent using `alertsSent`; do not send duplicate alerts for same run.

## Validation checklist

Before shipping:

- `npm run lint`
- `npm run build`
- `GET /api/history` returns populated data
- Convex cron and manual `history:syncGithub` run successfully

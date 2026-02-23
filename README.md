# GitHub Actions Observability

A Next.js dashboard that polls your GitHub Actions history, visualizes reliability trends, and shows per-run failure summaries.

## Features

- Auto-refreshes workflow run history every 60 seconds
- Success/failure split, duration trend, and workflow reliability charts
- Recent runs list with run metadata and links to GitHub
- Failure summaries based on failed jobs and failed steps for each non-successful completed run

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env.local
```

Set:
- `GITHUB_TOKEN` (PAT with repo read permissions)
- `GITHUB_OWNER` + `GITHUB_REPO` or `GITHUB_REPOSITORY=owner/repo`

3. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API

The dashboard calls `GET /api/history?limit=50`, which:
- Reads run history from GitHub Actions API
- Pulls job/step details for non-success completed runs
- Derives a concise failure summary per run

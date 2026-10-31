# ReachInbox Email Job Scheduler

A production-style email scheduler: a React dashboard and an Express API that schedule bulk emails for a future
time, send them through a BullMQ worker with per-sender hourly limits, and survive restarts without losing or
duplicating a single email. There is no cron and no `setInterval` anywhere: every delay is a BullMQ delayed job.

- **Backend:** TypeScript, Express, BullMQ, Redis (AOF), PostgreSQL, Nodemailer + Ethereal, Elasticsearch, Bull Board
- **Frontend:** React 18, Vite, Tailwind, TipTap, TanStack Query
- **Auth and alerts:** real Google OAuth login, real Slack OAuth (incoming webhook) rate-limit alerts
- **Infra:** Docker Compose (Postgres 16, Redis 7, Elasticsearch 8)

## Contents

1. [Quick start](#quick-start)
2. [Features mapped to the requirements](#features-mapped-to-the-requirements)
3. [Architecture](#architecture)
4. [How scheduling works](#how-scheduling-works)
5. [Persistence on restart, and no duplicates](#persistence-on-restart-and-no-duplicates)
6. [Rate limiting and concurrency](#rate-limiting-and-concurrency)
7. [Configuration](#configuration)
8. [Google and Slack setup](#google-and-slack-setup)
9. [Trying it end to end](#trying-it-end-to-end)
10. [Deploying to the web](#deploying-to-the-web)
11. [Tests and load test](#tests-and-load-test)
12. [Assumptions and trade-offs](#assumptions-and-trade-offs)
13. [Project layout](#project-layout)

## Quick start

Prerequisites: Node 20+, Docker.

```bash
cp .env.example .env                  # fill in JWT_SECRET and the Google/Slack credentials (see below)
docker compose up -d                  # Postgres (5432), Redis with AOF (host port 6380), Elasticsearch (9200)

cd backend && npm install
npm run migrate                       # applies db/migrations/*.sql
npm run dev                           # API + worker in one process (RUN_WORKER_IN_API=true)

cd ../frontend && npm install
cp .env.example .env                  # VITE_API_URL=http://localhost:4000
npm run dev                           # http://localhost:5173
```

Redis is published on host port **6380** so it does not collide with a local Redis on 6379.
`npm run start:worker` runs the worker on its own (after `npm run build`); set `RUN_WORKER_IN_API=false` for the API.

Login needs real Google credentials (next sections). Email is sent through Ethereal, a fake SMTP service: nothing
reaches a real inbox, and every sent email has a preview link in the dashboard.

## Features mapped to the requirements

| Requirement | Where it lives |
|---|---|
| Schedule emails for a future time | `POST /api/campaigns` creates one `emails` row and one BullMQ delayed job per recipient. UI: Compose, Send Later. |
| BullMQ + Redis, no cron | `backend/src/scheduler/queue.ts`, `worker.ts`. Delays are `delay:` on jobs and `moveToDelayed` in the worker. |
| Persistent across restarts, no duplicates | Postgres is the source of truth, Redis runs with AOF, a boot reconciler re-enqueues missing jobs, and sends are claimed atomically. See below. |
| Idempotent sends | `jobId = email id`, plus an atomic `UPDATE ... WHERE status='scheduled' RETURNING` claim before sending. |
| Configurable worker concurrency | `WORKER_CONCURRENCY` (default 5). |
| Minimum delay between emails | Per-campaign "Delay between 2 emails" and the global `MIN_DELAY_BETWEEN_EMAILS_MS`, enforced per sender. |
| Hourly rate limit per sender | Redis Lua limiter, per campaign "Hourly Limit" capped by `MAX_EMAILS_PER_HOUR_PER_SENDER`. Excess emails are rescheduled to the next hour, not dropped. |
| Multiple senders | Every user gets Ethereal sender accounts; a campaign rotates across them or uses one chosen in "From". |
| Google login | Real OAuth 2.0 authorization-code flow, httpOnly JWT session cookie. |
| Slack alerts | Real Slack OAuth with the `incoming-webhook` scope; a message is posted when a sender hits its hourly limit. |
| Scheduled and Sent dashboards | Two list pages with live counts, status chips, polling every 3 seconds. |
| Search | Elasticsearch with an automatic SQL fallback, plus status and sender filters. |
| Rich-text body, attachments, CSV import | TipTap editor (sanitized HTML plus a text alternative), up to 3 attachments, "Upload List" CSV. |
| Queue visibility | Bull Board at `/admin/queues` (login required), `GET /api/queue/counts`. |
| Demo-friendly logs | One readable log line per event: `scheduled for`, `SENT ... via`, `RATE LIMIT ... rescheduled`, `SLACK alert sent`. |

## Architecture

```
 Browser (React) ──cookie──▶ Express API ──▶ PostgreSQL  (source of truth: campaigns, emails, senders, users)
                               │  ▲                ▲
                               │  │ enqueue        │ claim / mark sent / reschedule
                               ▼  │                │
                             BullMQ queue ──▶ Worker (same process or separate)
                             (Redis, AOF)        │ rate limiter (Lua) + per-sender gate (Redis)
                                                 ├──▶ Nodemailer ──▶ Ethereal SMTP
                                                 ├──▶ Slack incoming webhook (rate-limit alert)
                                                 └──▶ Elasticsearch (best-effort index)
```

Responsibilities are split on purpose:

- **PostgreSQL decides what is true.** Every email has a status (`scheduled`, `processing`, `sent`, `failed`), a
  `scheduled_at`, attempts, and the Ethereal preview URL.
- **Redis decides when it runs.** BullMQ holds the delayed jobs; losing Redis loses timing, never data, because the
  boot reconciler rebuilds the queue from Postgres.
- **The worker never trusts the queue.** A job is only a hint that an email is due. The worker re-reads the row and
  claims it atomically before doing anything.

## How scheduling works

1. `POST /api/campaigns` validates the body (zod), sanitizes the HTML with `sanitize-html`, and in one Postgres
   transaction inserts the campaign and one row per recipient. Recipient `i` is due at
   `startTime + i * delayBetweenMs`, and senders are assigned round-robin.
2. After the commit, each email is added to BullMQ with `delay = scheduled_at - now` and `jobId = email.id`.
3. When a job becomes due the worker, in order:
   1. **Claims** the row (`scheduled` to `processing`) with a single conditional `UPDATE`. If it matches no row
      (already sent, cancelled, or claimed by another worker) the job exits quietly.
   2. Consumes one slot from the **hourly limiter**. If the sender's limit is reached the email is rescheduled
      (see below).
   3. Checks the **per-sender gate** (`SET key NX PX minDelay`). If the sender sent too recently, the hourly slot is
      refunded, the row is released back to `scheduled`, and the job is moved back to delayed with `moveToDelayed`
      and `DelayedError`. The worker never sleeps and holds no concurrency slot while waiting.
   4. Sends through Nodemailer (HTML plus text alternative plus attachments), then marks the row `sent` and stores
      the Ethereal preview URL.
4. A failing send is retried by BullMQ with exponential backoff (`EMAIL_JOB_ATTEMPTS`, `EMAIL_JOB_BACKOFF_MS`); after the
   last attempt the row becomes `failed` with the error text.

A user can cancel a scheduled email from its detail page. Cancel is an atomic `DELETE ... WHERE status='scheduled'`, so
it can never race with a send: exactly one of "cancelled" and "claimed" wins (covered by a test that races them).

## Persistence on restart, and no duplicates

| Failure | What happens |
|---|---|
| API or worker killed (`kill -9`) while emails are delayed | Delayed jobs live in Redis (AOF, `appendfsync everysec`). On boot the process resumes and sends them on time. |
| Killed in the middle of a send | The row is left `processing`. After `STALE_PROCESSING_MS` another worker takes the claim over; until then the job is deferred, not dropped. |
| Redis data lost | The boot reconciler (`scheduler/reconcile.ts`) finds `scheduled` rows with no job and re-enqueues them, and resets stale `processing` claims. |
| Same job delivered twice | The claim `UPDATE ... RETURNING` lets exactly one caller proceed. Tested with 25 parallel claims. |
| Same email enqueued twice | `jobId = email id` makes the second `add` a no-op. |

Recovery was exercised for real, not only in unit tests: `kill -9` with 20 emails pending, a Redis wipe, and a
1000-email load test, each ending with SQL counts that add up (nothing lost, nothing sent twice).

The one honest edge: if the process dies after SMTP accepted a message but before the row is marked `sent`, the claim
eventually goes stale and the email is sent again. Exactly-once delivery across an SMTP server and a database is not
possible without the provider's cooperation; this design chooses at-least-once with a very small window over losing mail.

## Rate limiting and concurrency

- **Window.** The hourly window is `floor(epochMs / 3_600_000)` in UTC, so every process agrees on it without coordination.
- **Limiter.** A Lua script (`INCR` plus `EXPIRE`, and `DECR` when the limit is exceeded) runs atomically in Redis, so
  concurrent workers cannot overshoot the limit. The effective limit is `min(campaign hourly limit, MAX_EMAILS_PER_HOUR_PER_SENDER)`.
- **When the limit is hit.** The email is not failed and not slept on. Its `scheduled_at` moves to the start of the
  next window (or later, ranked by position among the same campaign and sender so order is preserved and a later
  window is not overfilled), the job is re-delayed, and the row stays `scheduled`.
- **Spacing.** The campaign's "Delay between 2 emails" sets each email's `scheduled_at` (`startTime + i * delay`).
  On top of that, a per-sender gate enforces `MIN_DELAY_BETWEEN_EMAILS_MS` between two sends of the same sender,
  across all workers. A gate deferral refunds the hourly slot, so it never burns the limit. Different senders are
  independent, so throughput scales with the number of senders.
- **Concurrency.** `WORKER_CONCURRENCY` jobs run in parallel in one worker; you can also run several worker processes,
  because every shared decision (claim, gate, limiter) is atomic in Postgres or Redis.
- **Slack alert.** When a sender is limited, one message is posted per sender per hour window (deduped in Redis with
  `slack-notified:{sender}:{window}`). It is only claimed if the user has Slack connected, so connecting mid-window
  still gets the next alert.

## Configuration

Everything comes from environment variables, validated with zod at startup (a bad value exits with a readable list).

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND_URL` | `http://localhost:4000` | Public URL of the API. OAuth redirect URIs are built from it. |
| `FRONTEND_URL` | `http://localhost:5173` | Where users land after login, and the CORS origin. |
| `JWT_SECRET` | (required, 32+ chars) | Signs session cookies and OAuth state. |
| `DATABASE_URL`, `REDIS_URL` | see `.env.example` | Postgres and Redis. |
| `ELASTICSEARCH_URL` | `http://127.0.0.1:9200` | Leave empty to run without Elasticsearch (search falls back to SQL). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | Google OAuth web client. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | empty | Slack app credentials. |
| `WORKER_CONCURRENCY` | 5 | Parallel jobs per worker. |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | 2000 | Minimum gap between two sends of the same sender. |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 200 | Hard ceiling for any campaign's hourly limit. |
| `EMAIL_JOB_ATTEMPTS`, `EMAIL_JOB_BACKOFF_MS` | 3, 5000 | Retry policy. |
| `STALE_PROCESSING_MS` | 120000 | When a `processing` claim is considered abandoned. |
| `MAX_RECIPIENTS_PER_CAMPAIGN` | 5000 | Upper bound per campaign. |
| `RUN_WORKER_IN_API` | `true` | Run the worker inside the API process. |
| `DEFAULT_SENDER_COUNT` | 3 | Ethereal senders created per new user. |

## Google and Slack setup

Both flows are real OAuth authorization-code flows; nothing is mocked. Slack refuses plain-HTTP redirect URLs, so for
local development expose the app with a tunnel and use **one public HTTPS URL for both the app and the API**. The
session cookie belongs to a single host, and Vite proxies `/api` and `/admin` to the backend.

```bash
ngrok http 5173            # or: cloudflared tunnel --url http://localhost:5173
```

Then set, using the HTTPS URL the tunnel prints:

- root `.env`: `BACKEND_URL=https://<tunnel>` and `FRONTEND_URL=https://<tunnel>`
- `frontend/.env`: `VITE_API_URL=` (empty, so the browser calls the API on the same origin)

Restart the backend and the frontend dev server. The dev server already allows `*.ngrok-free.dev`, `*.ngrok-free.app`
and `*.trycloudflare.com` hosts (`frontend/vite.config.ts`).

### Google

1. [Create a project](https://console.cloud.google.com/projectcreate), then configure the
   [Branding page](https://console.cloud.google.com/auth/branding) (External, app name, your email).
2. On the [Audience page](https://console.cloud.google.com/auth/audience) keep the app in *Testing* and add your Google
   account under **Test users**.
3. On [Clients](https://console.cloud.google.com/auth/clients) create an OAuth client of type **Web application** and
   add the redirect URI `https://<tunnel>/api/auth/google/callback` (and `http://localhost:4000/api/auth/google/callback`
   if you also run without a tunnel).
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Slack

1. At <https://api.slack.com/apps> choose **Create an App**, then **From a manifest**, pick the JSON tab and paste
   (replace `<tunnel>`):

   ```json
   {
     "display_information": { "name": "ReachInbox Alerts" },
     "features": { "bot_user": { "display_name": "ReachInbox Alerts", "always_online": false } },
     "oauth_config": {
       "redirect_urls": ["https://<tunnel>/api/slack/callback"],
       "scopes": { "bot": ["incoming-webhook"] }
     },
     "settings": { "org_deploy_enabled": false, "socket_mode_enabled": false, "token_rotation_enabled": false }
   }
   ```

2. Under **Basic Information > App Credentials** copy the client ID and secret into `SLACK_CLIENT_ID` and
   `SLACK_CLIENT_SECRET`. Only these two are used; the bot and app tokens Slack also shows are not needed.
3. In the app, open the user menu and click **Connect Slack**, choose a channel and allow.

How the integrations behave:

- **Login.** `GET /api/auth/google` redirects to Google with a signed `state` (also kept in a 10 minute httpOnly cookie).
  The callback verifies it, exchanges the code, upserts the user by Google id, creates the user's Ethereal senders and sets
  a 7 day httpOnly `SameSite=Lax` session cookie (`Secure` in production). Every `/api` route except `/api/auth/*` and the
  Slack callback requires it, as does `/admin/queues`. `/health` is public. State and session tokens carry a `purpose`
  claim, so one kind cannot be replayed as another.
- **Slack.** The webhook is stored per user and looked up when an alert fires, so connecting later works without a
  redeploy and a user without a connection simply gets no alert. A webhook Slack reports as gone (404/410) is removed.
  Alerts have a 5 second timeout and can never break sending.
- **Search.** `GET /api/search?q=&status=&senderId=&page=&limit=` uses Elasticsearch and falls back to SQL `ILIKE` if it is
  unconfigured or down; the response says which answered (`source`). Indexing is fire-and-forget behind a circuit breaker, so an
  Elasticsearch outage never blocks sending. `POST /api/search/reindex` rebuilds the caller's documents from Postgres.

## Trying it end to end

1. Log in with Google. A new account gets 3 Ethereal senders.
2. **Compose**: paste a few addresses (or use *Upload List* with a CSV), a subject and a body. Set *Delay between 2 emails* and
   *Hourly Limit* (for example `2` and `2`), then **Send**, or pick a time with the clock icon (*Send Later*).
3. **Scheduled** shows the queue with each email's exact send time; emails move to **Sent** live, each with an Ethereal preview link.
4. **Rate limit demo.** With 3 senders and a limit of 2, send 8 emails: 6 go out, 2 are rescheduled to the next hour and the
   backend logs `RATE LIMIT ... rescheduled`. If Slack is connected, one alert per limited sender arrives in the channel.
5. **Restart demo.** Schedule a campaign a few minutes ahead, `kill -9` the backend, start it again: the log prints
   `Reconciled N scheduled emails`, and the emails still go out at their scheduled times.
6. **Search and queue.** Use the search bar and filter popover, open `/admin/queues`, or call `GET /api/queue/counts`.
7. **Elasticsearch outage.** `docker compose stop elasticsearch`: sending continues and search answers from SQL
   (`"source":"sql"`); start it again and `POST /api/search/reindex`.

Sample demo log lines:

```
Job <id> scheduled for 2026-10-31T00:54:14.553Z
SENT a1@example.com via yrn6mm3ae2l4ae6x@ethereal.email
RATE LIMIT sender=<id> window=498168 rescheduled a7@example.com to 2026-10-31T01:00:00.000Z
SLACK alert sent for yrn6mm3ae2l4ae6x@ethereal.email
```

## Deploying to the web

The repo ships a `Dockerfile` and a Render Blueprint (`render.yaml`). One container runs the API, the worker and the built
frontend, so the browser talks to a single origin and the `SameSite=Lax` session cookie works. Postgres and Redis are managed
services. Elasticsearch is left out; search falls back to SQL.

1. Push the repo to GitHub, then in Render choose **New > Blueprint** and select it. Render creates the web service, a Postgres
   database and a Redis instance (`maxmemoryPolicy: noeviction`, which BullMQ needs).
2. When asked, fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
   `JWT_SECRET` is generated for you, and `BACKEND_URL` / `FRONTEND_URL` default to the service's public URL.
3. Add `https://<your-service>.onrender.com/api/auth/google/callback` to the Google OAuth client and
   `https://<your-service>.onrender.com/api/slack/callback` to the Slack app's redirect URLs.
4. The container runs the migrations on start, then the server. `GET /health` is the health check.

Use an always-on instance: a service that sleeps does not run its worker, so scheduled emails would only go out after it wakes
(the boot reconciler then re-enqueues them from Postgres, so none are lost, only late). Postgres is the source of truth, so even a
Redis instance that loses its data is repaired on the next boot.

## Tests and load test

```bash
cd backend  && npm test && npm run typecheck     # 108 tests; need the docker services up
cd frontend && npm test && npm run typecheck && npm run build   # 28 tests
```

The backend tests include the atomic claim and cancel races, the hourly limiter, window math, HTTP-level OAuth flows with
Google and Slack mocked, HTML sanitizing, search with the SQL fallback, and the email API.

**Load test.** `npm run load-test -- <server.log>` (API and worker running) schedules 1000 emails with a limit of 5 per hour
per sender and writes `docs/load-test-output.txt`. In the committed run: 15 sent in the first window (3 senders x 5), 985
rescheduled across later windows, 0 lost, 0 failed, one Slack alert per sender.

## Assumptions and trade-offs

- **Ethereal, not real SMTP.** Each user gets Ethereal test accounts, so no email leaves the sandbox. Swapping in a real SMTP
  provider only changes the sender rows (`smtp_host`, `smtp_user`, `smtp_pass`).
- **Sender credentials in Postgres.** Ethereal passwords are stored in plain text because they are throwaway test credentials;
  a real provider would need encryption at rest or a secrets manager.
- **At-least-once, not exactly-once.** See the edge case under persistence. A claim plus an idempotent job id removes every
  duplicate except a crash between "SMTP accepted" and "row marked sent".
- **Rate-limited emails are rescheduled, not failed.** The planned next-window schedule can briefly plan more than the limit into
  one window when slots already passed (visible as a `(*)` row in the load test output); the Redis limiter is what enforces
  the cap at send time and pushes any excess further out, so actual sends never exceed it.
- **Hourly windows are UTC clock hours**, not rolling 60 minute windows. Simpler and coordination-free, at the cost of allowing a
  burst across a window boundary.
- **Polling, not websockets.** The dashboard polls every 3 seconds; it is simple and good enough at this scale.
- **Elasticsearch is best-effort.** Postgres stays the source of truth, and ES results are hydrated from it. Search degrades to
  SQL `ILIKE` rather than failing.
- **One user, one workspace.** Emails, senders and Slack connections are scoped to the logged-in user; there are no teams or roles.
- **No features beyond the brief.** There is no signup/password login, unsubscribe handling, bounce processing or templates.
- **Attachments live in Postgres** (`bytea`, max 3 files, 2MB each, 5MB total) behind a small in-process LRU cache. Fine for the
  limits; object storage would replace it for larger files.

## Project layout

```
backend/
  src/config.ts            env parsing (zod)
  src/db/                  pool and SQL migrations (001 to 004)
  src/scheduler/           queue, worker, claim/reschedule SQL, hourly limiter, boot reconciler
  src/routes, services/    HTTP API, search, Slack, campaigns, senders
  src/lib/                 redis, tokens, html sanitizing, shutdown
  scripts/                 migrate, load-test, token (test tooling)
frontend/
  src/                     pages, components, api client, hooks (React + Tailwind)
  scripts/                 walkthrough.ts (end-to-end browser run)
docs/                      load test output
docker-compose.yml         Postgres, Redis (AOF), Elasticsearch
Dockerfile, render.yaml    single-image production build and Render Blueprint
```

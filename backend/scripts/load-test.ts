// Load test: 1000 recipients, all due now, hourlyLimit 5, no delay, through the real API.
// Needs the API + worker running (npm run dev) against the docker-compose services.
// Optional argument: path to the server's log file, to include rate-limit / Slack line counts in the output.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { signToken, SESSION_TTL_SECONDS } from '../src/lib/tokens.js';
import { SESSION_COOKIE } from '../src/middleware/auth.js';
import { nextWindowStart } from '../src/scheduler/hourWindow.js';

const RECIPIENTS = 1000;
const HOURLY_LIMIT = 5;
const WAIT_MS = 30_000;
const MIN_TIME_LEFT_IN_WINDOW_MS = 60_000;
const OUTPUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/load-test-output.txt');

const lines: string[] = [];
function print(line = ''): void {
  console.log(line);
  lines.push(line);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const utc = (d: Date | number) => new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

async function main(): Promise<void> {
  // A window roll-over mid-test would muddy the numbers; start just after the boundary instead.
  const untilNextWindow = nextWindowStart(Date.now()) - Date.now();
  if (untilNextWindow < MIN_TIME_LEFT_IN_WINDOW_MS) {
    console.log(`only ${Math.round(untilNextWindow / 1000)}s left in this hour window, waiting for the next one...`);
    await sleep(untilNextWindow + 1000);
  }

  const startedAt = Date.now();
  const recipients = Array.from({ length: RECIPIENTS }, (_, i) => `load-${String(i + 1).padStart(4, '0')}@example.com`);

  print('ReachInbox scheduler load test');
  print('==============================');
  print(`started            ${utc(startedAt)}`);
  print(`recipients         ${RECIPIENTS}, all due now, delayBetweenMs=0, hourlyLimit=${HOURLY_LIMIT}`);
  print(
    `config             MAX_EMAILS_PER_HOUR_PER_SENDER=${config.MAX_EMAILS_PER_HOUR_PER_SENDER}` +
      ` WORKER_CONCURRENCY=${config.WORKER_CONCURRENCY} MIN_DELAY_BETWEEN_EMAILS_MS=${config.MIN_DELAY_BETWEEN_EMAILS_MS}`,
  );

  // The API needs a real session cookie. This script has the server's JWT_SECRET, so it signs one for a
  // dedicated test user (test tooling only: no endpoint in the app can do this).
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email, name) VALUES ('load-test-user', 'load-test@reachinbox.local', 'Load Test')
     ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const session = signToken('session', { sub: user.rows[0]!.id }, SESSION_TTL_SECONDS);

  const response = await fetch(`http://127.0.0.1:${config.PORT}/api/campaigns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session}` },
    body: JSON.stringify({
      subject: 'Load test',
      body: 'Load test body',
      recipients,
      startTime: new Date(startedAt).toISOString(),
      delayBetweenMs: 0,
      hourlyLimit: HOURLY_LIMIT,
    }),
  });
  if (response.status !== 201) throw new Error(`POST /api/campaigns -> ${response.status}: ${await response.text()}`);
  const campaign = (await response.json()) as { id: string; total: number; enqueued: boolean };
  print(`campaign           ${campaign.id} (${campaign.total} emails, enqueued=${campaign.enqueued})`);

  print(`waiting ${WAIT_MS / 1000}s for the worker...`);
  await sleep(WAIT_MS);

  const now = Date.now();
  print();
  print(`snapshot at        ${utc(now)} (current window ${utc(now - (now % 3_600_000))})`);

  const byStatus = await pool.query<{ status: string; count: number }>(
    'SELECT status, count(*)::int AS count FROM emails WHERE campaign_id = $1 GROUP BY status ORDER BY status',
    [campaign.id],
  );
  const counts = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.count])) as Record<string, number>;
  print();
  print('Status of the 1000 emails');
  print('-------------------------');
  for (const status of ['sent', 'scheduled', 'processing', 'failed']) {
    print(`${status.padEnd(12)} ${String(counts[status] ?? 0).padStart(5)}`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  print(`${'total'.padEnd(12)} ${String(total).padStart(5)}   ${total === RECIPIENTS ? 'OK: nothing lost' : 'MISMATCH'}`);

  const sentPerSender = await pool.query<{ sender: string; count: number }>(
    `SELECT s.email AS sender, count(*)::int AS count
       FROM emails e JOIN senders s ON s.id = e.sender_id
      WHERE e.campaign_id = $1 AND e.status = 'sent' AND e.sent_at >= to_timestamp($2::bigint / 1000.0)
      GROUP BY s.email ORDER BY s.email`,
    [campaign.id, Math.floor(now / 3_600_000) * 3_600_000],
  );
  print();
  print(`Sent in the current hour window, per sender (limit ${HOURLY_LIMIT})`);
  print('----------------------------------------------------------');
  for (const row of sentPerSender.rows) {
    print(`${row.sender.padEnd(34)} ${row.count}   ${row.count <= HOURLY_LIMIT ? 'OK' : 'OVER LIMIT'}`);
  }

  const windows = await pool.query<{ window_start: string; emails: number; max_per_sender: number }>(
    `SELECT to_char(w, 'YYYY-MM-DD HH24:MI "UTC"') AS window_start, sum(n)::int AS emails, max(n)::int AS max_per_sender
       FROM (
         SELECT date_trunc('hour', scheduled_at AT TIME ZONE 'UTC') AS w, sender_id, count(*) AS n
           FROM emails
          WHERE campaign_id = $1 AND status IN ('scheduled', 'processing')
          GROUP BY 1, 2
       ) per_sender
      GROUP BY w ORDER BY w`,
    [campaign.id],
  );
  print();
  print('Scheduled emails per future hour window');
  print('---------------------------------------');
  print(`${'window start'.padEnd(22)} ${'emails'.padStart(7)} ${'max per sender'.padStart(15)}`);
  for (const row of windows.rows) {
    const carryOver = row.max_per_sender > HOURLY_LIMIT ? '  (*)' : '';
    print(`${row.window_start.padEnd(22)} ${String(row.emails).padStart(7)} ${String(row.max_per_sender).padStart(15)}${carryOver}`);
  }
  const scheduledTotal = windows.rows.reduce((sum, r) => sum + r.emails, 0);
  const planned = windows.rows.filter((r) => r.max_per_sender > HOURLY_LIMIT).length;
  print(`${windows.rows.length} future windows hold ${scheduledTotal} emails.`);
  if (planned > 0) {
    print(
      `(*) ${planned} window(s) are planned above ${HOURLY_LIMIT}/sender: emails displaced from the current window whose own slot` +
        ' had already passed. This is only the plan. The Redis limiter enforces the cap when each job runs and rolls any excess' +
        ' into the following window, so actual sends never exceed the limit.',
    );
  }

  const logFile = process.argv[2];
  if (logFile) {
    const log = await readFile(logFile, 'utf8');
    const count = (needle: string) => log.split('\n').filter((l) => l.includes(needle)).length;
    print();
    print(`Server log (${path.basename(logFile)})`);
    print('---------------------------------');
    print(`RATE LIMIT lines (emails rescheduled)  ${count('"msg":"RATE LIMIT')}`);
    print(`SLACK alerts sent (once per sender)        ${count('"msg":"SLACK')}`);
    print(`SENT lines                             ${count('"msg":"SENT')}`);
    print(`GATE lines (min-delay deferrals)       ${count('"msg":"GATE')}`);
  }
}

main()
  .then(async () => {
    await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await writeFile(OUTPUT_FILE, `${lines.join('\n')}\n`);
    console.log(`\nwrote ${OUTPUT_FILE}`);
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

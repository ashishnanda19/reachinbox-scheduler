import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { cancelScheduledEmail, claimEmail } from './emails.js';

// Integration test: needs the Postgres from docker-compose with migrations applied.
let userId: string;
let senderId: string;
let campaignId: string;

async function insertEmail(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO emails (campaign_id, user_id, sender_id, recipient, subject, body, scheduled_at)
     VALUES ($1, $2, $3, 'claim-test@example.com', 's', 'b', now()) RETURNING id`,
    [campaignId, userId, senderId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (google_id, email, name) VALUES ('vitest-claim', 'vitest@example.com', 'Vitest') RETURNING id`,
    )
  ).rows[0]!.id;
  senderId = (
    await pool.query<{ id: string }>(
      `INSERT INTO senders (user_id, email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1, 's@example.com', 'localhost', 25, 'u', 'p') RETURNING id`,
      [userId],
    )
  ).rows[0]!.id;
  campaignId = (
    await pool.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, subject, body, start_time, delay_between_ms, hourly_limit, total_count)
       VALUES ($1, 's', 'b', now(), 0, 1, 1) RETURNING id`,
      [userId],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE google_id = 'vitest-claim'"); // cascades to everything above
  await pool.end();
});

describe('claimEmail', () => {
  it('lets exactly one of two parallel calls win', async () => {
    const id = await insertEmail();

    const results = await Promise.all([claimEmail(id), claimEmail(id)]);

    expect(results.filter((row) => row !== null)).toHaveLength(1);
    const { rows } = await pool.query('SELECT status, attempts FROM emails WHERE id = $1', [id]);
    expect(rows[0]).toMatchObject({ status: 'processing', attempts: 1 });
  });

  it('lets exactly one of many parallel calls win', async () => {
    const id = await insertEmail();

    const results = await Promise.all(Array.from({ length: 25 }, () => claimEmail(id)));

    expect(results.filter((row) => row !== null)).toHaveLength(1);
  });

  it('does not let a second caller claim a fresh processing row', async () => {
    const id = await insertEmail();
    await claimEmail(id);

    expect(await claimEmail(id)).toBeNull();
  });

  it('lets exactly one caller take over a stale claim from a crashed worker', async () => {
    const id = await insertEmail();
    await claimEmail(id);
    await pool.query(
      `UPDATE emails SET processing_started_at = now() - ($2::int * interval '1 millisecond') - interval '1 second'
        WHERE id = $1`,
      [id, config.STALE_PROCESSING_MS],
    );

    const results = await Promise.all([claimEmail(id), claimEmail(id)]);

    expect(results.filter((row) => row !== null)).toHaveLength(1);
  });

  it('never claims a sent email', async () => {
    const id = await insertEmail();
    await pool.query("UPDATE emails SET status = 'sent', sent_at = now() WHERE id = $1", [id]);

    expect(await claimEmail(id)).toBeNull();
  });
});

describe('cancelScheduledEmail', () => {
  it('cancels a scheduled email', async () => {
    const id = await insertEmail();

    expect(await cancelScheduledEmail(id, userId)).toBe(true);
    expect((await pool.query('SELECT 1 FROM emails WHERE id = $1', [id])).rowCount).toBe(0);
  });

  it('refuses emails that are processing, sent or failed, and other users\' emails', async () => {
    for (const status of ['processing', 'sent', 'failed']) {
      const id = await insertEmail();
      await pool.query('UPDATE emails SET status = $2 WHERE id = $1', [id, status]);
      expect(await cancelScheduledEmail(id, userId), status).toBe(false);
    }
    const id = await insertEmail();
    expect(await cancelScheduledEmail(id, '00000000-0000-4000-8000-000000000000')).toBe(false);
    expect((await pool.query('SELECT 1 FROM emails WHERE id = $1', [id])).rowCount).toBe(1);
  });

  it('never lets a cancel and a claim both win when they race', async () => {
    let cancelWins = 0;
    let claimWins = 0;
    for (let round = 0; round < 60; round += 1) {
      const id = await insertEmail();

      const [claimed, cancelled] = await Promise.all([claimEmail(id), cancelScheduledEmail(id, userId)]);

      expect(Number(claimed !== null) + Number(cancelled), `round ${round}`).toBe(1);
      if (cancelled) cancelWins += 1;
      else claimWins += 1;
      const row = await pool.query('SELECT status FROM emails WHERE id = $1', [id]);
      // cancel won => row gone; claim won => row is processing and was not deleted
      expect(row.rowCount).toBe(cancelled ? 0 : 1);
    }
    expect(cancelWins + claimWins).toBe(60);
  });
});

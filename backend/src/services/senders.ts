import { config } from '../config.js'; // must precede nodemailer: it disables nodemailer's test-account cache
import nodemailer from 'nodemailer';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export interface Sender {
  id: string;
  user_id: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  active: boolean;
  created_at: Date;
}

/**
 * Makes sure the user owns at least DEFAULT_SENDER_COUNT Ethereal sender accounts.
 * Safe to call repeatedly and concurrently: a per-user advisory lock serialises
 * the count-then-insert, so repeat calls never create duplicates.
 */
export async function ensureSenders(userId: string): Promise<Sender[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ensure-senders:${userId}`]);

    const existing = await client.query<Sender>(
      'SELECT * FROM senders WHERE user_id = $1 ORDER BY created_at, id',
      [userId],
    );
    const missing = config.DEFAULT_SENDER_COUNT - existing.rowCount!;

    const created: Sender[] = [];
    for (let i = 0; i < missing; i += 1) {
      const account = await nodemailer.createTestAccount();
      if ([...existing.rows, ...created].some((sender) => sender.email === account.user)) {
        throw new Error(`Ethereal returned an account that is already a sender (${account.user})`);
      }
      const inserted = await client.query<Sender>(
        `INSERT INTO senders (user_id, email, smtp_host, smtp_port, smtp_user, smtp_pass)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, account.user, account.smtp.host, account.smtp.port, account.user, account.pass],
      );
      created.push(inserted.rows[0]!);
    }

    await client.query('COMMIT');
    if (created.length > 0) {
      logger.info({ userId, created: created.length }, 'created ethereal sender accounts');
    }
    return [...existing.rows, ...created];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Safety cap so "+ Add Ethereal sender" cannot create accounts without bound.
export const MAX_SENDERS_PER_USER = 10;

export async function countSenders(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM senders WHERE user_id = $1', [userId]);
  return rows[0]!.count;
}

export async function listActiveSenders(userId: string): Promise<Sender[]> {
  const { rows } = await pool.query<Sender>(
    'SELECT * FROM senders WHERE user_id = $1 AND active ORDER BY created_at, id',
    [userId],
  );
  return rows;
}

export async function getActiveSender(userId: string, senderId: string): Promise<Sender | null> {
  const { rows } = await pool.query<Sender>('SELECT * FROM senders WHERE id = $1 AND user_id = $2 AND active', [senderId, userId]);
  return rows[0] ?? null;
}

/** Creates one more Ethereal sender for the user. */
export async function createSender(userId: string): Promise<Sender> {
  const account = await nodemailer.createTestAccount();
  const { rows } = await pool.query<Sender>(
    `INSERT INTO senders (user_id, email, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, account.user, account.smtp.host, account.smtp.port, account.user, account.pass],
  );
  logger.info({ userId, email: account.user }, 'created ethereal sender account');
  return rows[0]!;
}

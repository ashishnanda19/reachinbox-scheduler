// Prints a valid session cookie value for a user (creating the user if needed). Used by the Playwright
// screenshot script. Test tooling only: it needs the server's JWT_SECRET, and no endpoint of the app can do this.
//   npm run -s token -- "Oliver Brown" oliver.brown@domain.io
import { pool } from '../src/db/pool.js';
import { SESSION_TTL_SECONDS, signToken } from '../src/lib/tokens.js';

const [name = 'Oliver Brown', email = 'oliver.brown@domain.io', avatar = ''] = process.argv.slice(2);

const { rows } = await pool.query<{ id: string }>(
  `INSERT INTO users (google_id, email, name, avatar_url) VALUES ($1, $2, $3, NULLIF($4, ''))
   ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
   RETURNING id`,
  [`token-script:${email}`, email, name, avatar],
);
console.log(signToken('session', { sub: rows[0]!.id }, SESSION_TTL_SECONDS));
await pool.end();

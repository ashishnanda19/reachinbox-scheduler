import dotenv from 'dotenv';
import { z } from 'zod';

// backend/.env wins; the repo-root .env (shared with docker-compose) is the fallback.
dotenv.config();
dotenv.config({ path: '../.env' });

// nodemailer caches the first Ethereal test account for the whole process, which would make every
// "separate" sender the same account. It reads this flag once, when it is first loaded, so any module
// that imports nodemailer must import config.ts first.
process.env.ETHEREAL_CACHE = 'false';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const optionalString = z.string().default('');

// z.coerce.number() turns a missing variable into NaN ("received nan"); this keeps the message readable.
const integer = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer')
  .transform(Number);
const positiveInt = integer.pipe(z.number().min(1, 'must be at least 1'));
const nonNegativeInt = integer;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: integer.pipe(z.number().min(1).max(65535)).default('4000'),
  BACKEND_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ELASTICSEARCH_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  ELASTICSEARCH_INDEX: z.string().min(1).default('reachinbox-emails'),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  SLACK_CLIENT_ID: optionalString,
  SLACK_CLIENT_SECRET: optionalString,

  QUEUE_NAME: z.string().min(1).default('email-send'),
  WORKER_CONCURRENCY: positiveInt,
  MIN_DELAY_BETWEEN_EMAILS_MS: nonNegativeInt,
  MAX_EMAILS_PER_HOUR_PER_SENDER: positiveInt,
  EMAIL_JOB_ATTEMPTS: positiveInt,
  EMAIL_JOB_BACKOFF_MS: nonNegativeInt,
  STALE_PROCESSING_MS: positiveInt,
  MAX_RECIPIENTS_PER_CAMPAIGN: positiveInt,
  RUN_WORKER_IN_API: booleanFromString.default('true'),
  DEFAULT_SENDER_COUNT: positiveInt,
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (result.success) return result.data;

  const lines = result.error.issues.map(
    (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    // pino is not available yet (it depends on nothing here, but we want a plain readable message).
    console.error((err as Error).message);
    process.exit(1);
  }
}

export const config: Config = loadConfigOrExit();

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id text NOT NULL UNIQUE,
  email text NOT NULL,
  name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL,
  smtp_user text NOT NULL,
  smtp_pass text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_senders_user_id ON senders (user_id);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  start_time timestamptz NOT NULL,
  delay_between_ms integer NOT NULL,
  hourly_limit integer NOT NULL,
  total_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A rate-limited email stays 'scheduled' with a new scheduled_at; there is no separate status for it.
CREATE TABLE emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES senders(id),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  error text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_emails_user_id_status ON emails (user_id, status);
CREATE INDEX idx_emails_status_scheduled_at ON emails (status, scheduled_at);
CREATE INDEX idx_emails_campaign_id ON emails (campaign_id);

CREATE TABLE slack_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,
  channel text,
  created_at timestamptz NOT NULL DEFAULT now()
);

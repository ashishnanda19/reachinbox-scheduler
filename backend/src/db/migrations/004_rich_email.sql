-- Senders can be switched off; emails remember the Ethereal preview link; campaigns can carry attachments.
ALTER TABLE senders ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE emails ADD COLUMN preview_url text;

CREATE TABLE campaign_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position integer NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL,
  UNIQUE (campaign_id, position)
);

-- Stable index of an email within its campaign. Lets a rate-limited email be re-slotted in order
-- without depending on scheduled_at, which changes every time it is rescheduled.
ALTER TABLE emails ADD COLUMN position integer NOT NULL DEFAULT 0;
CREATE INDEX idx_emails_campaign_sender_position ON emails (campaign_id, sender_id, position);

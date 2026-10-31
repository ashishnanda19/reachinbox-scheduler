-- Lets the worker and the boot reconciler tell a crashed 'processing' claim from a live one.
ALTER TABLE emails ADD COLUMN processing_started_at timestamptz;

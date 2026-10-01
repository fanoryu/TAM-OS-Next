ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_kind, ADD CONSTRAINT mail_outbox_kind_v2 CHECK (kind IN ('recovery', 'activation'));

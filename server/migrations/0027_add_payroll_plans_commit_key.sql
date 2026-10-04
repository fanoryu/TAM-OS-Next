ALTER TABLE payroll_plans
  ADD COLUMN commit_idempotency_key CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER committed_at,
  ADD UNIQUE KEY payroll_plans_commit_key (company_id, commit_idempotency_key),
  ADD CONSTRAINT payroll_plans_commit_key_committed CHECK ((status = 'Committed') = (commit_idempotency_key IS NOT NULL)),
  ADD CONSTRAINT payroll_plans_commit_key_format CHECK (commit_idempotency_key REGEXP '^[0-9a-f]{32}$');

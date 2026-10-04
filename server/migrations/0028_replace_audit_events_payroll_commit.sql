ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_operation_v4,
  DROP CONSTRAINT audit_events_action_operation_v3,
  ADD CONSTRAINT audit_events_operation_v5 CHECK (operation IN ('provision', 'reissue', 'disable', 'enable', 'submit', 'review', 'reject', 'approve', 'create', 'recalculate', 'return', 'cancel', 'commit')),
  ADD CONSTRAINT audit_events_action_operation_v4 CHECK (CASE action WHEN 'account.manage' THEN operation IS NOT NULL AND operation IN ('provision', 'reissue', 'disable', 'enable') WHEN 'overtime.submitSelf' THEN operation IS NOT NULL AND operation = 'submit' WHEN 'overtime.manage' THEN operation IS NOT NULL AND operation IN ('review', 'reject', 'approve') WHEN 'payroll.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit') ELSE operation IS NULL END);

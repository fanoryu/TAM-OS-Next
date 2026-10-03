ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_operation_v2,
  DROP CONSTRAINT audit_events_action_operation,
  ADD CONSTRAINT audit_events_operation_v3 CHECK (operation IN ('provision', 'reissue', 'disable', 'enable', 'submit', 'review', 'reject', 'approve')),
  ADD CONSTRAINT audit_events_action_operation_v2 CHECK (CASE action WHEN 'account.manage' THEN operation IS NOT NULL AND operation IN ('provision', 'reissue', 'disable', 'enable') WHEN 'overtime.submitSelf' THEN operation IS NOT NULL AND operation = 'submit' WHEN 'overtime.manage' THEN operation IS NOT NULL AND operation IN ('review', 'reject', 'approve') ELSE operation IS NULL END);

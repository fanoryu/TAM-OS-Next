ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_action_v2,
  DROP CONSTRAINT audit_events_entity,
  DROP CONSTRAINT audit_events_operation,
  DROP CONSTRAINT audit_events_account_operation,
  ADD CONSTRAINT audit_events_action_v3 CHECK (action IN ('employee.create', 'employee.update', 'employee.delete', 'account.manage', 'overtime.createSelfDraft', 'overtime.updateSelfDraft', 'overtime.deleteSelfDraft', 'overtime.submitSelf', 'overtime.manage')),
  ADD CONSTRAINT audit_events_entity_v2 CHECK (entity IN ('employee', 'overtime') AND (entity = 'overtime') = (action LIKE 'overtime.%')),
  ADD CONSTRAINT audit_events_operation_v2 CHECK (operation IN ('provision', 'reissue', 'disable', 'enable', 'submit', 'review', 'reject')),
  ADD CONSTRAINT audit_events_action_operation CHECK (CASE action WHEN 'account.manage' THEN operation IS NOT NULL AND operation IN ('provision', 'reissue', 'disable', 'enable') WHEN 'overtime.submitSelf' THEN operation IS NOT NULL AND operation = 'submit' WHEN 'overtime.manage' THEN operation IS NOT NULL AND operation IN ('review', 'reject') ELSE operation IS NULL END);

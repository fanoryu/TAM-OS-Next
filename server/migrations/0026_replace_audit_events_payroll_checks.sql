ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_action_v3,
  DROP CONSTRAINT audit_events_entity_v2,
  DROP CONSTRAINT audit_events_operation_v3,
  DROP CONSTRAINT audit_events_action_operation_v2,
  ADD CONSTRAINT audit_events_action_v4 CHECK (action IN ('employee.create', 'employee.update', 'employee.delete', 'account.manage', 'overtime.createSelfDraft', 'overtime.updateSelfDraft', 'overtime.deleteSelfDraft', 'overtime.submitSelf', 'overtime.manage', 'payroll.manage')),
  ADD CONSTRAINT audit_events_entity_v3 CHECK (entity IN ('employee', 'overtime', 'payrollPlan') AND (entity = 'overtime') = (action LIKE 'overtime.%') AND (entity = 'payrollPlan') = (action = 'payroll.manage')),
  ADD CONSTRAINT audit_events_operation_v4 CHECK (operation IN ('provision', 'reissue', 'disable', 'enable', 'submit', 'review', 'reject', 'approve', 'create', 'recalculate', 'return', 'cancel')),
  ADD CONSTRAINT audit_events_action_operation_v3 CHECK (CASE action WHEN 'account.manage' THEN operation IS NOT NULL AND operation IN ('provision', 'reissue', 'disable', 'enable') WHEN 'overtime.submitSelf' THEN operation IS NOT NULL AND operation = 'submit' WHEN 'overtime.manage' THEN operation IS NOT NULL AND operation IN ('review', 'reject', 'approve') WHEN 'payroll.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel') ELSE operation IS NULL END);

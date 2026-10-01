ALTER TABLE audit_events
  ADD COLUMN operation VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER entity_id,
  DROP CONSTRAINT audit_events_action,
  ADD CONSTRAINT audit_events_action_v2 CHECK (action IN ('employee.create', 'employee.update', 'employee.delete', 'account.manage')),
  ADD CONSTRAINT audit_events_operation CHECK (operation IN ('provision', 'reissue', 'disable', 'enable')),
  ADD CONSTRAINT audit_events_account_operation CHECK ((action = 'account.manage') = (operation IS NOT NULL)),
  ADD CONSTRAINT audit_events_account_target CHECK (action <> 'account.manage' OR target_user_id IS NOT NULL);

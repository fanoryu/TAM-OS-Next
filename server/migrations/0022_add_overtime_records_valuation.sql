ALTER TABLE overtime_records
  ADD COLUMN valuation_method VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER updated_at,
  ADD COLUMN valuation_salary DECIMAL(15,2) NULL AFTER valuation_method,
  ADD COLUMN valuation_standard_hours DECIMAL(5,2) NULL AFTER valuation_salary,
  ADD COLUMN approved_amount DECIMAL(16,2) NULL AFTER valuation_standard_hours,
  ADD COLUMN approved_at DATETIME(6) NULL AFTER approved_amount,
  DROP CONSTRAINT overtime_records_status,
  ADD CONSTRAINT overtime_records_status_v2 CHECK (status IN ('Draft', 'Submitted', 'Reviewed', 'Approved', 'Rejected')),
  ADD CONSTRAINT overtime_records_valuation CHECK ((status = 'Approved') = (valuation_method IS NOT NULL) AND (valuation_method IS NULL) = (valuation_salary IS NULL) AND (valuation_method IS NULL) = (valuation_standard_hours IS NULL) AND (valuation_method IS NULL) = (approved_amount IS NULL) AND (valuation_method IS NULL) = (approved_at IS NULL)),
  ADD CONSTRAINT overtime_records_valuation_method CHECK (valuation_method IN ('TAM-OT-1')),
  ADD CONSTRAINT overtime_records_valuation_salary CHECK (valuation_salary > 0),
  ADD CONSTRAINT overtime_records_valuation_hours CHECK (valuation_standard_hours > 0 AND (valuation_method <> 'TAM-OT-1' OR valuation_standard_hours = 160.00)),
  ADD CONSTRAINT overtime_records_approved_amount CHECK (approved_amount >= 0 AND approved_amount = FLOOR(approved_amount));

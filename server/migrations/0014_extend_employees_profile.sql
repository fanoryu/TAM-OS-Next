ALTER TABLE employees
  ADD COLUMN employee_code VARCHAR(32) NULL AFTER company_id,
  ADD COLUMN full_name VARCHAR(160) NULL AFTER employee_code,
  ADD COLUMN job_title VARCHAR(120) NULL AFTER full_name,
  ADD COLUMN department VARCHAR(120) NULL AFTER job_title,
  ADD COLUMN employment_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Active' AFTER department,
  ADD COLUMN join_date DATE NULL AFTER employment_status,
  ADD COLUMN contact_email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER join_date,
  ADD COLUMN phone VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER contact_email,
  ADD COLUMN notes TEXT NULL AFTER phone,
  ADD COLUMN monthly_base_salary DECIMAL(15,2) NULL AFTER notes,
  ADD COLUMN archived_at DATETIME(6) NULL AFTER monthly_base_salary,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER archived_at,
  ADD COLUMN updated_at DATETIME(6) NULL AFTER created_at;

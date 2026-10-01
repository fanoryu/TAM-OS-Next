ALTER TABLE employees
  MODIFY COLUMN employee_code VARCHAR(32) NOT NULL,
  MODIFY COLUMN full_name VARCHAR(160) NOT NULL,
  MODIFY COLUMN updated_at DATETIME(6) NOT NULL,
  ADD UNIQUE KEY employees_company_code (company_id, employee_code),
  ADD CONSTRAINT employees_code CHECK (employee_code <> ''),
  ADD CONSTRAINT employees_full_name CHECK (full_name <> ''),
  ADD CONSTRAINT employees_employment_status CHECK (employment_status IN ('Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated')),
  ADD CONSTRAINT employees_salary CHECK (monthly_base_salary >= 0),
  ADD CONSTRAINT employees_version CHECK (version >= 1);

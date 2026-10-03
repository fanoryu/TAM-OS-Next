CREATE TABLE payroll_plan_overtime (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  company_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payroll_plan_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY payroll_plan_overtime_company_id (company_id, id),
  KEY payroll_plan_overtime_plan (company_id, payroll_plan_id),
  CONSTRAINT payroll_plan_overtime_company_fk FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT payroll_plan_overtime_record_fk FOREIGN KEY (company_id, id) REFERENCES overtime_records (company_id, id),
  CONSTRAINT payroll_plan_overtime_plan_fk FOREIGN KEY (company_id, payroll_plan_id) REFERENCES payroll_plans (company_id, id),
  CONSTRAINT payroll_plan_overtime_id CHECK (id REGEXP '^[0-9a-f]{32}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

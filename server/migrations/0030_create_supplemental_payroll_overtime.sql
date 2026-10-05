CREATE TABLE supplemental_payroll_overtime (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  company_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  supplemental_payroll_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY supplemental_payroll_overtime_company_id (company_id, id),
  KEY supplemental_payroll_overtime_supplemental (company_id, supplemental_payroll_id),
  CONSTRAINT supplemental_payroll_overtime_company_fk FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT supplemental_payroll_overtime_record_fk FOREIGN KEY (company_id, id) REFERENCES overtime_records (company_id, id),
  CONSTRAINT supplemental_payroll_overtime_supplemental_fk FOREIGN KEY (company_id, supplemental_payroll_id) REFERENCES supplemental_payrolls (company_id, id),
  CONSTRAINT supplemental_payroll_overtime_id CHECK (id REGEXP '^[0-9a-f]{32}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

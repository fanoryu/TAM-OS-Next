CREATE TABLE memberships (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  company_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  employee_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY memberships_user (user_id),
  UNIQUE KEY memberships_company_employee (company_id, employee_id),
  CONSTRAINT memberships_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT memberships_company_fk FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT memberships_role CHECK (role IN ('ceo', 'employee')),
  CONSTRAINT memberships_status CHECK (status IN ('active', 'disabled')),
  CONSTRAINT memberships_employee_id CHECK (employee_id <> ''),
  CONSTRAINT memberships_employee_bound CHECK (role <> 'employee' OR employee_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

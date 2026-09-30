CREATE TABLE employees (
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  company_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY employees_company_id (company_id, id),
  CONSTRAINT employees_company_fk FOREIGN KEY (company_id) REFERENCES companies (id),
  CONSTRAINT employees_id CHECK (id <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

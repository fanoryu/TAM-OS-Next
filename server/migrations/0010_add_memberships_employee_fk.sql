ALTER TABLE memberships ADD CONSTRAINT memberships_employee_fk FOREIGN KEY (company_id, employee_id) REFERENCES employees (company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

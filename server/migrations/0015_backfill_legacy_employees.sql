UPDATE employees e
  JOIN (
    SELECT l.id, CONCAT('LEGACY-', LPAD(f.n, 6, '0')) AS code
    FROM (
      SELECT id, company_id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at, id) AS k
      FROM employees
      WHERE employee_code IS NULL
    ) l
    JOIN (
      SELECT c.company_id, c.n, ROW_NUMBER() OVER (PARTITION BY c.company_id ORDER BY c.n) AS k
      FROM (
        SELECT company_id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY id) AS n
        FROM employees
      ) c
      WHERE c.n <= 999999
        AND NOT EXISTS (
          SELECT 1 FROM employees x
          WHERE x.company_id = c.company_id AND x.employee_code = CONCAT('LEGACY-', LPAD(c.n, 6, '0'))
        )
    ) f ON f.company_id = l.company_id AND f.k = l.k
  ) a ON a.id = e.id
SET e.employee_code = a.code, e.full_name = '[Legacy record — profile pending]', e.updated_at = e.created_at
WHERE e.employee_code IS NULL AND e.full_name IS NULL;

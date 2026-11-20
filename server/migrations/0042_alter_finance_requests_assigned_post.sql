ALTER TABLE finance_requests
  DROP CONSTRAINT finance_requests_financial_post,
  MODIFY financial_post VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN pre_approval_financial_post VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER financial_post,
  ADD COLUMN pre_approval_post_captured TINYINT(1) NOT NULL DEFAULT 0 AFTER pre_approval_financial_post,
  ADD CONSTRAINT finance_requests_financial_post_v2 CHECK (financial_post IS NULL OR financial_post IN ('GA', 'NPIP', 'TJB', 'DRONE')),
  ADD CONSTRAINT finance_requests_post_payment_request CHECK (kind <> 'paymentRequest' OR financial_post IS NOT NULL),
  ADD CONSTRAINT finance_requests_post_approved CHECK (status NOT IN ('Approved', 'Paid') OR financial_post IS NOT NULL),
  ADD CONSTRAINT finance_requests_pre_approval_post CHECK (pre_approval_financial_post IS NULL OR (pre_approval_financial_post IN ('GA', 'NPIP', 'TJB', 'DRONE') AND pre_approval_post_captured = 1)),
  ADD CONSTRAINT finance_requests_pre_approval_captured CHECK (pre_approval_post_captured = 0 OR (pre_approval_post_captured = 1 AND kind = 'reimbursement' AND status IN ('Approved', 'Paid', 'Cancelled'))),
  ADD CONSTRAINT finance_requests_captured_post CHECK (pre_approval_post_captured = 0 OR financial_post IS NOT NULL);

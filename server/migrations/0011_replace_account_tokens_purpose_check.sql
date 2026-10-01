ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_purpose, ADD CONSTRAINT account_tokens_purpose_v2 CHECK (purpose IN ('activation', 'recovery'));

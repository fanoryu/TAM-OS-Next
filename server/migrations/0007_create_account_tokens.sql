CREATE TABLE account_tokens (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  used_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (token_hash),
  KEY account_tokens_user (user_id, purpose),
  CONSTRAINT account_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT account_tokens_purpose CHECK (purpose IN ('activation')),
  CONSTRAINT account_tokens_expiry CHECK (expires_at > created_at),
  CONSTRAINT account_tokens_final CHECK (used_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT account_tokens_used_in_time CHECK (used_at IS NULL OR used_at < expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

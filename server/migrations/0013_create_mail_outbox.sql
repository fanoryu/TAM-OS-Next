CREATE TABLE mail_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL,
  next_attempt_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  KEY mail_outbox_due (status, next_attempt_at),
  KEY mail_outbox_user (user_id, status),
  CONSTRAINT mail_outbox_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT mail_outbox_kind CHECK (kind IN ('recovery')),
  CONSTRAINT mail_outbox_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  CONSTRAINT mail_outbox_attempts CHECK (attempts <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

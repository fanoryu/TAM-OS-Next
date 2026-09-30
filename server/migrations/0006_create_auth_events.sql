CREATE TABLE auth_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at DATETIME(6) NOT NULL,
  event VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  membership_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  email_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  KEY auth_events_occurred (occurred_at),
  KEY auth_events_user (user_id, occurred_at),
  CONSTRAINT auth_events_event CHECK (event IN ('login_success', 'login_failure', 'login_locked', 'logout'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

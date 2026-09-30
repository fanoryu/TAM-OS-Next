CREATE TABLE auth_rate_limits (
  bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  failures INT UNSIGNED NOT NULL,
  window_started_at DATETIME(6) NOT NULL,
  locked_until DATETIME(6) NULL,
  PRIMARY KEY (bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

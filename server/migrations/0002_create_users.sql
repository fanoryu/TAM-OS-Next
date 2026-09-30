CREATE TABLE users (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email (email),
  CONSTRAINT users_status CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_email_normalized CHECK (email <> '' AND email = LOWER(TRIM(email))),
  CONSTRAINT users_password_hash CHECK (password_hash <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

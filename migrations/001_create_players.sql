CREATE TABLE IF NOT EXISTS players (
  citizenid   VARCHAR(64)  NOT NULL PRIMARY KEY,
  license     VARCHAR(64)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  money       BIGINT       NOT NULL DEFAULT 0,
  bank        BIGINT       NOT NULL DEFAULT 0,
  position    JSON         NULL,
  last_seen   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_players_license (license)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example schema for a typical FiveM server. This is the "starting point" you'd
-- import once; ongoing changes should go through the migration runner instead.

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

CREATE TABLE IF NOT EXISTS vehicles (
  plate       VARCHAR(12)  NOT NULL PRIMARY KEY,
  owner       VARCHAR(64)  NOT NULL,
  model       VARCHAR(64)  NOT NULL,
  props       JSON         NULL,
  stored      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vehicles_owner FOREIGN KEY (owner) REFERENCES players (citizenid) ON DELETE CASCADE,
  INDEX idx_vehicles_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

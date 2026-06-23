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

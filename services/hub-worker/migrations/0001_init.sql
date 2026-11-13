-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Taalcut contributors
-- Install keys and IP addresses are never stored. `owner` and `rater` are HMAC hex.

CREATE TABLE IF NOT EXISTS owners (
  hub_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL,
  pull_request INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (owner, sha256)
);

CREATE TABLE IF NOT EXISTS ratings (
  hub_id TEXT NOT NULL,
  rater TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  at INTEGER NOT NULL,
  PRIMARY KEY (hub_id, rater)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  reporter TEXT NOT NULL,
  reason TEXT NOT NULL,
  issue INTEGER NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS day_counts (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);

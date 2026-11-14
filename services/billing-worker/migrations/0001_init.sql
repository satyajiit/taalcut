-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Taalcut contributors

-- One row per order. Times are milliseconds since the epoch. Amounts are the currency's minor units.
-- The id is also the payment link's reference, so a link can be traced back to its order and no further.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  plan TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  list_amount INTEGER NOT NULL CHECK (list_amount >= amount),
  offer_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'expired', 'cancelled', 'failed')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT,
  channel TEXT,
  country TEXT,
  link_id TEXT UNIQUE,
  payment_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  checked_at INTEGER,
  owner_notified_at INTEGER,
  buyer_notified_at INTEGER
);

CREATE INDEX orders_by_status ON orders (status, checked_at);

-- The provider's delivery ids already handled, so a repeated delivery does nothing twice.
CREATE TABLE provider_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

-- Daily caps, taken one unit at a time.
CREATE TABLE day_counts (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);

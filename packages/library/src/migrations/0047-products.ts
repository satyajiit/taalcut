// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Migration } from './types';

export const products: Migration = {
  version: 47,
  name: 'products',
  up: `
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
  archived_at INTEGER, updated_at INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT;
CREATE INDEX products_active ON products(archived_at, id);
CREATE TABLE product_knowledge (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, locator TEXT NOT NULL, digest TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(product_id, source_id, locator)
) STRICT;
CREATE INDEX product_knowledge_source ON product_knowledge(product_id, source_id);
CREATE TABLE product_ideas (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL, feature_key TEXT NOT NULL, created_at INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT;
CREATE INDEX product_ideas_history ON product_ideas(product_id, created_at DESC);
CREATE INDEX product_ideas_feature ON product_ideas(product_id, feature_key, created_at DESC);
CREATE INDEX product_ideas_page ON product_ideas(product_id, id DESC);
CREATE TABLE product_campaigns (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  idea_id TEXT NOT NULL REFERENCES product_ideas(id), project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), created_at INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(product_id, idea_id)
) STRICT;
CREATE INDEX product_campaigns_project ON product_campaigns(project_id);
CREATE INDEX product_campaigns_history ON product_campaigns(product_id, created_at DESC);
CREATE INDEX product_campaigns_page ON product_campaigns(product_id, id DESC);
CREATE TABLE product_schedules (
  product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  next_run_at INTEGER, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT;
CREATE INDEX product_schedules_due ON product_schedules(enabled, next_run_at);
CREATE TABLE product_occurrences (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  scheduled_for INTEGER NOT NULL, state TEXT NOT NULL, lease_until INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(product_id, scheduled_for)
) STRICT;
CREATE INDEX product_occurrences_expired ON product_occurrences(state, lease_until);
CREATE TABLE product_notifications (
  id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, read_at INTEGER, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT;
CREATE INDEX product_notifications_inbox ON product_notifications(product_id, created_at DESC);
CREATE TABLE product_publications (
  id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, campaign_id TEXT NOT NULL,
  status TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), updated_at INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT;
CREATE INDEX product_publications_campaign ON product_publications(campaign_id);
CREATE INDEX product_publications_status ON product_publications(status, updated_at);
CREATE TABLE product_publish_reconcile_cursor (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1), after_id TEXT
);
INSERT INTO product_publish_reconcile_cursor(singleton, after_id) VALUES (1, NULL);
`,
  down: `DROP TABLE product_publish_reconcile_cursor; DROP TABLE product_publications; DROP TABLE product_notifications; DROP TABLE product_occurrences;
DROP TABLE product_schedules; DROP TABLE product_campaigns; DROP TABLE product_ideas;
DROP TABLE product_knowledge; DROP TABLE products;`,
};

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Migration } from './types';

export const productKnowledgeSearch: Migration = {
  version: 48,
  name: 'product_knowledge_search',
  up: `
CREATE INDEX product_knowledge_page ON product_knowledge(product_id, id);
CREATE INDEX product_knowledge_coverage ON product_knowledge(product_id, locator, id);
CREATE INDEX product_knowledge_source_page ON product_knowledge(product_id, source_id, id);
CREATE VIRTUAL TABLE product_knowledge_fts USING fts5(product_id, title, text, tokenize='unicode61');
INSERT INTO product_knowledge_fts(rowid, product_id, title, text)
  SELECT rowid, product_id, json_extract(body_json,'$.title'), json_extract(body_json,'$.text')
  FROM product_knowledge;
CREATE TRIGGER product_knowledge_fts_insert AFTER INSERT ON product_knowledge BEGIN
  INSERT INTO product_knowledge_fts(rowid, product_id, title, text)
    VALUES(NEW.rowid, NEW.product_id, json_extract(NEW.body_json,'$.title'), json_extract(NEW.body_json,'$.text'));
END;
CREATE TRIGGER product_knowledge_fts_update AFTER UPDATE ON product_knowledge BEGIN
  DELETE FROM product_knowledge_fts WHERE rowid=OLD.rowid;
  INSERT INTO product_knowledge_fts(rowid, product_id, title, text)
    VALUES(NEW.rowid, NEW.product_id, json_extract(NEW.body_json,'$.title'), json_extract(NEW.body_json,'$.text'));
END;
CREATE TRIGGER product_knowledge_fts_delete AFTER DELETE ON product_knowledge BEGIN
  DELETE FROM product_knowledge_fts WHERE rowid=OLD.rowid;
END;
`,
  down: `
DROP TRIGGER product_knowledge_fts_delete;
DROP TRIGGER product_knowledge_fts_update;
DROP TRIGGER product_knowledge_fts_insert;
DROP TABLE product_knowledge_fts;
DROP INDEX product_knowledge_source_page;
DROP INDEX product_knowledge_coverage;
DROP INDEX product_knowledge_page;
`,
};

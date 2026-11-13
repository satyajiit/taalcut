// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B1 (hardening): the template list's name sort knows Unicode. `templates.name_key` is the name as
 * stores/template-name-key.ts keys it (accents of Latin, Greek and Cyrillic dropped, lower case), filled here for
 * every stored name and written with each name after; the name index moves to it. SQLite's NOCASE, which the
 * index used before, folds ASCII only. A name sort breaks ties by the larger id in both directions, so each
 * direction gets an index it reads in order (with one, a page of the other sorted every name its first rows
 * tie with: 9 ms at 20,000 lineages, a fifth of them "Untitled"). Down goes back to the NOCASE index.
 */
import { templateNameKey } from '../stores/template-name-key';
import type { Migration } from './types';

const up = `
ALTER TABLE templates ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
DROP INDEX templates_name_idx;
CREATE INDEX templates_name_key_asc_idx ON templates(name_key, id DESC);
CREATE INDEX templates_name_key_desc_idx ON templates(name_key, id);
`;

const down = `
DROP INDEX templates_name_key_desc_idx;
DROP INDEX templates_name_key_asc_idx;
ALTER TABLE templates DROP COLUMN name_key;
CREATE INDEX templates_name_idx ON templates(name COLLATE NOCASE, id);
`;

export const templateNameKeys: Migration = {
  version: 24,
  name: 'template_name_keys',
  up,
  down,
  fill(driver) {
    const write = driver.prepare('UPDATE templates SET name_key = ? WHERE id = ?');
    for (const row of driver.prepare('SELECT id, name FROM templates').all()) {
      write.run(templateNameKey(String(row.name)), String(row.id));
    }
  },
};

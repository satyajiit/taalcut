// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keyword search over shots (P2-L10): `shot_fts`, an FTS5 table kept in step
 * with `shots` and `assets.original_filename` by triggers.
 *
 * The tokenizer adds Unicode marks (`M*`) to unicode61's token characters:
 * by default Devanagari vowel signs and virama separate tokens, so "नमस्ते"
 * would be indexed as "नमस", "त". Latin diacritics still fold ("São" matches
 * "sao").
 *
 * An FTS row's rowid comes from `shot_search_rows` (an INTEGER PRIMARY KEY per
 * shot), not from the shot's own rowid: a table keyed by text has implicit
 * rowids that VACUUM (and so a restored VACUUM INTO backup) may renumber.
 */
import type { Migration } from './types';

const TOKENIZER = `unicode61 remove_diacritics 2 categories 'L* N* Co M*'`;

/** Objects, place and shot type: what the model saw, as words. */
const labels = (shot: string) =>
  `trim(coalesce(replace(${shot}.objects, char(31), ' '), '') || ' ' || coalesce(${shot}.place, '') || ' ' ||
    coalesce(replace(${shot}.shot_type, '_', ' '), ''))`;

const fileName = (shot: string) => `(SELECT original_filename FROM assets WHERE id = ${shot}.asset_id)`;
const rowOf = (shotId: string) => `(SELECT rowid FROM shot_search_rows WHERE shot_id = ${shotId})`;

const up = `
CREATE TABLE shot_search_rows (
  rowid INTEGER PRIMARY KEY NOT NULL,
  shot_id TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX shot_search_rows_shot_uq ON shot_search_rows(shot_id);

CREATE VIRTUAL TABLE shot_fts USING fts5(
  description, labels, on_screen_text, transcript, file_name,
  tokenize = "${TOKENIZER}"
);

CREATE TRIGGER shot_fts_on_insert AFTER INSERT ON shots BEGIN
  INSERT INTO shot_search_rows (shot_id) VALUES (NEW.id);
  INSERT INTO shot_fts (rowid, description, labels, on_screen_text, transcript, file_name)
    VALUES (${rowOf('NEW.id')}, NEW.description, ${labels('NEW')}, NEW.on_screen_text, NEW.transcript_text,
      ${fileName('NEW')});
END;

CREATE TRIGGER shot_fts_on_update
AFTER UPDATE OF description, objects, place, shot_type, on_screen_text, transcript_text ON shots BEGIN
  UPDATE shot_fts SET description = NEW.description, labels = ${labels('NEW')},
      on_screen_text = NEW.on_screen_text, transcript = NEW.transcript_text
    WHERE rowid = ${rowOf('NEW.id')};
END;

CREATE TRIGGER shot_fts_on_delete AFTER DELETE ON shots BEGIN
  DELETE FROM shot_fts WHERE rowid = ${rowOf('OLD.id')};
  DELETE FROM shot_search_rows WHERE shot_id = OLD.id;
END;

CREATE TRIGGER shot_fts_on_rename AFTER UPDATE OF original_filename ON assets BEGIN
  UPDATE shot_fts SET file_name = NEW.original_filename
    WHERE rowid IN (SELECT r.rowid FROM shot_search_rows r JOIN shots s ON s.id = r.shot_id WHERE s.asset_id = NEW.id);
END;

INSERT INTO shot_search_rows (shot_id) SELECT id FROM shots ORDER BY asset_id, index_in_asset;
INSERT INTO shot_fts (rowid, description, labels, on_screen_text, transcript, file_name)
  SELECT r.rowid, s.description, ${labels('s')}, s.on_screen_text, s.transcript_text, ${fileName('s')}
  FROM shot_search_rows r JOIN shots s ON s.id = r.shot_id;
`;

const down = `
DROP TRIGGER shot_fts_on_rename;
DROP TRIGGER shot_fts_on_delete;
DROP TRIGGER shot_fts_on_update;
DROP TRIGGER shot_fts_on_insert;
DROP TABLE shot_fts;
DROP TABLE shot_search_rows;
`;

export const librarySearch: Migration = { version: 13, name: 'library_search', up, down };

/** The FTS5 tokenizer, for tests and the search code's own checks. */
export const SHOT_FTS_TOKENIZER = TOKENIZER;

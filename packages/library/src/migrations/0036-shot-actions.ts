// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND: what people in a shot are doing, searchable and filterable. A shot's actions live in its analysis
 * (`description.actions`, vision's describe stage); triggers keep two things in step with it:
 *
 * - `shot_actions`: one row per shot and action, for the action filter and its choices (`library.actions`), read
 *   by index instead of parsing every analysis, which carries curves of up to 36,000 samples.
 * - `shot_fts.actions`: a column of its own, so a keyword search finds "dancing" or "playing music"; search maps
 *   the words people type ("dance", "नाचते", "bailando") onto them.
 *
 * The column is new, so `shot_fts` is rebuilt once: its rows are copied out, the table made again with the column
 * last, and the rows copied back with their actions. The copy keeps every other column as stored, whatever wrote it
 * (migration 13's labels, place's words in them), and no trigger here writes anything but `actions`: the shot
 * triggers that insert and update the FTS row (13, recreated by place) stay as they are and leave the new column
 * alone. A shot is inserted without an analysis (`replaceForAsset`), so its actions arrive with the analysis update.
 *
 * The rule that keeps the column safe: every trigger writes `shot_fts` with `UPDATE … SET` on the columns it owns or
 * `INSERT` with a column list, and no trigger may delete and reinsert a shot's row (that would clear the others'
 * columns). shot_fts is a plain FTS5 table, not external-content, so nothing rebuilds a row from elsewhere either.
 */
import type { Migration } from './types';

const TOKENIZER = `unicode61 remove_diacritics 2 categories 'L* N* Co M*'`;
/** shot_fts's columns before this migration, in order. */
const COLUMNS = 'description, labels, on_screen_text, transcript, file_name';

/** The shot's analysis when it is JSON, else NULL: json_each over NULL is empty, over malformed text an error. */
const json = (shot: string) => `CASE WHEN json_valid(${shot}.analysis) THEN ${shot}.analysis END`;
/** A shot's actions as words, from its analysis; '' without any. */
const actionWords = (shot: string) =>
  `coalesce((SELECT group_concat(value, ' ') FROM json_each(${json(shot)}, '$.description.actions')
    WHERE type = 'text'), '')`;
/** Whether the shot's analysis has an actions list to read. */
const hasActions = (shot: string) =>
  `${shot}.analysis IS NOT NULL AND json_valid(${shot}.analysis)
    AND json_type(${shot}.analysis, '$.description.actions') = 'array'`;

/** The analysis's actions list as JSON text, NULL without one: a trigger runs only when it changed. */
const actionsOf = (shot: string) => `json_extract(${json(shot)}, '$.description.actions')`;

const rowOf = (shotId: string) => `(SELECT rowid FROM shot_search_rows WHERE shot_id = ${shotId})`;

/** shot_fts made again with `columns`, its rows copied across; `extra` fills any column past the old ones. */
const rebuildFts = (columns: string, extra: string) => `
CREATE TEMP TABLE shot_fts_copy AS SELECT rowid AS row, ${COLUMNS} FROM shot_fts;
DROP TABLE shot_fts;
CREATE VIRTUAL TABLE shot_fts USING fts5(${columns}, tokenize = "${TOKENIZER}");
INSERT INTO shot_fts (rowid, ${columns})
  SELECT c.row, ${COLUMNS.split(', ')
    .map((column) => `c.${column}`)
    .join(', ')}${extra} FROM shot_fts_copy c;
DROP TABLE temp.shot_fts_copy;`;

const up = `
CREATE TABLE shot_actions (
  action TEXT NOT NULL,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  PRIMARY KEY (action, shot_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX shot_actions_shot_idx ON shot_actions(shot_id);

INSERT OR IGNORE INTO shot_actions (action, shot_id)
  SELECT DISTINCT lower(j.value), s.id FROM shots s, json_each(${json('s')}, '$.description.actions') j
  WHERE ${hasActions('s')} AND j.type = 'text';

${rebuildFts(
  `${COLUMNS}, actions`,
  `, coalesce((SELECT ${actionWords('s')} FROM shots s JOIN shot_search_rows r ON r.shot_id = s.id
      WHERE r.rowid = c.row AND ${hasActions('s')}), '')`,
)}

CREATE TRIGGER shot_actions_on_update AFTER UPDATE OF analysis ON shots
WHEN ${actionsOf('OLD')} IS NOT ${actionsOf('NEW')} BEGIN
  DELETE FROM shot_actions WHERE shot_id = NEW.id;
  INSERT OR IGNORE INTO shot_actions (action, shot_id)
    SELECT DISTINCT lower(value), NEW.id FROM json_each(${json('NEW')}, '$.description.actions')
    WHERE ${hasActions('NEW')} AND type = 'text';
  UPDATE shot_fts SET actions = CASE WHEN ${hasActions('NEW')} THEN ${actionWords('NEW')} ELSE '' END
    WHERE rowid = ${rowOf('NEW.id')};
END;
`;

const down = `
DROP TRIGGER shot_actions_on_update;
${rebuildFts(COLUMNS, '')}
DROP TABLE shot_actions;
`;

export const shotActions: Migration = { version: 36, name: 'shot_actions', up, down };

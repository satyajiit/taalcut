// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's language that no decision stands behind (LIB1-LANG). Before LIB1, audio.language filed Whisper's own
 * guess in `assets.language`. LIB1's step stores a decision (asset_spoken_language) every time it names a language,
 * and its version rose, so every old clip is decided again, but only once the queue reaches it. On a real library
 * that can take hours. Until then the old guess is held back everywhere it would be named: the clip page and the
 * library's summaries, the agent's tools, the language filter and the transcript's language.
 *
 * The rule, in SQL so the filter and the summaries share it. The clip's language step has a row (the pipeline
 * seeded it for the clip), yet no decision or choice is stored, and the clip has no words of its own (a generated
 * file's provided transcript names its language exactly, and its speech steps skip). At this version a step that
 * names a language always stores its decision, so such a clip's language is the old step's guess, or one the new
 * step has since found silent. A clip the pipeline never seeded (a library or a test without stages) keeps its
 * language.
 *
 * Pending: Taalcut will decide it again, so the window can say so. The step is waiting, queued or running, or done
 * without a decision and not silent (done at an older version: the version rise puts it back when the queue is
 * idle). Not pending: it failed, was skipped, or found no speech.
 */
import type { AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

/** packages/audio's language step. */
const LANGUAGE_STAGE = 'audio.language';

/** True when the asset `alias` names has no decision behind its language (alias: the `assets` table's). */
export function undecidedLanguageSql(alias: string): string {
  return `(NOT EXISTS (SELECT 1 FROM asset_spoken_language sl WHERE sl.asset_id = ${alias}.id
      AND (sl.outcome IS NOT NULL OR sl.chosen IS NOT NULL))
    AND EXISTS (SELECT 1 FROM asset_index_stages ls WHERE ls.asset_id = ${alias}.id AND ls.stage = '${LANGUAGE_STAGE}')
    AND NOT EXISTS (SELECT 1 FROM transcripts pt WHERE pt.asset_id = ${alias}.id AND pt.engine = 'tts'))`;
}

/** True when the language step will decide it again (see the header); only asked of a held language. */
function decidingAgainSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM asset_index_stages lp WHERE lp.asset_id = ${alias}.id AND lp.stage = '${LANGUAGE_STAGE}'
    AND (lp.state IN ('waiting', 'queued', 'running')
      OR (lp.state = 'done'
        AND (CASE WHEN json_valid(lp.output) THEN json_extract(lp.output, '$.decision') END) IS NULL
        AND (CASE WHEN json_valid(lp.output) THEN json_extract(lp.output, '$.silent') END) IS NOT 1)))`;
}

/** `held`: the language isn't named; `pending`: and Taalcut is deciding it again. */
export type HeldLanguage = 'held' | 'pending';

/** The clips among `assetIds` whose language is held back, and whether each is being decided again. */
export function heldLanguages(db: LibraryDatabase, assetIds: readonly AssetId[]): Map<AssetId, HeldLanguage> {
  const out = new Map<AssetId, HeldLanguage>();
  if (assetIds.length === 0) return out;
  const rows = db.driver
    .prepare(
      `SELECT a.id AS id, ${decidingAgainSql('a')} AS pending FROM assets a
       WHERE a.id IN (SELECT value FROM json_each(?)) AND a.language IS NOT NULL AND ${undecidedLanguageSql('a')}`,
    )
    .all(JSON.stringify(assetIds)) as { id: AssetId; pending: number }[];
  for (const row of rows) out.set(row.id, row.pending ? 'pending' : 'held');
  return out;
}

/** True when the clip has no decision behind its language (the header's rule), whatever its language is. */
export function languageUndecided(db: LibraryDatabase, assetId: AssetId): boolean {
  const row = db.driver
    .prepare(`SELECT ${undecidedLanguageSql('a')} AS undecided FROM assets a WHERE a.id = ?`)
    .get(assetId) as { undecided: number } | undefined;
  return row?.undecided === 1;
}

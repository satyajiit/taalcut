// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's spoken language (LIB1-LANG): what `audio.language` decided and what the person chose. The chosen language
 * wins; `assets.language` is kept as the effective one (asset-facts.ts `setLanguage`), so search, the agent and the
 * stages that read it see the correction.
 */
import {
  effectiveLanguage,
  err,
  ok,
  spokenLanguageOutcomeSchema,
  spokenLanguageSchema,
  ValidationError,
  type AssetId,
  type AssetSummary,
  type Result,
  type SpokenLanguage,
  type SpokenLanguageOutcome,
  type Transcript,
} from '@taalcut/core';
import { eq, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { languageUndecided } from './held-language';
import { assetSpokenLanguage } from './spoken-language-table';

export interface SpokenLanguageRecord {
  readonly outcome: SpokenLanguageOutcome | null;
  readonly chosen: SpokenLanguage | null;
}

const NONE: SpokenLanguageRecord = { outcome: null, chosen: null };

function recordOf(row: { outcome: unknown; chosen: string | null } | undefined): SpokenLanguageRecord {
  if (!row) return NONE;
  const outcome = spokenLanguageOutcomeSchema.safeParse(row.outcome);
  return { outcome: outcome.success ? outcome.data : null, chosen: row.chosen };
}

/** What the clip says it speaks: the chosen language, else the decision; undefined before either. */
export function speechOf(record: SpokenLanguageRecord): SpokenLanguageOutcome | undefined {
  if (record.chosen) return { state: 'chosen', languages: [record.chosen], confidence: null };
  return record.outcome ?? undefined;
}

/** The summary's `speech` field, left out before audio.language ran. */
export function speechField(record: SpokenLanguageRecord | undefined): Pick<AssetSummary, 'speech'> {
  const speech = record ? speechOf(record) : undefined;
  return speech ? { speech: { ...speech, languages: [...speech.languages] } } : {};
}

/** `assets.language`: the chosen language, else the decision's first, else null (unclear). */
export function effectiveOf(record: SpokenLanguageRecord): SpokenLanguage | null {
  return record.chosen ?? (record.outcome ? effectiveLanguage(record.outcome) : null);
}

/** BCP 47 for "undetermined": a transcript whose language nobody settled. */
export const UNDETERMINED_LANGUAGE = 'und';

/**
 * The language a stored transcript is read in: the clip's settled language, never the transcriber's own guess.
 * Whisper names a language on every run, even one that wrote nothing (a second or two of speech it couldn't place
 * comes back as some language with no segments), and the transcript stage keeps what Whisper returned. So
 * every reader takes the language from here: the clip page, the transcript's pages, the agent's asset tool, and the
 * stages that read the transcript.
 * - Decided (an outcome or a choice): the person's choice, else the decision's first language. Unclear speech gets
 *   `und`.
 * - No decision behind the clip's language (held-language.ts: analysed before LIB1, until the indexer decides it
 *   again): `und`, as the clip page names no language for it either.
 * - Otherwise (a clip the pipeline never seeded, or a generated file's own words): a transcript with words keeps its
 *   language, since it was written in it; one without names none (`und`).
 * A read-time rule, so old rows and a correction read right at once, without the transcript running again.
 */
export function settledTranscript(db: LibraryDatabase, assetId: AssetId, transcript: Transcript): Transcript {
  const record = createAssetLanguageRepository(db).get(assetId);
  const decided = record.chosen !== null || record.outcome !== null;
  const written = transcript.segments.some((segment) => segment.text.trim() !== '');
  const language = decided
    ? (effectiveOf(record) ?? UNDETERMINED_LANGUAGE)
    : written && !languageUndecided(db, assetId)
      ? transcript.language
      : UNDETERMINED_LANGUAGE;
  return language === transcript.language ? transcript : { ...transcript, language };
}

export function createAssetLanguageRepository(db: LibraryDatabase) {
  const { orm } = db;
  const upsert = (assetId: AssetId, set: Partial<typeof assetSpokenLanguage.$inferInsert>) => {
    const updatedAt = db.clock();
    orm
      .insert(assetSpokenLanguage)
      .values({ assetId, ...set, updatedAt })
      .onConflictDoUpdate({ target: assetSpokenLanguage.assetId, set: { ...set, updatedAt } })
      .run();
  };
  return {
    get(assetId: AssetId): SpokenLanguageRecord {
      return recordOf(
        orm.select().from(assetSpokenLanguage).where(eq(assetSpokenLanguage.assetId, assetId)).get(),
      );
    },
    many(assetIds: readonly AssetId[]): Map<AssetId, SpokenLanguageRecord> {
      const out = new Map<AssetId, SpokenLanguageRecord>();
      if (assetIds.length === 0) return out;
      for (const row of orm
        .select()
        .from(assetSpokenLanguage)
        .where(inArray(assetSpokenLanguage.assetId, [...assetIds]))
        .all())
        out.set(row.assetId, recordOf(row));
      return out;
    },
    /** What audio.language decided. */
    setOutcome(assetId: AssetId, outcome: SpokenLanguageOutcome): Result<SpokenLanguageRecord> {
      const parsed = spokenLanguageOutcomeSchema.safeParse(outcome);
      if (!parsed.success)
        return err(ValidationError({ field: 'spokenLanguage' }, { detail: parsed.error.message }));
      upsert(assetId, { outcome: parsed.data });
      return ok(this.get(assetId));
    },
    /** The person's language for the clip; null gives the clip back to detection. */
    setChosen(assetId: AssetId, chosen: SpokenLanguage | null): Result<SpokenLanguageRecord> {
      if (chosen !== null && !spokenLanguageSchema.safeParse(chosen).success)
        return err(ValidationError({ field: 'language' }));
      upsert(assetId, { chosen, chosenAt: chosen === null ? null : db.clock() });
      return ok(this.get(assetId));
    },
  };
}

export type AssetLanguageRepository = ReturnType<typeof createAssetLanguageRepository>;

/**
 * audio.language's decision, stored, and `assets.language` set to the effective language: the person's choice
 * still wins, and an unclear clip is filed under no language (LIB1-LANG).
 */
export function storeSpokenLanguage(
  db: LibraryDatabase,
  assetId: AssetId,
  outcome: SpokenLanguageOutcome,
  assets: { setLanguage(id: AssetId, language: string | null): Result<unknown> },
): Result<unknown> {
  const stored = createAssetLanguageRepository(db).setOutcome(assetId, outcome);
  if (!stored.ok) return stored;
  return assets.setLanguage(assetId, effectiveOf(stored.value));
}

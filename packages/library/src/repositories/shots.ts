// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL repository for Shot (ADR 0001, D4) with Phase 2's profile
 * (P2-L1): shot ranges from detection, vision's analysis and descriptions,
 * near-duplicate groups. Every searchable thing is a shot; the FTS index
 * follows these columns through triggers (migration 13).
 *
 * Re-detection keeps a ShotId when its start is within one frame of an old
 * shot's, so timeline clips' hints and vectors keyed by ShotId stay valid;
 * a kept shot whose length changed loses its analysis (vision redoes it).
 */
import {
  err,
  newId,
  ok,
  RationalTime,
  shotAnalysisSchema,
  shotDescriptionSchema,
  TimeRange,
  timeRangeSchema,
  ValidationError,
  type AssetId,
  type DuplicateGroup,
  type Result,
  type ShotAnalysis,
  type ShotDescription,
  type ShotId,
} from '@taalcut/core';
import { asc, eq, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { shots } from '../schema/library';
import { found, inTransaction } from './shared';
import { shotTimes, type StoredTime } from './stored-time';
import { transcriptTextIn } from './transcript-text';

export type Shot = typeof shots.$inferSelect;

/** Joins a description's objects in the `objects` column; FTS reads them as separate words. */
export const OBJECT_SEPARATOR = '\u001f';

export interface ShotRepository {
  /**
   * Replaces the asset's shots with these ranges, in order, for `generation`. A range starting within
   * one frame of an old shot keeps its ShotId (and its analysis while its length is unchanged too).
   */
  replaceForAsset(assetId: AssetId, generation: number, ranges: readonly TimeRange[]): Result<ShotId[]>;
  /** Stores vision's analyses (validated with core's schema) and the columns read from them. */
  putAnalyses(items: readonly { readonly shotId: ShotId; readonly analysis: ShotAnalysis }[]): Result<number>;
  /** Adds the model's descriptions to the analyses (and their columns). */
  putDescriptions(
    items: readonly { readonly shotId: ShotId; readonly description: ShotDescription }[],
  ): Result<number>;
  /** Replaces every near-duplicate group in the library: members point at the leader; only the best is a best take. */
  setDuplicateGroups(groups: readonly DuplicateGroup[]): Result<number>;
  listByAsset(assetId: AssetId): Shot[];
  get(id: ShotId): Result<Shot>;
  /** Shots by id, in no particular order (search hits, casting candidates). */
  getMany(ids: readonly ShotId[]): Shot[];
}

/** A shot's range within its asset. */
export function shotRange(shot: Shot): TimeRange {
  const { start, duration } = shotTimes(shot);
  return TimeRange.of(start, duration);
}

/** The stored analysis, or null when there is none or it no longer parses. */
export function shotAnalysis(shot: Pick<Shot, 'analysis'>): ShotAnalysis | null {
  if (shot.analysis == null) return null;
  const parsed = shotAnalysisSchema.safeParse(shot.analysis);
  return parsed.success ? parsed.data : null;
}

/** Above any real index while kept shots are renumbered. */
const PARKED = 1_000_000;

/** Less than one frame apart, at the coarser of the two rates (the asset's own grid). */
function sameInstant(a: RationalTime, b: RationalTime): boolean {
  const gap = RationalTime.compare(a, b) >= 0 ? RationalTime.subtract(a, b) : RationalTime.subtract(b, a);
  return RationalTime.isBefore(gap, RationalTime.max(RationalTime.of(1, a.rate), RationalTime.of(1, b.rate)));
}

const nfc = (text: string | undefined | null) => (text == null ? null : text.normalize('NFC'));

/** The columns search, filters and casting read from an analysis. */
function analysisColumns(analysis: ShotAnalysis) {
  return {
    analysis: analysis as unknown,
    ...descriptionColumns(analysis.description),
    motion: analysis.motion ?? null,
    energy: analysis.energy,
    quality: analysis.quality.overall,
    onScreenText: analysis.onScreenText.map((t) => t.text.normalize('NFC')).join('\n') || null,
    bestFrame: analysis.bestFrame,
    dHash: analysis.dHash,
  };
}

function descriptionColumns(description: ShotDescription | undefined) {
  return {
    description: nfc(description?.text),
    objects: description?.objects.length
      ? description.objects.map((o) => o.normalize('NFC')).join(OBJECT_SEPARATOR)
      : null,
    place: nfc(description?.place),
    shotType: description?.shotType ?? null,
  };
}

const CLEARED = {
  analysis: null,
  description: null,
  objects: null,
  place: null,
  shotType: null,
  motion: null,
  energy: null,
  quality: null,
  onScreenText: null,
  bestFrame: null,
  dHash: null,
};

function columns(start: RationalTime, duration: RationalTime) {
  return {
    startValue: start.value,
    startRateNum: start.rate.num,
    startRateDen: start.rate.den,
    durationValue: duration.value,
    durationRateNum: duration.rate.num,
    durationRateDen: duration.rate.den,
  };
}

export function createShotRepository(db: LibraryDatabase): ShotRepository {
  const { orm } = db;
  const listByAsset = (assetId: AssetId) =>
    orm.select().from(shots).where(eq(shots.assetId, assetId)).orderBy(asc(shots.indexInAsset)).all();

  function replaceForAsset(assetId: AssetId, generation: number, ranges: readonly TimeRange[]) {
    const parsed: TimeRange[] = [];
    for (const range of ranges) {
      const checked = timeRangeSchema.safeParse(range);
      if (!checked.success)
        return err(ValidationError({ field: 'shots' }, { detail: checked.error.message }));
      parsed.push(checked.data);
    }
    return inTransaction(db, 'shot', () => {
      const old = listByAsset(assetId);
      const kept = new Map<ShotId, TimeRange>();
      const ids = parsed.map((range) => {
        const match = old.find((s) => !kept.has(s.id) && sameInstant(shotRange(s).start, range.start));
        const id = match?.id ?? (newId<'Shot'>() as ShotId);
        kept.set(id, range);
        return { id, range, match };
      });
      const gone = old.filter((s) => !kept.has(s.id)).map((s) => s.id);
      if (gone.length > 0) orm.delete(shots).where(inArray(shots.id, gone)).run();
      // Move kept shots out of the way first: (asset, index) is unique.
      for (const { match } of ids)
        if (match)
          orm
            .update(shots)
            .set({ indexInAsset: PARKED + match.indexInAsset })
            .where(eq(shots.id, match.id))
            .run();
      const now = db.clock();
      const transcript = transcriptTextIn(db, assetId);
      ids.forEach(({ id, range, match }, indexInAsset) => {
        const time = columns(range.start, range.duration);
        const text = transcript(range);
        if (match) {
          const same = sameInstant(TimeRange.end(shotRange(match)), TimeRange.end(range));
          orm
            .update(shots)
            .set({ indexInAsset, ...time, generation, transcriptText: text, ...(same ? {} : CLEARED) })
            .where(eq(shots.id, id))
            .run();
        } else {
          orm
            .insert(shots)
            .values({ id, assetId, indexInAsset, ...time, generation, createdAt: now, transcriptText: text })
            .run();
        }
      });
      return ok(ids.map((i) => i.id));
    });
  }

  return {
    replaceForAsset,
    putAnalyses(items) {
      const rows: { shotId: ShotId; analysis: ShotAnalysis }[] = [];
      for (const item of items) {
        const parsed = shotAnalysisSchema.safeParse(item.analysis);
        if (!parsed.success)
          return err(ValidationError({ field: 'analysis' }, { detail: parsed.error.message }));
        rows.push({ shotId: item.shotId, analysis: parsed.data });
      }
      return inTransaction(db, 'shot', () => {
        let changed = 0;
        for (const { shotId, analysis } of rows)
          changed += orm
            .update(shots)
            .set(analysisColumns(analysis))
            .where(eq(shots.id, shotId))
            .run().changes;
        return ok(changed);
      });
    },
    putDescriptions(items) {
      for (const item of items) {
        const parsed = shotDescriptionSchema.safeParse(item.description);
        if (!parsed.success)
          return err(ValidationError({ field: 'description' }, { detail: parsed.error.message }));
      }
      return inTransaction(db, 'shot', () => {
        let changed = 0;
        for (const { shotId, description } of items) {
          const row = orm.select({ analysis: shots.analysis }).from(shots).where(eq(shots.id, shotId)).get();
          if (!row) continue;
          const analysis = shotAnalysis(row);
          const merged = analysis ? { ...analysis, description, descriptionSkipped: undefined } : null;
          const set = merged
            ? analysisColumns(JSON.parse(JSON.stringify(merged)) as ShotAnalysis)
            : descriptionColumns(description);
          changed += orm.update(shots).set(set).where(eq(shots.id, shotId)).run().changes;
        }
        return ok(changed);
      });
    },
    setDuplicateGroups(groups) {
      return inTransaction(db, 'shot', () => {
        orm.update(shots).set({ duplicateGroup: null, bestTake: true }).run();
        let changed = 0;
        for (const group of groups) {
          if (!group.shotIds.includes(group.bestShotId))
            return err(
              ValidationError({ field: 'bestShotId' }, { detail: 'the best take is not in its group' }),
            );
          if (group.shotIds.length < 2) continue;
          for (const shotId of group.shotIds) {
            changed += orm
              .update(shots)
              .set({ duplicateGroup: group.bestShotId, bestTake: shotId === group.bestShotId })
              .where(eq(shots.id, shotId))
              .run().changes;
          }
        }
        return ok(changed);
      });
    },
    listByAsset,
    get: (id) => found(orm.select().from(shots).where(eq(shots.id, id)).get(), 'shot', id),
    getMany: (ids) =>
      ids.length === 0
        ? []
        : orm
            .select()
            .from(shots)
            .where(inArray(shots.id, [...ids]))
            .all(),
  };
}

/** Phase 1's form of a shot list (start and duration), as a TimeRange. */
export function toRange(shot: { readonly start: StoredTime; readonly duration: StoredTime }): TimeRange {
  return TimeRange.of(shot.start, shot.duration);
}

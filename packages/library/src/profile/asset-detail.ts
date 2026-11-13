// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One asset in full (`library.asset`, the asset page and the agent's
 * getAsset): the asset profile (R4) is not a table of its own but the asset
 * row, its shots and their analyses, its transcript, locations and stage
 * states, read together here.
 */
import {
  INDEX_STAGE_STATES,
  ok,
  publicErrorSchema,
  REENCODE_SIGNALS,
  type AssetDetail,
  type AssetId,
  type Result,
  type ShotAnalysis,
  type ShotDetail,
} from '@taalcut/core';
import { asc, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { readBeatMap, readFacts } from '../repositories/asset-facts';
import { createShotRepository, shotAnalysis } from '../repositories/shots';
import { found } from '../repositories/shared';
import { storedTranscript } from '../repositories/transcript-text';
import { assetLocations, assets, sources } from '../schema/library';
import { milestoneOf, readStageRegistry } from '../indexing/stage-registry';
import { DEFAULT_STAGE_ORDER } from '../indexing/status';
import { assetIndexStages } from '../schema/media';
import { contactSheetOf } from './asset-contact-sheet';
import { filmstripOf } from './asset-filmstrip';
import { playbackOf } from './asset-playback';
import { stageProgress } from './stage-progress';
import { assetSummaries, shotSummaries } from './summaries';

/**
 * The detail as the database alone knows it: everything but the clip's sound, which lives in the media cache
 * (`withWaveform` adds it for `library.asset`). The agent's getAsset reads this.
 */
export type StoredAssetDetail = Omit<AssetDetail, 'waveform'>;

const MAX_LINES = 500;
const MAX_SHOTS = 5000;

export function assetDetail(db: LibraryDatabase, id: AssetId): Result<StoredAssetDetail> {
  const { orm } = db;
  const row = found(orm.select().from(assets).where(eq(assets.id, id)).get(), 'asset', id);
  if (!row.ok) return row;
  const asset = row.value;
  const [summary] = assetSummaries(db, [asset]);
  const shotRows = createShotRepository(db).listByAsset(id).slice(0, MAX_SHOTS);
  const summaries = shotSummaries(db, shotRows);
  const shots: ShotDetail[] = shotRows.map((shot) => ({
    ...summaries.get(shot.id)!,
    analysis: withoutSignals(shotAnalysis(shot)),
    transcriptText: shot.transcriptText,
    duplicateGroup: shot.duplicateGroup,
  }));
  const transcript = storedTranscript(db, id);
  const locations = orm
    .select({
      id: assetLocations.id,
      sourceId: assetLocations.sourceId,
      sourceName: sources.displayName,
      storage: assetLocations.storage,
      state: assetLocations.state,
      relativePath: assetLocations.relativePath,
      volumeName: sources.volumeName,
    })
    .from(assetLocations)
    .innerJoin(sources, eq(sources.id, assetLocations.sourceId))
    .where(eq(assetLocations.assetId, id))
    .orderBy(asc(assetLocations.storage), asc(assetLocations.id))
    .limit(20)
    .all();
  const registry = readStageRegistry(db);
  // In pipeline order, as the clip page lists them (unknown stages after, by name).
  const order: readonly string[] = registry.order.length > 0 ? registry.order : DEFAULT_STAGE_ORDER;
  const place = (stage: string) => {
    const at = order.indexOf(stage);
    return at < 0 ? order.length : at;
  };
  const stageRows = orm
    .select()
    .from(assetIndexStages)
    .where(eq(assetIndexStages.assetId, id))
    .orderBy(asc(assetIndexStages.stage))
    .limit(32)
    .all()
    .filter((s) => (INDEX_STAGE_STATES as readonly string[]).includes(s.state));
  // LIB1-PROG: each stage's job, saved progress, start and usual length on this Mac.
  const progress = stageProgress(db, stageRows);
  const stages = stageRows
    .map((s) => {
      const error = s.error == null ? undefined : publicErrorSchema.safeParse(s.error);
      // A reason shows only where it still applies: a stage that ran (or failed) has its own outcome.
      const waits = s.state === 'skipped' || s.state === 'waiting';
      const reason = waits && s.reasonKey ? s.reasonKey.slice(0, 120) : undefined;
      return {
        stage: s.stage,
        state: s.state,
        ...milestoneOf(registry, s.stage),
        ...(error?.success ? { error: error.data } : {}),
        ...(reason ? { reasonKey: reason } : {}),
        ...progress.get(s.stage),
      };
    })
    .sort((a, b) => place(a.stage) - place(b.stage) || a.stage.localeCompare(b.stage));
  const reasons = (asset.reencodeReasons ?? []).filter((r): r is (typeof REENCODE_SIGNALS)[number] =>
    (REENCODE_SIGNALS as readonly string[]).includes(r),
  );
  const facts = readFacts(asset);
  return ok({
    asset: summary!,
    facts,
    shots,
    transcript: transcript
      ? {
          language: transcript.language,
          lines: transcript.segments.slice(0, MAX_LINES).map((s) => ({
            text: s.text,
            range: s.range,
            ...(s.speaker ? { speaker: s.speaker } : {}),
          })),
          truncated: transcript.segments.length > MAX_LINES,
        }
      : null,
    locations,
    reencodeReasons: reasons.slice(0, 8),
    stages,
    playback: playbackOf(db, id, facts),
    filmstrip: filmstripOf(db, id),
    contactSheet: contactSheetOf(db, id),
    beats: readBeatMap(asset),
    sizeBytes: asset.sizeBytes,
  });
}

/** The analysis without casting's curves: the asset page and the agent's getAsset never show them. */
function withoutSignals(analysis: ShotAnalysis | null): ShotAnalysis | null {
  if (!analysis?.signals) return analysis;
  const { signals: _signals, ...rest } = analysis;
  return rest;
}

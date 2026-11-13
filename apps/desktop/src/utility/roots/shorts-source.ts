// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  CancelledError,
  err,
  FrameRate,
  NotFoundError,
  ok,
  RationalTime,
  TimeRange,
  ValidationError,
  type AssetId,
  type Container,
} from '@taalcut/core';
import { createRepositories, shotRange } from '@taalcut/library';
import { extractFrame } from '@taalcut/media';
import type { ShortsSourcePort } from '@taalcut/shorts';
import { renderAssetFiles } from '../../shared/render-ports';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import { mediaBinaries } from './media-jobs';
import { awaitShortsSourceReady } from './shorts-import-wait';

/** Complete source evidence, without the asset-details response's transcript truncation. */
export function shortsSource(container: Container): ShortsSourcePort {
  const db = container.resolve(LibraryDatabaseToken);
  const repos = createRepositories(db);
  const read = (assetId: AssetId) => {
    const asset = repos.assets.get(assetId);
    if (!asset.ok) return asset;
    if (asset.value.trashedAt || asset.value.kind !== 'video')
      return err(NotFoundError({ entity: 'video', id: assetId }));
    return asset;
  };
  return {
    async describe(assetId, signal) {
      if (signal?.aborted) return err(CancelledError());
      const ready = await awaitShortsSourceReady(db, assetId, signal ?? new AbortController().signal);
      if (!ready.ok) return ready;
      const found = read(assetId);
      if (!found.ok) return found;
      const asset = found.value;
      if (!asset.durationValue || !asset.durationRateNum || !asset.durationRateDen)
        return err(
          ValidationError({ field: 'assetId' }, { detail: 'The source must finish media indexing first' }),
        );
      const stages = db.driver
        .prepare(
          'SELECT stage, state, output_digest FROM asset_index_stages WHERE asset_id = ? ORDER BY stage',
        )
        .all(assetId);
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            generation: asset.generation,
            stages: stages
              .filter((row) => /transcript|shots|analyse|describe|ocr/.test(String(row.stage)))
              .map((row) => [row.stage, row.output_digest]),
            transcript: repos.transcripts.get(assetId),
            shots: repos.shots
              .listByAsset(assetId)
              .map((shot) => [
                shot.id,
                shotRange(shot),
                shot.analysis,
                shot.description,
                shot.onScreenText,
                shot.transcriptText,
              ]),
          }),
        )
        .digest('hex');
      return ok({
        contentHash: asset.contentHash ?? `${assetId}:${asset.sizeBytes}:${asset.generation}`,
        analysisVersion: digest,
        duration: RationalTime.of(
          asset.durationValue,
          FrameRate.of(asset.durationRateNum, asset.durationRateDen),
        ),
        hasAudio: asset.hasAudio ?? false,
      });
    },
    async transcript(assetId, fromSegment, limit, signal) {
      if (signal?.aborted) return err(CancelledError());
      const found = read(assetId);
      return found.ok ? ok(repos.transcripts.page(assetId, fromSegment, limit)) : found;
    },
    async visuals(assetId, from, limit, signal) {
      if (signal?.aborted) return err(CancelledError());
      const found = read(assetId);
      if (!found.ok) return found;
      const shots = repos.shots.listByAsset(assetId);
      const page = shots.slice(from, from + limit);
      return ok({
        items: page.map((shot) => ({
          id: shot.id,
          range: shotRange(shot),
          description: [shot.description, shot.objects, shot.transcriptText].filter(Boolean).join('\n'),
          ...(shot.onScreenText ? { onScreenText: shot.onScreenText } : {}),
        })),
        ...(from + page.length < shots.length ? { next: from + page.length } : {}),
      });
    },
    async frames(assetId, ranges, signal) {
      if (signal?.aborted) return err(CancelledError());
      const original = await renderAssetFiles(container).original(assetId);
      if (!original.ok) return original;
      if (!original.value) return err(NotFoundError({ entity: 'asset', id: assetId }));
      const binaries = await mediaBinaries(container.resolve(UtilityConfigToken)).resolve();
      if (!binaries.ok) return binaries;
      const frames = [];
      for (const range of ranges.slice(0, 6)) {
        const at = RationalTime.add(
          range.start,
          RationalTime.of(Math.floor(range.duration.value / 2), range.duration.rate),
        );
        const frame = await extractFrame(
          original.value.path,
          { value: RationalTime.toFrames(at, FrameRate.of(1000)), rate: 1000 },
          { binaries: binaries.value },
          { format: 'jpeg', maxDimension: 768, signal },
        );
        if (!frame.ok) return frame;
        frames.push({
          at,
          data: Buffer.from(frame.value.data).toString('base64'),
          mimeType: 'image/jpeg' as const,
        });
      }
      return ok(frames);
    },
  };
}

export function shortsSourceRanges(container: Container, assets: readonly AssetId[]) {
  const repos = createRepositories(container.resolve(LibraryDatabaseToken));
  const result = new Map<AssetId, { available: TimeRange }>();
  for (const id of new Set(assets)) {
    const found = repos.assets.get(id);
    if (!found.ok) return found;
    const asset = found.value;
    if (!asset.durationValue || !asset.durationRateNum || !asset.durationRateDen)
      return err(ValidationError({ field: 'assetId' }));
    const duration = RationalTime.of(
      asset.durationValue,
      FrameRate.of(asset.durationRateNum, asset.durationRateDen),
    );
    result.set(id, { available: TimeRange.of(RationalTime.zero(duration.rate), duration) });
  }
  return ok(result);
}

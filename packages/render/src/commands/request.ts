// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An export request's defaults and checks, its dedupe key and its render's default display name. */
import { createHash } from 'node:crypto';
import {
  ConflictError,
  err,
  ok,
  type ExportPresetId,
  type ExportRequest,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { CodecUnavailable, DurationOutOfRange, UnsupportedFrameRate } from '../errors';
import { planTimeline } from '../plan/render-plan';
import { timelineAtExportRate } from '../plan/export-rate';
import { presetAvailability, presetFor, presetInCodec } from '../presets/presets.v1';
import { rateLabel } from '../time/frames';

/** Plain-text preset names for a render's default display name (the UI shows `render.presets.<id>`). */
export const PRESET_NAMES: Readonly<Record<ExportPresetId, string>> = {
  shorts: 'YouTube Shorts',
  reels: 'Instagram Reels',
  tiktok: 'TikTok',
  device: 'Camera roll',
  deviceHevc: 'Camera roll (HEVC)',
  landscape: 'Landscape',
  standard: 'Standard (4:3)',
  youtubeAv1: 'YouTube Shorts (AV1)',
  deviceAv1: 'Camera roll (AV1)',
  square: 'Square (1:1)',
  portrait: 'Portrait (4:5)',
  square2160: '2160p master (1:1)',
  portrait2160: '2160p master (4:5)',
  master4k: '4K master (9:16)',
  landscape4k: '4K master (16:9)',
};

/**
 * What makes two exports the same: the timeline revision, preset, its codec, rate, caption output, what it
 * replaces, Content Credentials, the bumpers and the batch. Notify and the name don't change the file, so they don't
 * count. `request` is resolved (timelineRevision and rate set).
 */
export function exportRequestKey(request: ExportRequest): string {
  const canonical = JSON.stringify([
    request.projectId,
    request.timelineId,
    request.timelineRevision ?? null,
    request.presetId,
    request.rate ? [request.rate.num, request.rate.den] : null,
    request.captions.burnIn,
    [...request.captions.sidecars].sort(),
    request.supersedes ?? null,
    // Phase 3 options join only when they differ from the defaults, so a Phase 2 request keeps its key.
    ...(request.contentCredentials.add ? ['credentials'] : []),
    ...(request.includeBumpers ? [] : ['noBumpers']),
    // A batch is its own queue: a retry of the batch dedupes, another batch renders again.
    ...(request.batchId ? [request.batchId] : []),
    // LNX1-AV1: a codec other than the preset's default (HEVC for Reels) is another file.
    ...(request.codec && request.codec !== presetFor(request.presetId).video.codec
      ? [`codec:${request.codec}`]
      : []),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** The request's name, or '<timeline> – <preset>' cut to the snapshot's 200 characters. */
export function renderName(request: ExportRequest, timelineName: string): string {
  if (request.name) return request.name;
  const preset = PRESET_NAMES[request.presetId];
  const base = timelineName.trim() || 'Untitled';
  return `${base.slice(0, 200 - preset.length - 3)} – ${preset}`;
}

/** The request with its defaults resolved, checked against the timeline and the preset. */
export function resolveExportRequest(
  request: ExportRequest,
  timeline: Timeline,
): Result<{ request: ExportRequest; frames: number }> {
  const revision = request.timelineRevision ?? timeline.revision;
  if (revision !== timeline.revision) return err(ConflictError({ entity: 'timeline', id: timeline.id }));
  const rate = request.rate ?? timeline.canvas.rate;
  const sampled = timelineAtExportRate(timeline, rate);
  if (!sampled.ok) return sampled;
  const plan = planTimeline(sampled.value);
  if (!plan.ok) return plan;
  const preset = presetInCodec(presetFor(request.presetId), request.codec);
  if (!preset)
    return err(
      CodecUnavailable(
        { codec: request.codec ?? '' },
        { detail: `${request.presetId} has no ${request.codec}` },
      ),
    );
  const fits = presetAvailability(preset, rate, plan.value.durationFrames);
  if (!fits.available) {
    if (fits.reasonKey === 'render.unavailable.frameRate')
      return err(UnsupportedFrameRate({ rate: rateLabel(rate) }));
    const { minSeconds, maxSeconds } = preset.duration;
    return err(DurationOutOfRange({ presetId: preset.id, minSeconds, maxSeconds }));
  }
  return ok({ request: { ...request, timelineRevision: revision, rate }, frames: plan.value.durationFrames });
}

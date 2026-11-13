// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* eslint-disable lingui/no-unlocalized-strings -- render names: data, as the render process writes them */
import type { ExportPresetId, RenderSnapshot, Timeline } from '@taalcut/core';
import { framesOf } from './build';

type Given = Pick<
  RenderSnapshot,
  'id' | 'projectId' | 'presetId' | 'status' | 'name' | 'captions' | 'notify'
>;

/** A new render of a timeline as the render process records it: 9:16 at the timeline's rate, nothing done yet. */
export function renderSnapshot(timeline: Timeline, fields: Given & Partial<RenderSnapshot>): RenderSnapshot {
  return {
    timelineId: timeline.id,
    timelineRevision: timeline.revision,
    jobId: null,
    progress: null,
    width: 1080,
    height: 1920,
    rate: timeline.canvas.rate,
    durationFrames: framesOf(timeline),
    bytes: null,
    music: timeline.music.path,
    qa: null,
    supersedes: null,
    error: null,
    credentials: { added: false, state: null },
    batchId: null,
    createdAt: Date.now(),
    finishedAt: null,
    deletedAt: null,
    ...fields,
  };
}

/**
 * The English name a render gets by default ("<project> – <preset>"): data, as the render process writes it
 * (packages/render's PRESET_NAMES; UX3-MAC: the same on every OS, so no "This Mac" on Linux).
 */
export function presetName(id: ExportPresetId): string {
  return {
    reels: 'Instagram Reels',
    shorts: 'YouTube Shorts',
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
  }[id];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ExportPresetId, MusicPath, QaSummary } from '@taalcut/core';

/** Export presets by their `labelKey` ('render.presets.<id>'): platform names kept as written. */
export const PRESET_LABELS: Readonly<Record<ExportPresetId, MessageDescriptor>> = {
  shorts: msg({
    id: 'render.presets.shorts',
    message: 'YouTube Shorts',
    comment: 'Brand name: keep as written.',
  }),
  reels: msg({
    id: 'render.presets.reels',
    message: 'Instagram Reels',
    comment: 'Brand name: keep as written.',
  }),
  tiktok: msg({ id: 'render.presets.tiktok', message: 'TikTok', comment: 'Brand name: keep as written.' }),
  // The render lane's words (apps/renderer render-messages.ts): one id, one English.
  device: msg({ id: 'render.presets.device', message: 'Save to this Mac' }),
  deviceHevc: msg({ id: 'render.presets.deviceHevc', message: 'Save to this Mac (smaller file)' }),
  // P3-V2's canvases (core C-24); the render lane renders them.
  landscape: msg({ id: 'render.presets.landscape', message: 'Landscape (16:9)' }),
  standard: msg({ id: 'render.presets.standard', message: 'Standard (4:3)' }),
  square: msg({ id: 'render.presets.square', message: 'Square (1:1)' }),
  portrait: msg({ id: 'render.presets.portrait', message: 'Portrait (4:5)' }),
  square2160: msg({ id: 'render.presets.square2160', message: '2160p master (1:1)' }),
  portrait2160: msg({ id: 'render.presets.portrait2160', message: '2160p master (4:5)' }),
  master4k: msg({ id: 'render.presets.master4k', message: '4K master (9:16)' }),
  landscape4k: msg({ id: 'render.presets.landscape4k', message: '4K master (16:9)' }),
  // LNX1-AV1: offered where the machine encodes AV1 in hardware.
  youtubeAv1: msg({
    id: 'render.presets.youtubeAv1',
    message: 'YouTube Shorts (AV1)',
    comment: 'YouTube Shorts is a brand name: keep as written. AV1 is a video format.',
  }),
  deviceAv1: msg({
    id: 'render.presets.deviceAv1',
    message: 'Save to this computer (AV1)',
    comment: 'AV1 is a video format.',
  }),
};

/**
 * The music paths (PRD G5), as the export card says them. Since REF1 (2026-10-29) the reel's music is the default
 * and no music is the choice you turn off, so neither carries "recommended".
 */
export const MUSIC_LABELS: Readonly<Record<MusicPath, MessageDescriptor>> = {
  none: msg`Original sound, no added music`,
  platformSound: msg`No music in the file: add the sound in the app`,
  ownTrack: msg`Your own track`,
  referenceAudio: msg`The reel’s music`,
  generated: msg`Music made for this video`,
};

/** The counts for "Checked: 18 of 19 passed", the QA line every export card and render shows (gate criterion 4). */
export function qaTotals(qa: QaSummary): { passed: number; total: number } {
  return { passed: qa.passed + qa.fixed, total: qa.passed + qa.fixed + qa.warned + qa.failed };
}

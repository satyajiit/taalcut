// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ImportStatus } from '@taalcut/core';

/**
 * What each indexing stage is doing, in a creator's words (the library
 * SPEC's recommended stages). A stage without words here reads "Working".
 */
export const IMPORT_STAGE_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'library.hash': msg`Copying`,
  'media.normalise': msg`Preparing`,
  'media.thumbnail': msg`Making thumbnails`,
  'media.previews': msg`Making previews`,
  'media.proxy': msg`Making previews`,
  'media.filmstrip': msg`Making previews`,
  'library.place': msg`Naming the place`,
  'vision.shots': msg`Finding shots`,
  'vision.analyse': msg`Looking at each shot`,
  'vision.ocr': msg`Reading the text on screen`,
  'audio.language': msg`Listening`,
  'audio.transcript': msg`Writing down speech`,
  'vision.embed': msg`Indexing for search`,
  'vision.embedOcr': msg`Indexing on-screen text for search`,
  'vision.embedText': msg`Indexing speech for search`,
  'vision.contactSheet': msg`Making previews`,
  'vision.describe': msg`Describing`,
  'audio.beats': msg`Finding the beat`,
};

const WORKING = msg`Working`;

export function importStageLabel(i18n: I18n, stage: string): string {
  return i18n._(IMPORT_STAGE_LABELS[stage] ?? WORKING);
}

/** The stage the import is in now: the first with work left, in pipeline order. */
export function currentStage(status: ImportStatus): string | null {
  return status.stages.find((stage) => stage.left > 0)?.stage ?? null;
}

/** How far through: clips done over clips in this import. */
export function importFraction(status: ImportStatus): number {
  const { assets, done } = status.counts;
  return assets > 0 ? Math.min(1, done / assets) : 0;
}

/**
 * How far to the first finish line (round IX): clips search can find over clips in this import, never behind
 * the clips done. Null when the status predates the searchable count.
 */
export function searchableFraction(status: ImportStatus): number | null {
  const { assets, searchable } = status.counts;
  if (searchable === undefined) return null;
  return assets > 0 ? Math.min(1, Math.max(searchable, status.counts.done) / assets) : 0;
}

/** Every clip in the import can be searched, while deeper analysis may carry on. */
export function everySearchable(status: ImportStatus): boolean {
  const { assets, searchable } = status.counts;
  return searchable !== undefined && assets > 0 && searchable >= assets;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake pipeline's stages, in order (the library lane names them; these
 * are the fake's), and what a clip has once it is past one of them. A fake
 * clip's `index.done` counts finished stages from the top of this list.
 */
export const FAKE_STAGES = [
  'library.hash',
  'media.normalise',
  'media.thumbnail',
  'vision.shots',
  'vision.analyse',
  'vision.ocr',
  'vision.embed',
  'vision.embedOcr',
  'audio.language',
  'audio.transcript',
  'vision.embedText',
  'vision.describe',
] as const;

export type FakeStage = (typeof FAKE_STAGES)[number];

/** Each fake stage's finish line: descriptions count toward complete only (IX design C). */
export const fakeMilestoneOf = (stage: FakeStage) =>
  stage === 'vision.describe' ? ('complete' as const) : ('searchable' as const);

/** The `index.done` count at which a clip is past `stage`. */
export const doneAfter = (stage: FakeStage): number => FAKE_STAGES.indexOf(stage) + 1;

/** Every searchable stage comes before descriptions: past them, search finds the clip. */
export const SEARCHABLE_STAGES = FAKE_STAGES.indexOf('vision.describe');

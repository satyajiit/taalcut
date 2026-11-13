// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-R2: the finish line each registered stage counts toward (IX design C) and the priority that follows from it.
 * Searchable stages (what search reads: identity, facts, the thumbnail, shots, on-screen text, speech, vectors) run
 * at normal priority; the rest (proxy, beats, descriptions) at low, so every file becomes searchable before deeper
 * analysis takes the machine. No searchable stage may need a complete-only one (core's check).
 */
import { checkIndexStageMilestones, createMemorySettingsStore, indexStageMilestone } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { indexStageWiring } from '../src/utility/roots/index-stages';

/**
 * Design C's searchable stages, including those other lanes add (media's thumbnail, vision's speech embeddings, the
 * OCR lane's two stages): each one that is registered must be searchable. `media.previews` makes the thumbnail, so
 * it is searchable until media splits `media.thumbnail` out of it.
 */
const SEARCHABLE = new Set([
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
]);

describe('index stage milestones', () => {
  const { stages } = indexStageWiring({
    tier: async () => 'recommended',
    settings: createMemorySettingsStore,
  });

  it('marks design C’s stages searchable and every other stage complete', () => {
    const names = new Set(stages.map((stage) => stage.stage));
    const designC = (name: string) =>
      SEARCHABLE.has(name) || (name === 'media.previews' && !names.has('media.thumbnail'));
    expect(stages.map((stage) => [stage.stage, indexStageMilestone(stage)])).toEqual(
      stages.map((stage) => [stage.stage, designC(stage.stage) ? 'searchable' : 'complete']),
    );
    // Every stage names its line: none relies on the default.
    expect(stages.filter((stage) => stage.milestone === undefined)).toEqual([]);
  });

  it('runs searchable stages at normal priority and complete-only stages at low', () => {
    expect(stages.map((stage) => [stage.stage, indexStageMilestone(stage), stage.priority])).toEqual(
      stages.map((stage) => [
        stage.stage,
        indexStageMilestone(stage),
        indexStageMilestone(stage) === 'searchable' ? 'normal' : 'low',
      ]),
    );
  });

  it('never makes a searchable stage wait for a complete-only one', () => {
    expect(() => checkIndexStageMilestones(stages)).not.toThrow();
  });
});

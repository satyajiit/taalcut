// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { aiInventory } from '../../src/credentials/ai-inventory';
import { ACTIONS_LABEL, DIGITAL_SOURCE_TYPES, exportManifest } from '../../src/credentials/manifest';
import { partsTimeline, type PartsSpec } from './support';

function manifestFor(
  spec: PartsSpec,
  options: { singleClipNoEdits?: boolean; signed?: (ids: string[]) => Map<string, string> } = {},
) {
  const { timeline, provenanceOf } = partsTimeline(spec);
  const inventory = aiInventory(timeline, provenanceOf);
  const ids = inventory.parts.map((part) => part.id);
  return {
    inventory,
    manifest: exportManifest({
      title: 'Taalcut export',
      generatorVersion: '0.1.0',
      inventory,
      singleClipNoEdits: options.singleClipNoEdits ?? false,
      signedSources: options.signed?.(ids) ?? new Map(),
    }),
  };
}

interface Action {
  readonly action: string;
  readonly digitalSourceType?: string;
  readonly parameters?: { readonly ingredientIds: readonly string[] };
}

const actionsOf = (definition: Record<string, unknown>): Action[] => {
  const assertions = definition.assertions as { label: string; data: { actions: Action[] } }[];
  expect(assertions.map((assertion) => assertion.label)).toEqual([ACTIONS_LABEL]);
  return assertions[0]?.data.actions ?? [];
};

describe('exportManifest', () => {
  it('says "composite of captures" for a timeline no model touched, with no ingredients', () => {
    const { manifest } = manifestFor({ clips: [false, false], music: 'ownTrack' });
    const actions = actionsOf(manifest.definition);
    expect(actions).toEqual([
      {
        action: 'c2pa.created',
        softwareAgent: { name: 'Taalcut', version: '0.1.0' },
        digitalSourceType: DIGITAL_SOURCE_TYPES.compositeCapture,
      },
    ]);
    expect(manifest.definition.ingredients).toEqual([]);
    expect(manifest.digitalSourceTypes).toEqual([DIGITAL_SOURCE_TYPES.compositeCapture]);
  });

  it('marks a mix with generated parts compositeSynthetic and places each generated part', () => {
    const { manifest } = manifestFor({
      clips: [false, true],
      voice: [false],
      voiceoverLines: [0],
      music: 'ownTrack',
    });
    const actions = actionsOf(manifest.definition);
    expect(actions[0]?.digitalSourceType).toBe(DIGITAL_SOURCE_TYPES.compositeSynthetic);
    expect(actions.slice(1)).toEqual([
      {
        action: 'c2pa.placed',
        parameters: { ingredientIds: ['clip-2'] },
        digitalSourceType: DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia,
      },
      {
        action: 'c2pa.placed',
        parameters: { ingredientIds: ['voiceover-1'] },
        digitalSourceType: DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia,
      },
    ]);
    expect(manifest.definition.ingredients).toEqual([
      { title: 'clip 2', relationship: 'componentOf', label: 'clip-2' },
      { title: 'voiceover 1', relationship: 'componentOf', label: 'voiceover-1' },
    ]);
  });

  it('uses trainedAlgorithmicMedia only when a model made every visual and audible part', () => {
    expect(
      actionsOf(manifestFor({ clips: [true, true], music: 'generated' }).manifest.definition)[0]
        ?.digitalSourceType,
    ).toBe(DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia);
    expect(
      actionsOf(manifestFor({ clips: [true, true], music: 'ownTrack' }).manifest.definition)[0]
        ?.digitalSourceType,
    ).toBe(DIGITAL_SOURCE_TYPES.compositeSynthetic);
  });

  it('opens and transcodes a single captured clip with no edits, its clip the parent', () => {
    const { manifest } = manifestFor({ clips: [false] }, { singleClipNoEdits: true });
    expect(actionsOf(manifest.definition).map((action) => action.action)).toEqual([
      'c2pa.opened',
      'c2pa.transcoded',
    ]);
    expect(manifest.definition.ingredients).toEqual([
      { title: 'clip 1', relationship: 'parentOf', label: 'clip-1' },
    ]);
    expect(manifest.digitalSourceTypes).toEqual([]);
  });

  it('never calls a generated single clip a plain transcode', () => {
    const { manifest } = manifestFor({ clips: [true] }, { singleClipNoEdits: true });
    const actions = actionsOf(manifest.definition);
    expect(actions[0]).toMatchObject({
      action: 'c2pa.created',
      digitalSourceType: DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia,
    });
  });

  it('reads a source that carries its own credentials from its file, so its store travels', () => {
    const { manifest } = manifestFor(
      { clips: [false, false] },
      { signed: (ids) => new Map([[ids[1] ?? '', '/library/originals/provider-shot.mp4']]) },
    );
    expect(manifest.ingredients).toEqual([
      {
        path: '/library/originals/provider-shot.mp4',
        title: 'clip 2',
        relationship: 'componentOf',
        label: 'clip-2',
      },
    ]);
    expect(manifest.definition.ingredients).toEqual([]);
    expect(actionsOf(manifest.definition)[1]).toEqual({
      action: 'c2pa.placed',
      parameters: { ingredientIds: ['clip-2'] },
    });
  });

  it('puts no file names, paths or ids in what it signs', () => {
    const { manifest, inventory } = manifestFor(
      { clips: [true, false], voice: [true], music: 'generated' },
      { signed: (ids) => new Map([[ids[1] ?? '', '/Users/someone/Movies/holiday-in-goa.mov']]) },
    );
    const text = JSON.stringify(manifest.definition);
    expect(text).not.toMatch(/\/Users|holiday|\.mov|\.mp4/);
    // Item ids are ULIDs ('music' is the music part's id and title alike).
    for (const part of inventory.parts.filter((entry) => entry.kind !== 'music')) {
      expect(text).not.toContain(part.id);
      if (part.assetId) expect(text).not.toContain(part.assetId);
    }
    expect(manifest.definition.title).toBe('Taalcut export');
  });

  it('calls a text-only export a digital creation', () => {
    const { manifest } = manifestFor({ clips: [] });
    expect(actionsOf(manifest.definition)[0]?.digitalSourceType).toBe(DIGITAL_SOURCE_TYPES.digitalCreation);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-STY's contract: set keys, the profile, its summary and view, the command, the entity, the QA id, the reads. */
import { describe, expect, it } from 'vitest';
import {
  appContract,
  LIBRARY_ENTITIES,
  newId,
  parseStyleSourceKey,
  QA_CHECK_IDS,
  STYLE_PROFILE_COMMANDS,
  styleProfileCommandPayloads,
  styleProfileSchema,
  styleProfileSummarySchema,
  styleProfileViewSchema,
  styleSourceKey,
  type StyleProfile,
  type StyleSource,
} from '../src';

const band = { n: 4, q1: 0.8, median: 1.2, q3: 1.9 };

const profile: StyleProfile = {
  algorithm: 'style-profile.v1',
  members: 4,
  pacing: { shot: band, cutsOnBeat: 0.625, withBeats: 3, shotsInFirst3s: { n: 4, q1: 2, median: 3, q3: 3 } },
  hook: {
    shotType: [
      { value: 'close', count: 3 },
      { value: 'unknown', count: 1 },
    ],
    duration: band,
    withText: 3,
    reveal: [{ value: 'pop', count: 3 }],
    role: [{ value: 'title', count: 3 }],
    textExamples: ['3 cafes you missed'],
  },
  mix: {
    transitions: [{ value: 'cut', count: 20 }],
    slots: 24,
    speedRamps: 2,
    rampCurves: [{ value: 'ease', count: 2 }],
  },
  overlays: {
    count: 9,
    withText: 3,
    position: [{ value: 'top', count: 9 }],
    size: [{ value: 'large', count: 9 }],
    reveal: [{ value: 'pop', count: 9 }],
    case: [{ value: 'mixed', count: 9 }],
    background: [{ value: 'box', count: 9 }],
    wordsPerLine: { n: 12, q1: 2, median: 3, q3: 4 },
  },
  audio: {
    kind: [{ value: 'music', count: 4 }],
    loudnessLufs: -14.2,
    energy: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.9, 0.8, 0.6],
  },
  form: { length: { n: 4, q1: 11, median: 14.5, q3: 18 }, aspect: [{ value: '9:16', count: 4 }] },
  exemplars: [{ id: newId<'Template'>(), version: 2 }],
  exemplarPool: 4,
  exemplarIndex: 'eg2_q4_daa72c5_tpl',
};

describe('LRN1-STY contract', () => {
  it('keys every kind of set and reads the key back', () => {
    const sources: StyleSource[] = [
      { kind: 'instagram-collection', collectionId: '17912345678901234' },
      { kind: 'folder', folderId: newId<'TemplateFolder'>() },
      { kind: 'tag', tag: 'travel-vlog' },
      { kind: 'my-exports' },
    ];
    for (const source of sources) expect(parseStyleSourceKey(styleSourceKey(source))).toEqual(source);
    expect(styleSourceKey({ kind: 'my-exports' })).toBe('my-exports');
  });

  it('reads only keys in their normal form', () => {
    expect(parseStyleSourceKey('tag:Travel Vlog')).toBeNull();
    expect(parseStyleSourceKey('tag:travel-vlog')).toEqual({ kind: 'tag', tag: 'travel-vlog' });
    for (const key of ['my-exports:x', 'folder:not-an-id', 'unknown:1', '', 'instagram-collection:', 'tag:'])
      expect(parseStyleSourceKey(key)).toBeNull();
  });

  it('parses a profile and refuses what breaks its shape', () => {
    expect(styleProfileSchema.parse(profile)).toEqual(profile);
    const ref = { id: newId<'Template'>(), version: 1 };
    const refused: unknown[] = [
      { ...profile, exemplars: [ref, ref, ref, ref] },
      { ...profile, audio: { ...profile.audio, energy: [0.5, 0.5] } },
      { ...profile, hook: { ...profile.hook, reveal: [{ value: 'pop', count: 0 }] } },
      { ...profile, hook: { ...profile.hook, reveal: [{ value: 'spin', count: 1 }] } },
      { ...profile, algorithm: 'style-profile.v0' },
    ];
    for (const value of refused) expect(styleProfileSchema.safeParse(value).success).toBe(false);
  });

  it('parses each summary state and refuses an incomplete one', () => {
    const states: unknown[] = [
      { state: 'writing', at: 1 },
      {
        state: 'written',
        text: 'Fast, bright hooks.',
        provider: 'local',
        model: 'qwen3.5-4b',
        local: true,
        at: 2,
      },
      { state: 'none', reason: 'no_model', at: 3 },
      { state: 'failed', error: { code: 'models.unavailable', messageKey: 'errors.models.unavailable', retryable: true }, at: 4 },
    ];
    for (const value of states) expect(styleProfileSummarySchema.safeParse(value).success).toBe(true);
    expect(
      styleProfileSummarySchema.safeParse({
        state: 'written',
        provider: 'local',
        model: 'm',
        local: true,
        at: 2,
      }).success,
    ).toBe(false);
    expect(styleProfileSummarySchema.safeParse({ state: 'none', reason: 'tired', at: 3 }).success).toBe(
      false,
    );
  });

  it('reads an empty set as a view with no profile', () => {
    const view = {
      source: { kind: 'my-exports' },
      name: null,
      profile: null,
      summary: { state: 'none', reason: 'empty', at: 0 },
      exemplars: [],
      builtAt: null,
    };
    expect(styleProfileViewSchema.safeParse(view).success).toBe(true);
    expect(styleProfileViewSchema.safeParse({ ...view, profile }).success).toBe(true);
  });

  it('makes a project like a set, or like none, through a command', () => {
    const use = styleProfileCommandPayloads[STYLE_PROFILE_COMMANDS.use];
    const projectId = newId<'Project'>();
    expect(STYLE_PROFILE_COMMANDS.use).toBe('styleProfile.use');
    expect(use.safeParse({ projectId, source: { kind: 'tag', tag: 'travel' } }).success).toBe(true);
    expect(use.safeParse({ projectId, source: null }).success).toBe(true);
    expect(use.safeParse({ source: null }).success).toBe(false);
  });

  it('adds the entity, the QA check and the two reads', () => {
    expect(LIBRARY_ENTITIES).toContain('styleProfile');
    expect(QA_CHECK_IDS.slice(30, 31)).toEqual(['stylePacing']);
    expect(appContract.templates.styleProfile).toBeDefined();
    expect(appContract.templates.writeStyleSummary).toBeDefined();
  });
});

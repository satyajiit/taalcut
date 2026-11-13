// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND: the committed clips and queries parse, every label names a clip the set has, and nothing committed
 * names an owner clip: a person's own clips live in the local owner set.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIP_LICENCES,
  clipFileSchema,
  isOwnerClip,
  loadClips,
  loadQueries,
  mergeQueries,
  type OwnerSet,
} from '../../../src/search/find/schema';

const DATA = join(import.meta.dirname, '../../../search-find');
const clips = loadClips(join(DATA, 'clips.json'));
const queries = loadQueries(join(DATA, 'queries.json'));
const ids = new Set(clips.clips.map((clip) => clip.id));

describe('search-find', () => {
  it('has about forty queries, each in a known language, naming clips the set has', () => {
    expect(queries.length).toBeGreaterThanOrEqual(40);
    for (const query of queries)
      for (const clip of query.relevant) expect(ids, `${query.id} → ${clip}`).toContain(clip);
    for (const language of ['en', 'hi', 'hi-Latn', 'es', 'pt-BR'])
      expect(queries.some((query) => query.language === language)).toBe(true);
  });

  it('asks the plan’s kinds of question: dance shots, a place, beach at sunset, someone talking to camera, slow motion', () => {
    const texts = new Set(queries.map((query) => query.text));
    for (const text of [
      'dance shots',
      'Vietnam',
      'beach at sunset',
      'someone talking to camera',
      'slow motion',
    ])
      expect(texts).toContain(text);
  });

  it('commits no owner clip: no owner- id in a label or an answer', () => {
    for (const clip of clips.clips) expect(isOwnerClip(clip.id)).toBe(false);
    for (const query of queries)
      for (const clip of query.relevant) expect(isOwnerClip(clip), query.id).toBe(false);
    expect(
      clipFileSchema.safeParse({ ...clips, clips: [{ ...clips.clips[0]!, id: 'owner-1' }] }).success,
    ).toBe(false);
  });

  it('adds an owner set’s answers to the committed queries and keeps the Commons ones apart', () => {
    const owner: OwnerSet = {
      v: 1,
      about: '',
      clips: [{ id: 'owner-1', shows: 'a made-up clip', file: 'x.mp4' }],
      relevant: { 'dance-shots': ['owner-1'] },
      queries: [{ id: 'my-trip', language: 'en', kind: 'place', text: 'my trip', relevant: ['owner-1'] }],
    };
    const merged = mergeQueries(queries, owner);
    const dance = merged.find((q) => q.query.id === 'dance-shots')!;
    expect(dance.query.relevant).toContain('owner-1');
    expect(dance.commons).not.toContain('owner-1');
    expect(merged.at(-1)).toEqual({ query: owner.queries[0], commons: [] });
    expect(() => mergeQueries(queries, { ...owner, relevant: { nope: ['owner-1'] } })).toThrow(
      /no committed query/,
    );
    expect(() =>
      mergeQueries(queries, { ...owner, queries: [{ ...owner.queries[0]!, id: 'dance' }] }),
    ).toThrow(/committed one/);
  });

  it('uses open licences only, each clip at most 10 s', () => {
    for (const clip of clips.clips) {
      expect(CLIP_LICENCES).toContain(clip.licence);
      expect(clip.seconds).toBeLessThanOrEqual(10);
    }
  });

  it('refuses a duplicate clip id', () => {
    const twice = { ...clips, clips: [...clips.clips, clips.clips[0]!] };
    expect(clipFileSchema.safeParse(twice).success).toBe(false);
  });
});

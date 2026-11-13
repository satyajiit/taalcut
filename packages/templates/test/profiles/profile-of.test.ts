// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * profileOf (LRN1-STY): a golden set's profile equals the one worked out by hand, a rerun is byte-identical in any
 * member order, and the digest moves only with what the profile was built from.
 *
 * The golden arithmetic (golden-set.ts, 30 fps):
 * - shots in seconds, sorted: 0.4 0.6 0.7 0.8 0.9 1.0 1.0 1.1 1.2 1.5 2.0 (n 11): q1 at rank 2.5 = 0.75, median at 5
 *   = 1.0, q3 at 7.5 = 1.15;
 * - cuts on beat: template 1 has 3 cuts all on the beat, template 2 has 2 at 0.5, template 3 no beat map:
 *   (3 + 1) / 5 = 0.8;
 * - shots starting in the first 3 s: 4, 3, 3, so q3 at rank 1.5 = 3.5;
 * - hook lengths 0.4, 0.9, 2.0: q1 0.65, q3 1.45; lengths 3.7, 2.7, 4.8 s: q1 3.2, q3 4.25;
 * - words per line 3, 4, 1, 3: q1 2.5, median 3, q3 3.25; loudness median of -14 and -18 = -16;
 * - energy: (0.2 … 1 … 0.2) and a flat 0.8 (all ones once scaled), median per tenth = their mean;
 * - slot centroids (1, 0), (0.8, 0.6), (0, 1): template 2 has the least total distance (0.2 + 0.4), so it is the
 *   one exemplar (⌈3 / 4⌉ = 1), and its hook text is the example.
 */
import { styleProfileSchema, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { profileOf, styleProfileDigest, styleProfileJson } from '../../src/profiles/profile-of';
import { profileFacts } from '../../src/profiles/profile-facts';
import { GOLDEN_INDEX, GOLDEN_PROFILE, goldenTemplates, goldenVectors } from './golden-set';

const golden = (templates: readonly Template[] = goldenTemplates()) =>
  profileOf(templates, { index: GOLDEN_INDEX, sets: goldenVectors() });

describe('profileOf', () => {
  it('matches the hand-computed profile of the golden set', () => {
    const profile = golden();
    expect(profile).toEqual(GOLDEN_PROFILE);
    expect(styleProfileSchema.parse(profile)).toEqual(GOLDEN_PROFILE);
  });

  it('is byte-identical on rerun and in any member order', () => {
    const first = styleProfileJson(golden() ?? GOLDEN_PROFILE);
    const reversed = styleProfileJson(golden([...goldenTemplates()].reverse()) ?? GOLDEN_PROFILE);
    const again = styleProfileJson(golden() ?? GOLDEN_PROFILE);
    expect(reversed).toBe(first);
    expect(again).toBe(first);
    // Canonical: keys sorted at every level.
    expect(first.startsWith('{"algorithm":"style-profile.v1","audio":')).toBe(true);
  });

  it('has no exemplars while the template index is closed, and none for members it lacks', () => {
    const closed = profileOf(goldenTemplates(), null);
    expect(closed?.exemplars).toEqual([]);
    expect(closed?.exemplarPool).toBe(0);
    expect(closed?.exemplarIndex).toBeNull();
    expect(closed?.hook.textExamples).toEqual([]);
    const partial = profileOf(goldenTemplates(), { index: GOLDEN_INDEX, sets: goldenVectors().slice(2) });
    expect(partial?.exemplarPool).toBe(1);
    expect(partial?.exemplars.map((ref) => ref.id)).toEqual([goldenTemplates()[2]?.id]);
    // Template 3 opens without text: no example.
    expect(partial?.hook.textExamples).toEqual([]);
  });

  it('profiles nothing for an empty set', () => {
    expect(profileOf([], null)).toBeNull();
  });

  it('moves the digest with a member, a version or the index, and not with order', () => {
    const refs = goldenTemplates().map((template) => ({ id: template.id, version: template.version }));
    const digest = styleProfileDigest(refs, GOLDEN_INDEX);
    expect(styleProfileDigest([...refs].reverse(), GOLDEN_INDEX)).toBe(digest);
    expect(styleProfileDigest(refs.slice(1), GOLDEN_INDEX)).not.toBe(digest);
    expect(
      styleProfileDigest(
        refs.map((ref, i) => (i === 0 ? { ...ref, version: 2 } : ref)),
        GOLDEN_INDEX,
      ),
    ).not.toBe(digest);
    expect(styleProfileDigest(refs, null)).not.toBe(digest);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('says the profile in plain words without any reference text', () => {
    const facts = profileFacts(GOLDEN_PROFILE);
    expect(facts[0]).toBe('Videos profiled: 3.');
    expect(facts.join('\n')).toContain('Shots: median 1 s long (middle half 0.75 s to 1.15 s)');
    expect(facts.join('\n')).toContain('Cuts on the beat: 80% of cuts');
    expect(facts.join('\n')).toContain('cut 63%, whip 25%, dissolve 13%');
    expect(facts.join('\n')).not.toContain('Wait for it');
  });
});

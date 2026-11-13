// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap, ValidationError, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { OBJECT_SEPARATOR, shotAnalysis } from '../../src/index';
import { analysisFor, at24, profileSetup, range24, transcriptOf } from './profile-helpers';

describe('ShotRepository: re-detection and analyses (P2-L1)', () => {
  it('keeps a ShotId when its start is within one frame, and its analysis while its length holds', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    const [a, b, c] = unwrap(
      repos.shots.replaceForAsset(id, 0, [range24(0, 48), range24(48, 48), range24(96, 48)]),
    );
    unwrap(
      repos.shots.putAnalyses(
        [a!, b!, c!].map((shotId, i) => ({ shotId, analysis: analysisFor(range24(i * 48, 48)) })),
      ),
    );

    // Shot b now starts a fraction of a frame later at another rate and keeps its length; c is split in two.
    const nudged = { start: { value: 48 * 1000 + 30, rate: { num: 24000, den: 1 } }, duration: at24(48) };
    const next = unwrap(
      repos.shots.replaceForAsset(id, 1, [range24(0, 48), nudged, range24(96, 20), range24(116, 28)]),
    );
    expect(next[0]).toBe(a);
    expect(next[1]).toBe(b);
    expect(next[2]).toBe(c);
    expect(next[3]).not.toBe(c);
    const rows = new Map(repos.shots.listByAsset(id).map((s) => [s.id, s]));
    expect(rows.get(b!)?.analysis).not.toBeNull(); // same length: analysis kept
    expect(rows.get(c!)?.analysis).toBeNull(); // shorter now: vision redoes it
    expect(rows.get(c!)?.description).toBeNull();
    expect([...rows.values()].map((s) => [s.indexInAsset, s.generation])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);

    const fewer = unwrap(repos.shots.replaceForAsset(id, 2, [range24(0, 144)]));
    expect(fewer).toEqual([a]);
    expect(repos.shots.listByAsset(id)).toHaveLength(1);
  });

  it('stores an analysis and the columns read from it, and refuses a bad one', () => {
    const { repos, asset } = profileSetup();
    const [shotId] = unwrap(repos.shots.replaceForAsset(asset(), 0, [range24(0, 48)]));
    const analysis = analysisFor(range24(0, 48), {
      onScreenText: [
        {
          text: 'शुभ दीपावली',
          box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
          range: range24(0, 24),
          confidence: 0.9,
          script: 'devanagari',
          reveal: 'none',
        },
      ],
    });
    expect(unwrap(repos.shots.putAnalyses([{ shotId: shotId!, analysis }]))).toBe(1);
    const row = unwrap(repos.shots.get(shotId!));
    expect(row).toMatchObject({
      description: 'Golden sunset over the beach',
      objects: ['sun', 'sea'].join(OBJECT_SEPARATOR),
      place: 'beach',
      shotType: 'wide',
      motion: 'pan',
      quality: 0.75,
      energy: 0.4,
      onScreenText: 'शुभ दीपावली',
      bestFrame: 2,
      dHash: '0123456789abcdef',
    });
    expect(shotAnalysis(row)?.quality.overall).toBe(0.75);
    const bad = repos.shots.putAnalyses([{ shotId: shotId!, analysis: { ...analysis, dHash: 'xyz' } }]);
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
  });

  it('adds descriptions to an analysis', () => {
    const { repos, asset } = profileSetup();
    const [shotId] = unwrap(repos.shots.replaceForAsset(asset(), 0, [range24(0, 48)]));
    const { description: _, ...plain } = analysisFor(range24(0, 48));
    unwrap(
      repos.shots.putAnalyses([{ shotId: shotId!, analysis: { ...plain, descriptionSkipped: 'not_yet' } }]),
    );
    expect(unwrap(repos.shots.get(shotId!)).description).toBeNull();
    const description = {
      text: 'A dog running in the park',
      objects: ['dog'],
      shotType: 'medium' as const,
      model: { provider: 'test', model: 'vlm', local: true },
    };
    unwrap(repos.shots.putDescriptions([{ shotId: shotId!, description }]));
    const row = unwrap(repos.shots.get(shotId!));
    expect(row.description).toBe('A dog running in the park');
    expect(shotAnalysis(row)?.description?.text).toBe('A dog running in the park');
    expect(shotAnalysis(row)?.descriptionSkipped).toBeUndefined();
  });

  it('fills each shot with the speech inside its range', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    unwrap(
      repos.transcripts.put(
        id,
        transcriptOf('en', [
          ['hello there friends', 0, 1500],
          ['look at the sunset', 2500, 1000],
        ]),
        0,
      ),
    );
    const [first, second] = unwrap(repos.shots.replaceForAsset(id, 0, [range24(0, 48), range24(48, 48)]));
    expect(unwrap(repos.shots.get(first!)).transcriptText).toBe('hello there friends');
    expect(unwrap(repos.shots.get(second!)).transcriptText).toBe('look at the sunset');
    unwrap(repos.transcripts.put(id, null, 1));
    expect(unwrap(repos.shots.get(first!)).transcriptText).toBeNull();
  });

  it('groups near-duplicates: one best take per group, replaced as a whole', () => {
    const { repos, asset } = profileSetup();
    const shots = [asset(), asset(), asset()].map(
      (id) => unwrap(repos.shots.replaceForAsset(id, 0, [range24(0, 24)]))[0]!,
    );
    const [x, y, z] = shots as [ShotId, ShotId, ShotId];
    unwrap(repos.shots.setDuplicateGroups([{ shotIds: [x, y, z], bestShotId: y }]));
    expect(
      repos.shots
        .getMany(shots)
        .map((s) => [s.id, s.duplicateGroup, s.bestTake])
        .sort(),
    ).toEqual(
      [
        [x, y, false],
        [y, y, true],
        [z, y, false],
      ].sort(),
    );
    // Deleting the leader frees the others (a trigger, like ON DELETE SET NULL).
    unwrap(repos.assets.remove(unwrap(repos.shots.get(y)).assetId));
    expect(repos.shots.getMany([x, z]).every((s) => s.duplicateGroup === null && s.bestTake)).toBe(true);
    unwrap(repos.shots.setDuplicateGroups([]));
    const refused = repos.shots.setDuplicateGroups([{ shotIds: [x], bestShotId: z }]);
    expect(refused.ok).toBe(false);
  });
});

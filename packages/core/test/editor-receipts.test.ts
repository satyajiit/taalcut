// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  affectedTimelineItems,
  preserveSequenceTransitions,
  RationalTime,
  type SequenceItem,
} from '../src/index';
import { expect, it } from 'vitest';
import { ntscTimeline } from './helpers/documents';

it('reports moved and removed content, caption appearance and markers without marking unchanged items', () => {
  const before = ntscTimeline();
  expect(affectedTimelineItems(before, structuredClone(before))).toEqual([]);
  const after = structuredClone(before);
  const first = after.tracks[0]!.items[0]!;
  if (first.type !== 'clip') throw new Error('fixture starts with a clip');
  first.duration = RationalTime.of(first.duration.value + 15, first.duration.rate);
  const changed = affectedTimelineItems(before, after);
  expect(changed).toContain(first.id);
  expect(changed).toContain(after.tracks[0]!.items[2]!.id);
  if (after.captions) {
    after.captions.enabled = !after.captions.enabled;
    expect(affectedTimelineItems(before, after)).toEqual(
      expect.arrayContaining(after.captions.cues.map((cue) => cue.id)),
    );
  }
  after.markers = [];
  expect(affectedTimelineItems(before, after)).toEqual(
    expect.arrayContaining(before.markers.map((marker) => marker.id)),
  );
});

it('retains only transitions whose original endpoints remain adjacent', () => {
  const before = ntscTimeline().tracks[0]!.items as SequenceItem[];
  const transition = before.find((item) => item.type === 'transition')!;
  const plain = before.filter((item) => item.type !== 'transition');
  expect(preserveSequenceTransitions(before, plain)).toEqual(before);
  expect(preserveSequenceTransitions(before, plain.slice(1))).not.toContainEqual(transition);
  expect(preserveSequenceTransitions(plain, plain)).toBe(plain);
});

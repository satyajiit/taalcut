// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Box, ClipVisualLayout, RationalTime } from '@taalcut/core';

export interface ShortLayoutInput {
  readonly at: RationalTime;
  readonly source: { readonly width: number; readonly height: number };
  /** Stable person/head envelopes over the excerpt, in upright source fractions. */
  readonly people?: readonly Box[];
  /** A protected demonstration, slide, screen or product region. */
  readonly content?: Box;
}

const whole: Box = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Grow a box without losing any of it, and adjust its aspect only when the source has room. */
function padded(box: Box, aspect: number): Box {
  let width = Math.min(1, box.width * 1.4);
  let height = Math.min(1, box.height * 1.4);
  if (width / height < aspect) width = Math.min(1, height * aspect);
  else height = Math.min(1, width / aspect);
  return {
    x: clamp(box.x + box.width / 2 - width / 2, 0, 1 - width),
    y: clamp(box.y + box.height / 2 - height / 2, 0, 1 - height),
    width,
    height,
  };
}

/** Conservative static framing. It never guesses the active speaker or crops away an unknown screen. */
export function createShortLayout(input: ShortLayoutInput): ClipVisualLayout {
  const sourceAspect = input.source.width / input.source.height;
  const region = (id: string, viewport: Box, crop: Box): ClipVisualLayout['regions'][number] => ({
    id,
    viewport,
    fit: 'contain',
    keyframes: [{ at: input.at, crop }],
  });
  const people = [...(input.people ?? [])]
    .filter(
      (box) =>
        [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0,
    )
    .sort((a, b) => a.x - b.x);
  if (input.content && people.length === 1)
    return {
      regions: [
        region('content', { x: 0, y: 0, width: 1, height: 0.65 }, input.content),
        region(
          'presenter',
          { x: 0, y: 0.65, width: 1, height: 0.35 },
          padded(people[0]!, 9 / 16 / 0.35 / sourceAspect),
        ),
      ],
    };
  // A third person means a crop could exclude a participant: preserve the complete discussion.
  if (!input.content && people.length === 2)
    return {
      regions: people.map((person, index) =>
        region(
          `person-${index + 1}`,
          { x: 0, y: index / 2, width: 1, height: 0.5 },
          padded(person, 9 / 8 / sourceAspect),
        ),
      ),
    };
  const crop = input.content ?? (people.length === 1 ? padded(people[0]!, 9 / 16 / sourceAspect) : whole);
  return { regions: [region('main', whole, crop)] };
}

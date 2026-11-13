// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The graphics on a timeline as `graphics.list` shows them (SPEC P3.12, HFW1): each with its composition (its name, a
 * model's words, and the variables graphics.edit's params set). Every text is defused of untrusted-fence look-alikes.
 */
import type { z } from 'zod';
import { compositionFor, escapeUntrusted, type GraphicItem, type Timeline } from '@taalcut/core';
import type { itemSchema } from './tool-schemas';

/** A designed graphic's composition as graphics.list shows it. */
function compositionOf(timeline: Timeline, ref: NonNullable<GraphicItem['composition']>) {
  const held = compositionFor(ref, timeline.graphicCompositions);
  const params = Object.fromEntries(
    Object.entries(ref.params).map(([name, value]) => [
      name,
      typeof value === 'string' ? escapeUntrusted(value) : value,
    ]),
  );
  return {
    id: ref.id,
    version: held?.version ?? 1,
    name: escapeUntrusted(held?.name ?? 'Graphic'),
    variables: (held?.variables ?? []).map((variable) => ({ name: variable.name, type: variable.type })),
    params,
  };
}

/** One graphic as graphics.list's itemSchema has it. */
type Listed = z.input<typeof itemSchema>;

export function listedGraphics(timeline: Timeline): Listed[] {
  return timeline.tracks.flatMap((track) =>
    track.kind !== 'text'
      ? []
      : track.items.flatMap((item): Listed[] =>
          item.type === 'graphic' && item.composition
            ? [
                {
                  itemId: item.id,
                  composition: compositionOf(timeline, item.composition),
                  start: item.start,
                  duration: item.duration,
                  placement: item.placement,
                  origin: item.origin,
                  ...(item.proposal ? { proposal: { design: item.proposal.design } } : {}),
                },
              ]
            : [],
        ),
  );
}

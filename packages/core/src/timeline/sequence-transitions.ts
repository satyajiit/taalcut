// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SequenceItem } from './timeline-items';

/** The audio track's transitions put back between the same two clips, where they are still side by side. */
export function preserveSequenceTransitions(
  before: readonly SequenceItem[],
  after: SequenceItem[],
): SequenceItem[] {
  const joins = before.flatMap((item, index) =>
    item.type === 'transition' ? [{ item, from: before[index - 1]?.id, to: before[index + 1]?.id }] : [],
  );
  if (joins.length === 0) return after;
  const out: SequenceItem[] = [];
  after.forEach((item, index) => {
    out.push(item);
    const next = after[index + 1];
    const join = joins.find((candidate) => candidate.from === item.id && candidate.to === next?.id);
    if (join) out.push(join.item);
  });
  return out;
}

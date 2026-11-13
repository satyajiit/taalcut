// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { storedIdentity } from '../src/stored-upstream';
import { same, type Interaction } from './refresh-offers';

/** Tool offers may change; every other stable request field and the complete response must stay exact. */
function identity(row: Interaction) {
  return {
    request: storedIdentity(row.request),
    headers: row.request.headers,
    response: row.response,
  };
}

/** Appended fixture repairs need not be chronological. Never reorder the original tape to match a journey. */
export function alignJourney(original: readonly Interaction[], derived: readonly Interaction[]): number[] {
  if (original.length !== derived.length) throw new Error('the journey interaction count changed');
  const identities = original.map(identity);
  const used = new Set<number>();
  const positions = derived.map((row) => {
    const wanted = identity(row);
    const matches = identities.flatMap((entry, index) => (same(entry, wanted) ? [index] : []));
    if (matches.length !== 1) throw new Error('the journey has a missing or ambiguous exact interaction');
    const index = matches[0]!;
    if (used.has(index)) throw new Error('the journey repeats an interaction');
    used.add(index);
    return index;
  });
  if (used.size !== original.length) throw new Error('the journey does not cover the complete tape');
  return positions;
}

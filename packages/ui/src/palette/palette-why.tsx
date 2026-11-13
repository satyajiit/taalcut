// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: why ⌘K found something (UX4) · system: DESIGN.md v0.7 (type roles)
 * one quiet line under a found item's name when the name isn't what matched: what matched, in the Library's own words
 *   ("Said", "On screen", "Described"), a dot, and the passage with the typed words marked in ink. The passage is a
 *   person's words or the model's, never translated; cut with an ellipsis at the row's end, whole in the tooltip
 * states: the option's own (default, active, disabled); nothing of its own to press */
import type { ReactNode } from 'react';
import { UserContent } from '../cards/card-frame';

/** Why the app found an item when its name isn't what matched (a clip found by what is said in it). */
export interface PaletteWhy {
  /** What matched, translated: "Said", "On screen", "Described". */
  readonly kind: string;
  /** The passage that matched: a person's words, or the model's description. */
  readonly passage: string;
  /** Where the typed words are in the passage: [start, end) UTF-16 offsets, in order. */
  readonly marks?: readonly (readonly [number, number])[];
}

function Marked({ text, marks }: { text: string; marks: readonly (readonly [number, number])[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start < at || end > text.length) continue;
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-transparent font-medium text-ink">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The line under a found item's name: "Said · …we just landed in Goa…". */
export function PaletteWhyLine({ why }: { why: PaletteWhy }) {
  return (
    <span data-slot="palette-why" title={why.passage} className="block truncate type-meta text-ink-2">
      {why.kind}
      {' · '}
      <UserContent translate="no">
        <Marked text={why.passage} marks={why.marks ?? []} />
      </UserContent>
    </span>
  );
}

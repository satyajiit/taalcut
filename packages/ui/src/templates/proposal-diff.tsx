// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a proposal as a diff (BRK1-REV, Tell Taalcut) · system: DESIGN.md v0.7
 * what it changes ("Slot 4's description"), then before → after: words someone wrote (OCR, the model's) as user
 *   content, struck through when they go; times and counts as plain text
 */
import { UserContent } from '../cards/card-frame';
import type { ProposalWords } from './proposal-words';

export function Diff({ words }: { words: ProposalWords }) {
  const side = (value: { text: string; words: boolean }, removed: boolean) =>
    value.words ? (
      <UserContent translate="no" className={removed ? 'text-ink-2 line-through' : 'text-ink'}>
        {value.text}
      </UserContent>
    ) : (
      <span className={removed ? 'text-ink-2 line-through' : 'text-ink'}>{value.text}</span>
    );
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="type-label text-ink">{words.what}</span>
      {words.before || words.after ? (
        <span data-slot="proposal-diff" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 type-body">
          {words.before ? side(words.before, true) : null}
          {words.before && words.after ? (
            <span aria-hidden className="text-ink-3">
              →
            </span>
          ) : null}
          {words.after ? side(words.after, false) : null}
        </span>
      ) : null}
    </div>
  );
}

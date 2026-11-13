// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: unmatched phrases row (P3-V13) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the warning row a motion graphic's card shows for phrases the captions didn't have: the
 *   phrases as written, joined the way the language lists things · states: shown or absent
 * motion: none · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { TriangleAlert } from 'lucide-react';
import { UserContent } from './card-frame';

/** "Couldn't find 'fifty percent' in the captions; placed it by time." The phrases are the AI's words, as written. */
export function UnmatchedRow({ phrases }: { phrases: readonly string[] }) {
  const { t, i18n } = useLingui();
  // Joined the way this language lists things; each phrase stays as written. The pseudo-locale has no list words
  // of its own: commas only, so no English shows through (as cleanup-words.ts).
  const quoted = phrases.map((phrase) => `“${phrase}”`);
  const parts: readonly { type: string; value: string }[] =
    i18n.locale === 'en-XA'
      ? quoted.flatMap((value, index) => [
          ...(index > 0 ? [{ type: 'literal', value: ', ' }] : []),
          { type: 'element', value },
        ])
      : new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).formatToParts(quoted);
  return (
    <div
      data-slot="unmatched"
      className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-strong"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="m-0 min-w-0">
        {t`Couldn’t find these words in the captions, so it’s placed by time:`}{' '}
        {parts.map((part, index) =>
          part.type === 'element' ? (
            <UserContent key={index} translate="no" className="font-semibold">
              {part.value}
            </UserContent>
          ) : (
            <span key={index}>{part.value}</span>
          ),
        )}
      </p>
    </div>
  );
}

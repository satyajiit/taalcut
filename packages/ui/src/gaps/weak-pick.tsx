// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: weak pick (FIX-GAPS) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a slot whose clip casting is unsure of, inside a gap item: one line with the clip in it now
 *   (what the library says it shows, user content, and how well it fits), then one plain line on what happens by
 *   default ("Another clip fits this shot better" or "None of your other clips fits better, so this one stays"); its
 *   swap rows sit with the gap's other fixes (clip-row.tsx)
 * states: default · chosen (Choose pressed, in teal: your choice) · disabled (the answer went) · no description (the
 *   fit alone)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GapWeakPick } from '@taalcut/core';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';

/** What the shot has now, and what happens to it by default, in plain words. */
export function WeakPickLines({ weak, borrows = false }: { weak: GapWeakPick; borrows?: boolean }) {
  const { t } = useLingui();
  const format = useFormatters();
  const fit = format.percent(weak.pick.fit);
  return (
    <div data-slot="weak-pick" className="flex flex-col gap-0.5">
      <p className="m-0 max-w-[60ch] text-sm text-ink-2">
        {weak.pick.description ? (
          <>
            {t`The clip in it now:`}{' '}
            <UserContent translate="no" className="text-ink">
              {weak.pick.description}
            </UserContent>{' '}
            <span className="tabular-nums">{t`(fits ${fit})`}</span>
          </>
        ) : (
          <span className="tabular-nums">{t`The clip in it now fits ${fit}.`}</span>
        )}
      </p>
      <p className="m-0 max-w-[60ch] text-sm text-ink">
        {borrows
          ? t`Taalcut isn’t sure of this clip. Another shot has a clip that fits this one clearly better, so Taalcut proposes swapping the two.`
          : weak.betterFit
            ? t`Taalcut isn’t sure of this clip, and another of your clips fits this shot clearly better.`
            : t`Taalcut isn’t sure of this clip, but none of your other clips fits this shot better, so it stays unless you choose.`}
      </p>
    </div>
  );
}

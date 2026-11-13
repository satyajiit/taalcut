// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: pointer chips · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * P3-V15 (round P3-3 shows them live): what a message's words pointed at, as the agent resolved them, above your
 *   words like the selection chips: the kit's chip look (pill, 12 px semibold, primary-soft wash and primary-strong
 *   words, the kind's icon), the times in the editor's clock; "Reference" when it's the reference's slot or cut;
 *   one the agent couldn't place says so in a neutral sunken chip with your words as written (translate="no")
 * states: default (a chip is data: nothing to press, so no hover, focus, active, disabled or loading) · error (not
 *   found: the neutral chip) · success (the place, in words and time)
 * pre-emit critique: P4 H4 E4 S4 R4 V4 */
import { useLingui } from '@lingui/react/macro';
import { TimeRange, type ReferencePointer } from '@taalcut/core';
import { useTimecode, UserContent } from '@taalcut/ui';
import { CircleHelp, Film, MoveHorizontal, RectangleVertical, Scissors } from 'lucide-react';

const ICONS = {
  slot: RectangleVertical,
  cut: Scissors,
  range: MoveHorizontal,
  clip: Film,
  unresolved: CircleHelp,
} as const;

const CHIP = 'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-pill px-2 text-xs font-semibold';

/** One pointer's words: "Reference · Slot 3 · 0:04", "Cut at 0:04", "0:04–0:06", "Clip 2 · 0:12". */
function usePointerLabel(): (pointer: ReferencePointer) => string {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  return (pointer) => {
    const range = pointer.range;
    const at = range ? time.clock(range.start.value, range.start.rate) : null;
    const end = range ? TimeRange.end(range) : null;
    const until = end ? time.clock(end.value, end.rate) : null;
    const n = pointer.slotNumber === null ? null : i18n.number(pointer.slotNumber);
    let words: string;
    switch (pointer.kind) {
      case 'slot':
        words = n ? (at ? t`Slot ${n} · ${at}` : t`Slot ${n}`) : (at ?? t`A slot`);
        break;
      case 'cut':
        words = at ? t`Cut at ${at}` : n ? t`The cut into slot ${n}` : t`A cut`;
        break;
      case 'range':
        words = at && until ? t`${at}–${until}` : (at ?? t`A stretch`);
        break;
      case 'clip':
        words = n ? (at ? t`Clip ${n} · ${at}` : t`Clip ${n}`) : at ? t`Clip at ${at}` : t`A clip`;
        break;
      case 'unresolved':
        return '';
    }
    return pointer.basis === 'template' ? t`Reference · ${words}` : words;
  };
}

/** The chips for a message's pointers, in the order the words came (at most ten). */
export function PointerChips({ pointers }: { pointers: readonly ReferencePointer[] }) {
  const { t } = useLingui();
  const labelOf = usePointerLabel();
  return (
    <>
      {pointers.map((pointer, index) => {
        const Icon = ICONS[pointer.kind];
        const key = `${index}:${pointer.said}`;
        if (pointer.kind === 'unresolved')
          return (
            <span
              key={key}
              data-slot="pointer-chip"
              data-kind="unresolved"
              className={`${CHIP} bg-chip text-ink-2`}
            >
              <Icon aria-hidden className="size-3 shrink-0" />
              <span className="shrink-0">{t`Not found:`}</span>{' '}
              <UserContent translate="no" className="min-w-0 truncate whitespace-nowrap">
                {pointer.said}
              </UserContent>
            </span>
          );
        return (
          <span
            key={key}
            data-slot="pointer-chip"
            data-kind={pointer.kind}
            data-basis={pointer.basis}
            className={`${CHIP} bg-primary-soft text-primary-strong`}
          >
            <Icon aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 truncate tabular-nums">{labelOf(pointer)}</span>
          </span>
        );
      })}
    </>
  );
}

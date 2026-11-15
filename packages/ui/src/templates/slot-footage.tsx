// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: whose footage a slot plays, and the person's say in it (KEEP1) · system:
 *   DESIGN.md v0.7 (violet: the AI's reading; teal: yours; a small set of choices is the segmented pill)
 * a reel can hold footage that is the format's fixed part (a film scene, a meme clip). The slot says plainly which
 *   it is: "This shot is the reel's own clip", whose statement that is (the AI mark for Taalcut's reading, "You" for
 *   the person's), Taalcut's reason as it wrote it, and what follows from it; or "Your clip goes here". Under it the
 *   two choices, "Keep the reel's clip" and "Use my clip": picking one is template.slot.setFootage, undoable. Only a
 *   template made from a reference reel has it
 * states: default · hover · focus (roving, arrows pick) · disabled (another fix on its way) · loading (this pick on
 *   its way: the pill holds) · unavailable ("Keep the reel's clip" off, with why in a line under it: the reel's
 *   video is not on this Mac, or this is the last slot left for the person's clips) · error (the panel's line) ·
 *   read-only (the words, no choices)
 * contrast: ink on canvas for the statement, ink-2 for the reason and the lines under it (4.5:1 in both themes)
 * reduced motion: the pill's thumb moves at once (segmented.tsx); nothing else moves
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Segmented } from '#components/segmented';
import { UserContent } from '../cards/card-frame';
import { REVIEW_ICONS } from './review-icons';
import type { ReviewEdits } from './use-review-edits';

type Slot = Template['slots'][number];
export type FootageFrom = NonNullable<Slot['footage']>['from'];

/** Whose footage the slot plays: the reel's own when it says so, else the person's (every slot before KEEP1). */
export const footageFrom = (slot: Slot): FootageFrom => slot.footage?.from ?? 'person';

/**
 * Why "Keep the reel's clip" can't be picked for a slot that plays the person's clip, or null when it can: the
 * template keeps no reel video on this Mac, or every other slot is already the reel's own.
 */
export function reelChoiceBlocked(
  template: Template,
  index: number,
  hasReel: boolean,
): 'noReel' | 'last' | null {
  const slot = template.slots[index];
  if (!slot || footageFrom(slot) === 'reel') return null;
  if (!hasReel) return 'noReel';
  return template.slots.every((each, i) => i === index || footageFrom(each) === 'reel') ? 'last' : null;
}

export interface SlotFootageProps {
  template: Template;
  index: number;
  /** Whether the template keeps the reel's video on this Mac (the review's `reelUrl`). */
  hasReel: boolean;
  /** The review's fixes; null: read-only. */
  edits: Pick<ReviewEdits, 'run' | 'pending'> | null;
}

export function SlotFootage({ template, index, hasReel, edits }: SlotFootageProps) {
  const { t, i18n } = useLingui();
  const slot = template.slots[index];
  if (!slot || template.origin.kind !== 'reference') return null;
  const number = i18n.number(index + 1);
  const from = footageFrom(slot);
  const by = slot.footage?.by ?? null;
  const reason = slot.footage?.reason ?? null;
  // The reason is always Taalcut's: a person's change keeps the line it wrote.
  const overruled = by === 'user' && reason !== null;
  const blocked = reelChoiceBlocked(template, index, hasReel);
  const why =
    blocked === 'noReel'
      ? t`The reel’s video isn’t on this Mac, so this slot can’t keep the reel’s clip.`
      : blocked === 'last'
        ? t`Your clips need at least one slot, so this one stays yours.`
        : from === 'reel' && !hasReel
          ? t`The reel’s video isn’t on this Mac. Get it before you make a video, or use your clip here.`
          : null;
  const keep = t`Keep the reel’s clip`;

  return (
    <div data-slot="slot-footage" data-from={from} className="flex flex-col gap-2">
      <p className="m-0 flex flex-wrap items-center gap-1.5 type-label text-ink">
        {from === 'reel' ? <REVIEW_ICONS.reel aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : null}
        <span data-slot="slot-footage-status">
          {from === 'reel' ? t`This shot is the reel’s own clip` : t`Your clip goes here`}
        </span>
        {by === 'user' ? (
          <Chip tone="you">{t`You`}</Chip>
        ) : by === 'analyst' ? (
          <AiMark className="size-3.5 shrink-0" label={t`Taalcut’s reading`} />
        ) : null}
      </p>
      {reason ? (
        <p data-slot="slot-footage-reason" className="m-0 flex items-start gap-1.5 type-meta text-ink-2">
          {overruled ? <AiMark className="mt-0.5 size-3.5 shrink-0" label={t`Taalcut’s reading`} /> : null}
          <span className="min-w-0">
            {overruled && from === 'person' ? (
              <>{t`Taalcut read this shot as the reel’s own clip:`} </>
            ) : null}
            {/* Model text, written from someone else's video: shown as text, never translated. */}
            <UserContent translate="no">{reason}</UserContent>
          </span>
        </p>
      ) : null}
      {from === 'reel' ? (
        <p className="m-0 type-meta text-ink-2">
          {t`A video made from this template keeps it. Your clips go in the other slots.`}
        </p>
      ) : null}
      {edits ? (
        <Segmented<FootageFrom>
          label={t`Whose clip plays in slot ${number}`}
          value={from}
          busy={edits.pending === 'setFootage'}
          disabled={edits.pending !== null && edits.pending !== 'setFootage'}
          options={[
            {
              value: 'reel',
              // A choice that is off says why in its own name too: arrows skip it, so its line is never focused.
              label: blocked ? (
                <>
                  {keep}
                  <span className="sr-only">. {why}</span>
                </>
              ) : (
                keep
              ),
              disabled: blocked !== null,
            },
            { value: 'person', label: t`Use my clip` },
          ]}
          onChange={(next) => {
            if (next === from || edits.pending !== null) return;
            void edits.run({ kind: 'setFootage', slotId: slot.id, from: next });
          }}
        />
      ) : null}
      {why ? (
        <p data-slot="slot-footage-why" className="m-0 type-meta text-ink-2">
          {why}
        </p>
      ) : null}
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap facts (FIX-ASK) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · what's wrong in plain words, from the agent's facts (nothing invented): under the card's
 *   title the counts ("This video needs 13 clips. 12 of yours fit, so 1 shot has nothing.") and why it asks; after
 *   Add more clips what came in; per shot, why nothing fits ("None of your clips shows someone checking a phone.")
 *   with the template's words as user content, the clip that comes closest and which shot has it, and a quiet chip
 *   when the shot carries the template's text or graphics
 * states: asking (counts, why, the chat hint) · settled (counts only) · no facts (a card from before: nothing)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, GapAskReason, GapSummary } from '@taalcut/core';
import { Chip } from '#components/badge';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { ClipWords } from './clip-row';
import type { GapFixItem } from './gap-types';

type NewClips = NonNullable<CardOf<'gapFix'>['newClips']>;

/** The counts over the whole video, in one or two sentences. */
export function SummaryLine({ summary }: { summary: GapSummary }) {
  const { t, i18n } = useLingui();
  const filled = i18n.number(summary.filled);
  const needs = t`This video needs ${plural(summary.shots, { one: '# clip', other: '# clips' })}.`;
  const fit =
    summary.empty > 0
      ? t`${filled} of yours fit, so ${plural(summary.empty, { one: '# shot has nothing', other: '# shots have nothing' })}.`
      : t`Every shot has a clip.`;
  const unsure =
    summary.unsure > 0
      ? t`Taalcut isn’t sure of ${plural(summary.unsure, { one: '# clip', other: '# clips' })}.`
      : '';
  return (
    <p data-slot="gap-summary" className="m-0 max-w-[60ch] text-sm text-ink tabular-nums">
      {[needs, fit, unsure].filter(Boolean).join(' ')}
    </p>
  );
}

/** Why a level that otherwise decides alone stopped to ask (the counts already say a shot has nothing). */
export function WhyLine({ why }: { why: readonly GapAskReason[] }) {
  const { t } = useLingui();
  const words = why.flatMap((reason) => {
    switch (reason) {
      case 'opening':
        return [t`The opening shot sets the hook, and its clip is unsure.`];
      case 'carries':
        return [t`A shot with the template’s text or graphics has an unsure clip.`];
      case 'manyUnsure':
        return [t`Many of the clips are unsure.`];
      case 'empty':
        return [];
    }
  });
  if (words.length === 0) return null;
  return (
    <p data-slot="gap-why" className="m-0 max-w-[60ch] text-sm text-ink-2">
      {words.join(' ')}
    </p>
  );
}

/** After Add more clips: what came in, and what Taalcut did with it. */
export function NewClipsLine({ clips }: { clips: NewClips }) {
  const { t } = useLingui();
  const words =
    clips.added === 0
      ? t`No new clips came in yet. Add some, then choose Add more clips again, or pick another fix.`
      : clips.ready < clips.added
        ? t`You added ${plural(clips.added, { one: '# clip', other: '# clips' })}; ${plural(clips.ready, { one: '# is', other: '# are' })} ready so far. Taalcut used ${plural(clips.used, { one: '# of them', other: '# of them' })}.`
        : t`You added ${plural(clips.added, { one: '# clip', other: '# clips' })}. Taalcut used ${plural(clips.used, { one: '# of them', other: '# of them' })}.`;
  return (
    <p data-slot="gap-new-clips" role="status" className="m-0 max-w-[60ch] text-sm text-ink tabular-nums">
      {words}
    </p>
  );
}

/** Per shot: why nothing fits, the closest clip, and what of the template's it carries. */
export function GapWants({ gap }: { gap: GapFixItem }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const closest = gap.closest;
  const usedIn = closest?.usedIn ? i18n.number(closest.usedIn) : null;
  const fit = closest ? format.percent(closest.fit) : '';
  // An unsure shot's closer clips are its rows already (a swap, another shot's clip): the line is for an empty one.
  const showClosest = closest && !gap.weak;
  const wants = gap.wants;
  return (
    <>
      {!gap.weak && wants ? (
        <p data-slot="gap-wants" className="m-0 max-w-[60ch] text-sm text-ink">
          <Trans>
            None of your clips shows <UserContent translate="no">{wants}</UserContent>.
          </Trans>
        </p>
      ) : null}
      {showClosest ? (
        <p data-slot="gap-closest" className="m-0 max-w-[60ch] text-sm text-ink-2">
          {usedIn !== null ? (
            <Trans>
              The closest is <ClipWords description={closest.description} />{' '}
              <span className="tabular-nums">(fits {fit})</span>, now in shot {usedIn}.
            </Trans>
          ) : (
            <Trans>
              The closest is <ClipWords description={closest.description} />{' '}
              <span className="tabular-nums">(fits {fit})</span>.
            </Trans>
          )}
        </p>
      ) : null}
      {gap.carries?.length ? (
        <span className="flex flex-wrap gap-1.5">
          {gap.carries.includes('text') ? <Chip className="bg-hover">{t`The template’s text`}</Chip> : null}
          {gap.carries.includes('graphics') ? (
            <Chip className="bg-hover">{t`The template’s graphics`}</Chip>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

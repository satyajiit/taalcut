// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: clip choice rows (FIX-GAPS, FIX-ASK) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one row per clip a shot could take, with the gap's other fixes in the same row style
 *   (hairline between rows, a quiet icon, the fix's name, the clip's words as user content and its fit; Choose while
 *   the agent asks): another of your clips (swap), the clip another shot has, saying which shot gives it up and what it
 *   gets instead (borrow), or another part of a clip a shot already shows (reuse)
 * states: default · chosen (Choose pressed, in teal: your choice) · disabled (the answer went) · no description (the
 *   fit alone)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { GapBorrowCandidate, GapReuseCandidate, GapSwapCandidate } from '@taalcut/core';
import { ArrowLeftRight, Check, CopyPlus, Replace } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import type { GapFixPick, SwapChoice } from './gap-types';
import { FIX_TITLES } from './gap-words';

type ClipKind = 'swap' | 'borrow' | 'reuse';
const ICONS = { swap: Replace, borrow: ArrowLeftRight, reuse: CopyPlus } as const;

const same = (a: SwapChoice | undefined, b: SwapChoice) =>
  a !== undefined && a.assetId === b.assetId && a.shotId === b.shotId;

export interface ClipChoose {
  readonly chosen: GapFixPick | null;
  readonly locked: boolean;
  readonly onChoose: (pick: GapFixPick | null) => void;
}

/** What the library says a clip shows, as user content, or that it has no words yet (`start`: a sentence's start). */
export function ClipWords({ description, start = false }: { description: string | null; start?: boolean }) {
  const { t } = useLingui();
  if (description)
    return (
      <UserContent translate="no" className="text-ink">
        {description}
      </UserContent>
    );
  return <>{start ? t`A clip with no description yet` : t`a clip with no description yet`}</>;
}

function ClipChoiceRow({
  kind,
  candidate,
  choose,
  children,
}: {
  kind: ClipKind;
  candidate: GapSwapCandidate;
  choose: ClipChoose | undefined;
  children: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const titleId = useId();
  const target = { assetId: candidate.assetId, shotId: candidate.shotId };
  const chosen = choose?.chosen?.fix === kind && same(choose.chosen.swapTo, target);
  const Icon = ICONS[kind];
  return (
    <li
      data-slot="gap-fix"
      data-kind={kind}
      data-chosen={chosen || undefined}
      className="flex flex-col gap-2 border-t border-rule-subtle py-3 first:border-t-0 first:pt-1 last:pb-0"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-ink-3"
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={titleId} className="text-sm font-semibold text-ink">
            {i18n._(FIX_TITLES[kind])}
          </span>
          <span className="text-sm text-ink-2">{children}</span>
        </div>
        {choose ? (
          <div className="flex shrink-0 items-center">
            <Button
              size="sm"
              aria-pressed={chosen}
              aria-describedby={titleId}
              disabled={choose.locked}
              className={cn(chosen && 'border-you-strong bg-you-soft text-you-strong hover:bg-you-soft')}
              onClick={() => choose.onChoose(chosen ? null : { fix: kind, swapTo: target })}
            >
              {chosen ? <Check aria-hidden /> : null}
              {chosen ? t`Chosen` : t`Choose`}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

const keyOf = (c: GapSwapCandidate) => `${c.assetId}:${c.shotId ?? ''}`;

/** One row per clip a weak shot could take instead, best fit first. */
export function SwapRows({
  candidates,
  choose,
}: {
  candidates: readonly GapSwapCandidate[];
  choose?: ClipChoose;
}) {
  const { t } = useLingui();
  const format = useFormatters();
  return (
    <>
      {candidates.map((candidate) => {
        const fit = format.percent(candidate.fit);
        return (
          <ClipChoiceRow key={keyOf(candidate)} kind="swap" candidate={candidate} choose={choose}>
            <ClipWords description={candidate.description} start />{' '}
            <span className="tabular-nums">{t`(fits ${fit})`}</span>
          </ClipChoiceRow>
        );
      })}
    </>
  );
}

/** FIX-ASK: one row per clip another shot has that fits here better: which shot gives it up, and what it gets. */
export function BorrowRows({
  candidates,
  choose,
}: {
  candidates: readonly GapBorrowCandidate[];
  choose?: ClipChoose;
}) {
  const { i18n } = useLingui();
  const format = useFormatters();
  return (
    <>
      {candidates.map((candidate) => {
        const fit = format.percent(candidate.fit);
        const from = i18n.number(candidate.from.number);
        return (
          <ClipChoiceRow key={keyOf(candidate)} kind="borrow" candidate={candidate} choose={choose}>
            <Trans>
              <ClipWords description={candidate.description} start />{' '}
              <span className="tabular-nums">(fits {fit})</span>, now in shot {from}. Shot {from} gets{' '}
              <ClipWords description={candidate.instead.description} /> instead, so no clip is used twice.
            </Trans>
          </ClipChoiceRow>
        );
      })}
    </>
  );
}

/** FIX-ASK: one row per other part of a clip a shot already shows, long enough for both. */
export function ReuseRows({
  candidates,
  choose,
}: {
  candidates: readonly GapReuseCandidate[];
  choose?: ClipChoose;
}) {
  const { i18n } = useLingui();
  const format = useFormatters();
  return (
    <>
      {candidates.map((candidate) => {
        const fit = format.percent(candidate.fit);
        const shot = i18n.number(candidate.usedIn);
        return (
          <ClipChoiceRow key={keyOf(candidate)} kind="reuse" candidate={candidate} choose={choose}>
            <Trans>
              Another part of <ClipWords description={candidate.description} />{' '}
              <span className="tabular-nums">(fits {fit})</span>, the clip in shot {shot}. The clip is long
              enough for both, so the same moment won’t show twice.
            </Trans>
          </ClipChoiceRow>
        );
      })}
    </>
  );
}

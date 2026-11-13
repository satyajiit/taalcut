// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: proposed graphic row (EDT1-GFX) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a soft accent band at the top of a graphic's panel while the graphic the AI designed
 *   is a proposal: one line that it plays in the viewer and isn't in the video yet, then Use it (primary:
 *   graphics.useProposal, one ⌘Z), Try again (the run's follow-up, the graphic as a chip) and Change… (words and
 *   the graphic's chip in the composer, unsent)
 * states: proposed · using (Use it busy, the others off) · used (the card's changed line, outside this row) ·
 *   sent (Try again's "Asked for another design.") · error under the button that failed · no actions (no command
 *   bus, a deleted video): the line only
 * motion: none · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GraphicItem, RunId, SelectionChip, TaalcutError } from '@taalcut/core';
import { Check, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '#components/button';
import { useMediaActions } from './media-actions';
import { MediaError } from './media-lines';
import { useFollowUp } from './use-command';

type Proposal = NonNullable<GraphicItem['proposal']>;

/** "Try again" as the row shows it: absent, the row has none. */
export interface ProposalTryAgain {
  readonly busy: boolean;
  /** The request went to the run. */
  readonly sent: boolean;
  readonly error: TaalcutError | null;
  readonly run: () => void;
}

export interface GraphicProposalRowProps {
  readonly proposal: Proposal;
  readonly disabled: boolean;
  readonly using: boolean;
  readonly useError: TaalcutError | null;
  readonly onUse: () => void;
  readonly tryAgain?: ProposalTryAgain | undefined;
  /** "Change…" (the card) or "Change with words…" (the editor): words and the graphic in the composer. */
  readonly onChange?: (() => void) | undefined;
  readonly changeLabel?: string | undefined;
}

/** "Proposed: it plays in the viewer and isn't in your video yet." with Use it, Try again and Change…. */
export function GraphicProposalRow(props: GraphicProposalRowProps) {
  const { t } = useLingui();
  return (
    <section
      data-slot="graphic-proposal"
      aria-label={t`Proposed graphic`}
      className="flex flex-col gap-2.5 rounded-lg bg-primary-soft px-3 py-2.5"
    >
      <p className="m-0 flex items-start gap-2 text-sm text-ink">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-strong" />
        <span>{t`Proposed: it plays in the viewer and isn’t in your video yet.`}</span>
      </p>
      <ProposalActions {...props} />
    </section>
  );
}

/**
 * A proposal's buttons and what came of them: Use it (primary), Try again and Change…, then "Asked for another
 * design." and the error under the button that failed. HFW1-UI's designed graphic row shares them.
 */
export function ProposalActions(props: Omit<GraphicProposalRowProps, 'proposal'>) {
  const { t } = useLingui();
  const { disabled, using, tryAgain, onChange } = props;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={using} disabled={disabled} onClick={props.onUse}>
          <Check aria-hidden />
          {t`Use it`}
        </Button>
        {tryAgain ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || using}
            loading={tryAgain.busy}
            onClick={tryAgain.run}
          >
            <RefreshCw aria-hidden />
            {t`Try again`}
          </Button>
        ) : null}
        {onChange ? (
          <Button size="sm" variant="ghost" disabled={disabled || using} onClick={onChange}>
            <MessageSquareText aria-hidden />
            {props.changeLabel ?? t`Change…`}
          </Button>
        ) : null}
      </div>
      {tryAgain?.sent ? (
        <p role="status" className="m-0 text-sm text-ink-2">{t`Asked for another design.`}</p>
      ) : null}
      {props.useError ? <MediaError error={props.useError} /> : null}
      {tryAgain?.error ? <MediaError error={tryAgain.error} /> : null}
    </>
  );
}

/** The chat card's Try again (the run's follow-up) and Change… (the composer), the graphic as a chip. */
export function useProposalChat(
  runId: RunId | undefined,
  chip: SelectionChip,
): Pick<GraphicProposalRowProps, 'tryAgain' | 'onChange'> {
  const { t } = useLingui();
  const followUp = useFollowUp(runId);
  const { ask } = useMediaActions();
  return {
    tryAgain: followUp.can
      ? {
          busy: followUp.busy === 'again',
          sent: followUp.outcome?.key === 'again' && followUp.outcome.outcome === 'sent',
          error: followUp.error?.error ?? null,
          run: () => void followUp.send('again', t`Try again: design this graphic another way.`, [chip]),
        }
      : undefined,
    onChange: ask ? () => ask(t`Change this graphic: `, [chip]) : undefined,
  };
}

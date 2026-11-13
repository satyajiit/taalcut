// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: designed graphic proposal (HFW1-UI) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the motion graphic proposal row's variant for a graphic the AI designed: the soft accent
 *   band, a still of it from its newest render on the viewer grey (the shot under it while there is none), its
 *   design's name (the model's words, shown as content) and when it plays ("0:04–0:07"), the one line that it plays
 *   in the viewer and isn't in the video yet, then Use it (primary: graphics.useProposal, one ⌘Z), Try again (the
 *   run's follow-up, the graphic as a chip) and Change… (the chat with the graphic as a chip)
 * states: proposed · using (Use it busy, the others off) · sent ("Asked for another design.") · error under the
 *   button that failed · no actions (no command bus, a deleted video): the band's words only
 * motion: none · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { RationalTime } from '@taalcut/core';
import { Sparkles } from 'lucide-react';
import { useId } from 'react';
import { UserContent } from '../cards/card-frame';
import { ProviderLogo } from '../components/provider-logo';
import { ShotThumb, StillName } from '../make/shot-thumb';
import { useTimecode } from '../make/timecode';
import { ProposalActions, type GraphicProposalRowProps } from './graphic-proposal';

export interface DesignProposalRowProps extends Omit<GraphicProposalRowProps, 'proposal'> {
  /** The design's name, as the model wrote it. */
  readonly name: string;
  readonly start: RationalTime;
  readonly duration: RationalTime;
  /**
   * A still of it (its newest render), else of the shot under it; null keeps the viewer grey. Absent: no still
   * (the editor, where the viewer beside it plays the graphic).
   */
  readonly poster?: string | null | undefined;
  /** False leaves the buttons out (no command bus, or the video is gone). */
  readonly actions?: boolean;
}

/** "Chat bubble · 0:04–0:07 · Proposed: it plays in the viewer…" with Use it, Try again and Change…. */
export function DesignProposalRow({
  name,
  start,
  duration,
  poster,
  actions = true,
  ...props
}: DesignProposalRowProps) {
  const { t } = useLingui();
  const stillId = useId();
  const time = useTimecode();
  const from = time.clock(start.value, start.rate);
  const to = time.clock(start.value + duration.value, start.rate);
  return (
    <section
      data-slot="design-proposal"
      aria-label={t`Proposed graphic`}
      className="flex flex-col gap-2.5 rounded-lg bg-primary-soft px-3 py-2.5"
    >
      <div className="flex items-start gap-3">
        {poster === undefined ? null : (
          <>
            <StillName id={stillId} name={name} />
            <ShotThumb url={poster} size="sm" className="w-10 shrink-0" labelledBy={stillId} />
          </>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm">
            <ProviderLogo provider="hyperframes" size="xs" framed={false} aria-hidden />
            <UserContent translate="no" className="font-semibold text-ink [overflow-wrap:anywhere]">
              {name}
            </UserContent>
            <span className="text-ink-2 tabular-nums">
              <span className="sr-only">{t`Plays from ${from} to ${to}`}</span>
              <span aria-hidden>{t`${from}–${to}`}</span>
            </span>
          </p>
          <p className="m-0 flex items-start gap-2 text-sm text-ink">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-strong" />
            <span>{t`Proposed: it plays in the viewer and isn’t in your video yet.`}</span>
          </p>
        </div>
      </div>
      {actions ? <ProposalActions {...props} /> : null}
    </section>
  );
}

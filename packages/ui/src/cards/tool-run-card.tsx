// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: tool-run-row · mode: Operate · system: DESIGN.md (A3, A12)
 * Flat outcome and timing inside the activity, with no second disclosure.
 * States: running · succeeded · cancelled · failed (cause and fix remain visible). */

import { useLingui } from '@lingui/react';
import { Plural, useLingui as useLinguiMacro } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { CallChip, formatMotionGraphicSummary } from '../chat/call-chip';
import { ImageGeneration } from '../chat/image-generation';
import { StatusMark } from '../chat/status-mark';
import { useCardActions } from './card-actions';
import { UserContent } from './card-frame';
import { ErrorLine } from './error-line';
import { TOOL_STATUS_LABELS, toolLabel } from './labels';
import { SavedCoverResult } from './saved-cover-result';

export interface ToolRunRowProps {
  card: CardOf<'toolRun'>;
  className?: string;
  /** The parent already names this group of calls. */
  grouped?: boolean;
}

/** A successful process exit is diagnostic metadata, not a user-facing result. */
export function toolOutcome(
  card: CardOf<'toolRun'>,
  developerMode: boolean | undefined,
  graphicLabel: string,
): string {
  if (!card.summary) return '';
  const technicalSuccess =
    card.status === 'succeeded' && /^exit(?: code)?\s*:?\s*0[.!]?$/i.test(card.summary.trim());
  return technicalSuccess && !developerMode ? '' : formatMotionGraphicSummary(card.summary, graphicLabel);
}

/**
 * One tool call as a row in the run (DESIGN.md v0.2, A3): a CallChip with
 * the tool's plain name and a live timer, then what it found, then an error
 * line if it failed. Never a card; never a card inside a card.
 */
export function ToolRunRow({ card, className, grouped = false }: ToolRunRowProps) {
  const { i18n } = useLingui();
  const { t } = useLinguiMacro();
  const format = useFormatters();
  const actions = useCardActions();
  const artifacts = card.artifactIds?.length ?? 0;
  const isImageGeneration =
    (card.tool === 'images.generateForSlot' || card.tool === 'images.generateThumbnail') &&
    (card.status === 'running' || card.status === 'failed');
  const displaySummary = toolOutcome(card, actions.developerMode, t`Motion graphic`);
  const elapsedMs = card.finishedAt !== undefined ? Math.max(0, card.finishedAt - card.startedAt) : undefined;
  return (
    <div
      data-slot="tool-run"
      data-card-type="toolRun"
      data-status={card.status}
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {grouped ? (
          <>
            <StatusMark status={card.status === 'succeeded' ? 'done' : card.status} className="shrink-0" />
            <span className="sr-only">{toolLabel(i18n, card.tool)}</span>
          </>
        ) : (
          <CallChip name={toolLabel(i18n, card.tool)} tool={card.tool} status={card.status} />
        )}
        {displaySummary ? (
          <p className="m-0 min-w-0 flex-1 basis-44 break-words text-sm text-ink-2">
            <UserContent>{displaySummary}</UserContent>
          </p>
        ) : grouped ? (
          <span className="text-sm text-ink-2">{i18n._(TOOL_STATUS_LABELS[card.status])}</span>
        ) : null}
        {elapsedMs !== undefined ? (
          <span className="shrink-0 type-meta text-ink-3 tabular-nums">{format.duration(elapsedMs)}</span>
        ) : null}
      </div>
      {isImageGeneration ? (
        <ImageGeneration
          status={card.status === 'running' ? 'generating' : 'error'}
          aspectRatio="9:16"
          {...(card.summary ? { prompt: card.summary } : {})}
          className="max-w-44 pt-0.5"
        />
      ) : null}
      {artifacts > 0 ? (
        <p className="m-0 text-xs text-ink-3">
          <Plural value={artifacts} one="# result saved" other="# results saved" />
        </p>
      ) : null}
      {card.error ? (
        <ErrorLine
          error={card.error}
          onReport={actions.report}
          {...(actions.developerMode === undefined ? {} : { showDetail: actions.developerMode })}
          {...(actions.runFix ? { onFix: actions.runFix } : {})}
        />
      ) : null}
      {actions.developerMode ? (
        <code translate="no" className="text-xs text-ink-3">
          {card.tool}
        </code>
      ) : null}
    </div>
  );
}

/** A tool call shown on its own (no plan around it): the same row. */
export function ToolRunCard({ card }: { card: CardOf<'toolRun'> }) {
  return card.savedCover ? <SavedCoverResult cover={card.savedCover} /> : <ToolRunRow card={card} />;
}

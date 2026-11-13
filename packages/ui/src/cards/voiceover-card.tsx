// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: voiceover card (U-1, P3-B6) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel (unboxed on the canvas): the voice (its name as the provider wrote it, a
 *   teal "Your voice" when it is yours), the language, Draft/Final/Mixed, the cut's preview on the viewer grey
 *   beside the lines (media/voice-lines.tsx), what it has cost; Change voice and Make final are paid follow-ups to
 *   the run (the agent's cost card first); the music under the voice (media/ducking-control.tsx) and Remove
 *   voiceover are free commands, undoable
 * states: loading (the snapshot, then the live timeline) · default · removed (the words and Undo) · gone (the video
 *   was deleted: no actions) · each control's eight states are its Button's, Switch's or textarea's; error and
 *   success lines under the controls (media/media-lines.tsx)
 * motion: none of its own (the preview plays) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, SelectionChip } from '@taalcut/core';
import { AudioLines, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { languageName } from '../hub/hub-words';
import { ShotThumb } from '../make/shot-thumb';
import { DuckingControl } from '../media/ducking-control';
import { useMediaData, type PreviewPlayFrom } from '../media/media-actions';
import { REMOVE_VOICEOVER } from '../media/media-commands';
import { ChangedLine, FollowUpLine, MediaError } from '../media/media-lines';
import { slotItem, voiceClipSpans } from '../media/timeline-reads';
import { useCommand, useFollowUp } from '../media/use-command';
import { VoiceLines, type VoiceLineRow } from '../media/voice-lines';
import { UserContent } from './card-frame';
import { useTimelineRead } from './card-data';
import { legacyValue } from './live-read';
import { LiveReadLine } from './live-read-line';
import { StepHeader } from './step-header';

type Card = CardOf<'voiceover'>;

/** U-1: the voiceover the Voice director made, its lines and the music under it. */
export function VoiceoverCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const data = useMediaData();
  const watched = useTimelineRead(card.timelineId);
  const live = legacyValue(watched.read);
  const command = useCommand();
  const followUp = useFollowUp(card.runId);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  const [playFrom, setPlayFrom] = useState<PreviewPlayFrom | null>(null);
  const gone = watched.read.status === 'gone';
  // The live timeline wins once it is in: without a voiceover there, the card's lines are history.
  const without = live !== null && live !== undefined && live.voiceover === null;
  const removed = without && command.done === 'remove';
  const voiceover = live?.voiceover ?? card.voiceover;
  const quality = qualityOf(voiceover.lines, card.quality);
  const spans = live ? voiceClipSpans(live) : null;
  const rows: VoiceLineRow[] = voiceover.lines.map((line) => ({
    line,
    slot: live && line.slotId ? (slotItem(live, line.slotId)?.number ?? null) : null,
    span: (line.clipId && spans?.get(line.clipId)) || null,
  }));
  const language = languageName(i18n, voiceover.language);
  const title = t`Voiceover`;
  const spent = format.money(card.spent);
  const finalCost = card.finalizeEstimate ? format.money(card.finalizeEstimate) : null;
  const qualityWord = { draft: t`Draft`, final: t`Final`, mixed: t`Draft and final` }[quality];

  const editLine = (row: VoiceLineRow, index: number, text: string) => {
    const n = i18n.number(index + 1);
    const chips: SelectionChip[] = row.line.clipId
      ? [{ kind: 'clip', timelineId: card.timelineId, clipId: row.line.clipId }]
      : [];
    return followUp.send(`line:${index}`, t`Change line ${n} of the voiceover to: “${text}”`, chips);
  };
  const preview = live
    ? {
        projectId: card.projectId,
        timelineId: card.timelineId,
        revision: live.revision,
        label: t`Preview of your cut with the voiceover`,
        onFrame: setPlayhead,
      }
    : null;

  return (
    <article
      data-slot="smart-card"
      data-card-type="voiceover"
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-3"
    >
      <StepHeader
        title={title}
        aside={
          <Chip tone={quality === 'final' ? 'success' : 'neutral'} data-slot="voice-quality">
            {qualityWord}
          </Chip>
        }
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <AudioLines aria-hidden className="size-4 shrink-0 text-ink-3" />
        <UserContent translate="no" className="font-semibold text-ink">
          {voiceover.voiceName || t`Unnamed voice`}
        </UserContent>
        {voiceover.own ? <Chip tone="you">{t`Your voice`}</Chip> : null}
        <span aria-hidden>·</span>
        <span>{language}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{t`${spent} spent so far`}</span>
      </div>
      {gone ? (
        <p className="m-0 text-sm text-ink-2">{t`This video was deleted.`}</p>
      ) : removed ? (
        <ChangedLine projectId={card.projectId}>{t`Voiceover removed from this video.`}</ChangedLine>
      ) : without ? (
        <p className="m-0 text-sm text-ink-2">{t`This video has no voiceover now.`}</p>
      ) : (
        <>
          <div className="flex items-start gap-4">
            <div className="w-20 shrink-0 sm:w-24">
              {preview && data.renderPreviewFrom ? (
                data.renderPreviewFrom({ ...preview, playFrom })
              ) : preview && data.renderPreview ? (
                data.renderPreview(preview)
              ) : (
                <ShotThumb url={null} size="lg" className="w-full" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <VoiceLines
                rows={rows}
                playhead={playhead}
                onPlay={
                  preview && data.renderPreviewFrom
                    ? (frame) => setPlayFrom((was) => ({ frame, key: (was?.key ?? 0) + 1 }))
                    : undefined
                }
                onEdit={followUp.can ? editLine : undefined}
                sending={followUp.busy?.startsWith('line:') ? Number(followUp.busy.slice(5)) : null}
              />
            </div>
          </div>
          {followUp.can || command.can ? (
            <div className="flex flex-wrap items-center gap-2">
              {followUp.can ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={followUp.busy === 'voice'}
                  onClick={() => void followUp.send('voice', t`Try a different voice for the voiceover.`)}
                >
                  {t`Change voice`}
                </Button>
              ) : null}
              {followUp.can && finalCost && quality !== 'final' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={followUp.busy === 'final'}
                  onClick={() => void followUp.send('final', t`Make the voiceover final.`)}
                >
                  {t`Make final · about ${finalCost}`}
                </Button>
              ) : null}
              {command.can ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  loading={command.busy === 'remove'}
                  onClick={() =>
                    void command.run('remove', REMOVE_VOICEOVER, {
                      projectId: card.projectId,
                      timelineId: card.timelineId,
                    })
                  }
                >
                  <Trash2 aria-hidden />
                  {t`Remove voiceover`}
                </Button>
              ) : null}
            </div>
          ) : null}
          <FollowUpLine followUp={followUp} />
          {command.error ? <MediaError error={command.error.error} /> : null}
          {card.ducking ? (
            <DuckingControl
              projectId={card.projectId}
              timelineId={card.timelineId}
              measured={card.ducking}
              live={live?.mix.ducking}
            />
          ) : null}
        </>
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={false} />
    </article>
  );
}

/** Draft, final or both, from the lines as they are now (the card's word until there are lines). */
function qualityOf(lines: Card['voiceover']['lines'], fallback: Card['quality']): Card['quality'] {
  if (lines.length === 0) return fallback;
  const finals = lines.filter((line) => line.quality === 'final').length;
  return finals === 0 ? 'draft' : finals === lines.length ? 'final' : 'mixed';
}

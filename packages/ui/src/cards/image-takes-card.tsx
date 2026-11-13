// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: image takes card (U-6, P3-B7) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a decision card (CardFrame): which generated still goes in a slot. Its slot's number,
 *   the "Generated" chip (violet with the AI mark: the AI made these), up to four takes (media/take-grid.tsx) with
 *   who made each, the one in the video, what they cost; picking another is timeline.swapClip (or timeline.fillGap
 *   while the slot is still a gap), free and undoable; Make more is a paid follow-up to the run
 * states: default · picking (the take's spinner; the others wait) · changed (the ring moves, "Changed" with Undo) ·
 *   no slot (not in the video now: takes shown, not pickable) · gone (the video was deleted) · error (the line under
 *   the takes) · Make more's eight states are its Button's
 * motion: none of its own · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { AssetId, CardOf, SelectionChip } from '@taalcut/core';
import { ImagePlus } from 'lucide-react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { FILL_GAP, SWAP_CLIP } from '../media/media-commands';
import { ChangedLine, FollowUpLine, MediaError } from '../media/media-lines';
import { TakeGrid } from '../media/take-grid';
import { slotItem } from '../media/timeline-reads';
import { useCommand, useFollowUp } from '../media/use-command';
import { ImageGeneration } from '../chat/image-generation';
import { CardFrame } from './card-frame';
import { useTimelineRead } from './card-data';
import { legacyValue } from './live-read';
import { LiveReadLine } from './live-read-line';

type Card = CardOf<'imageTakes'>;
type Take = Card['takes'][number];

/** U-6: the stills generated for a slot, before more are paid for. */
export function ImageTakesCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const watched = useTimelineRead(card.timelineId);
  const live = legacyValue(watched.read);
  const command = useCommand();
  const followUp = useFollowUp(card.runId);
  const slot = live ? slotItem(live, card.slotId) : null;
  const deleted = watched.read.status === 'gone';
  const noSlot = live !== null && live !== undefined && slot === null;
  const takes = new Set(card.takes.map((take) => take.assetId));
  const liveAsset: AssetId | null = slot?.kind === 'clip' ? slot.clip.media.assetId : null;
  const placed = live ? (liveAsset && takes.has(liveAsset) ? liveAsset : null) : card.placed;
  const number = slot ? i18n.number(slot.number) : null;
  const title = number ? t`Images for slot ${number}` : t`Images for a slot`;
  const total = card.takes.length;
  const spent = format.money(card.spent);
  const picking = card.takes.find((take) => command.busy === `take:${take.assetId}`)?.assetId ?? null;
  const firstTake = card.takes[0];

  const pick = (take: Take) => {
    if (!slot) return;
    const target = { projectId: card.projectId, timelineId: card.timelineId };
    void (slot.kind === 'clip'
      ? command.run(`take:${take.assetId}`, SWAP_CLIP, {
          ...target,
          clipId: slot.clip.id,
          media: { assetId: take.assetId, shotId: null },
          from: 'alternate',
        })
      : command.run(`take:${take.assetId}`, FILL_GAP, {
          ...target,
          gapId: slot.gap.id,
          media: { kind: 'image', assetId: take.assetId },
        }));
  };
  const chips: SelectionChip[] =
    slot?.kind === 'clip'
      ? [{ kind: 'clip', timelineId: card.timelineId, clipId: slot.clip.id }]
      : live?.template
        ? [{ kind: 'slot', templateId: live.template.id, slotId: card.slotId }]
        : [];

  return (
    <CardFrame
      cardType="imageTakes"
      title={title}
      aside={
        <Chip tone="ai">
          <AiMark aria-hidden />
          {t`Generated`}
        </Chip>
      }
    >
      {deleted ? (
        <p className="m-0 text-sm text-ink-2">{t`This video was deleted.`}</p>
      ) : (
        <>
          <p className="m-0 text-sm text-ink-2 tabular-nums">{t`${plural(total, { one: '# take', other: '# takes' })} · ${spent} so far`}</p>
          <TakeGrid
            takes={card.takes}
            placed={placed}
            disabled={!command.can || slot === null}
            picking={picking}
            onPick={pick}
          />
          {followUp.busy === 'more' ? (
            <ImageGeneration
              status="generating"
              aspectRatio="9:16"
              {...(firstTake ? { provider: firstTake.provider, model: firstTake.model } : {})}
              className="max-w-44"
            />
          ) : null}
          {noSlot ? <p className="m-0 text-sm text-ink-2">{t`This slot isn’t in the video now.`}</p> : null}
          {command.done?.startsWith('take:') ? (
            <ChangedLine projectId={card.projectId}>{t`Image changed.`}</ChangedLine>
          ) : null}
          {command.error ? <MediaError error={command.error.error} /> : null}
          {followUp.can ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={followUp.busy === 'more'}
                onClick={() =>
                  void followUp.send(
                    'more',
                    number ? t`Make more images for slot ${number}.` : t`Make more images for this slot.`,
                    chips,
                  )
                }
              >
                <ImagePlus aria-hidden />
                {t`Make more`}
              </Button>
              <span className="text-xs text-ink-2">{t`More takes cost money: Taalcut shows the cost first.`}</span>
            </div>
          ) : null}
          <FollowUpLine followUp={followUp} />
        </>
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={false} />
    </CardFrame>
  );
}

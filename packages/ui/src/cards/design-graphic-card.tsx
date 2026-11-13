// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: designed graphic card (HFW1-UI) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the motion graphic card's variant for a graphic the AI designed: a step panel (unboxed)
 *   titled with its design's name (the model's words, shown as content), never a kind; while it is a proposal it
 *   leads with the designed proposal row (a still from its newest render, the name, when it plays, Use it, Try
 *   again, Change…), then "Added to your video." once used. Timing is a read-only summary; Edit in video opens
 *   its graphic in the editor, where words, colours and duration live together with the preview.
 * states: loading (the card's snapshot until the live timeline is in) · default · proposed · changed by you (teal
 *   chip) · removed (the words and Undo) · gone (not on the timeline, or the video deleted: no actions) · each
 *   control's own eight · errors under the control that failed
 * motion: none · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, SelectionChip } from '@taalcut/core';
import { useId } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { ShotThumb, StillName } from '../make/shot-thumb';
import { clipShot } from '../make/timeline-math';
import { useTimecode } from '../make/timecode';
import { useShotFrames } from '../make/use-shot-frames';
import { DesignProposalRow } from '../media/design-proposal';
import { designOf } from '../media/design-reads';
import { useProposalChat } from '../media/graphic-proposal';
import { useMediaActions, useMediaData } from '../media/media-actions';
import { USE_PROPOSAL } from '../media/media-commands';
import { ChangedLine } from '../media/media-lines';
import { clipAt, graphicOn } from '../media/timeline-reads';
import { useCommand } from '../media/use-command';
import { UserContent } from './card-frame';
import { useTimelineRead } from './card-data';
import { legacyValue } from './live-read';
import { LiveReadLine } from './live-read-line';
import { StepHeader } from './step-header';
import { UnmatchedRow } from './unmatched-row';

type Card = CardOf<'motionGraphic'>;

/** A record of the designed graphic; editing stays beside the video. */
export function DesignGraphicCard({ card }: { card: Card }) {
  const { t } = useLingui();
  const time = useTimecode();
  const labelId = useId();
  const stillId = useId();
  const data = useMediaData();
  const { editTurn } = useMediaActions();
  const watched = useTimelineRead(card.timelineId);
  const live = legacyValue(watched.read);
  const command = useCommand();
  const item = live ? graphicOn(live, card.itemId) : null;
  const design = designOf(live, item);
  const deleted = watched.read.status === 'gone';
  const missing = live !== null && live !== undefined && item === null;
  const start = item?.start ?? card.start;
  const duration = item?.duration ?? card.duration;
  const startWords = time.clock(start.value, start.rate, { fraction: true });
  const lengthWords = time.length(duration.value, duration.rate);
  const off = !command.can || deleted || missing;
  const name = design?.name ?? card.composition.name;
  const unmatched = item?.anchor.kind === 'time' && item.origin === 'user' ? [] : card.unmatched;
  // A still from its newest render when the app can show it, else the frame of the shot it sits on.
  const under = live ? clipAt(live, start.value) : null;
  const shots = useShotFrames(under ? [clipShot(under)] : []);
  const poster =
    (card.frameArtifactId ? data.artifactUrl?.(card.frameArtifactId) : null) ??
    (under ? (shots(clipShot(under))?.url ?? null) : null);
  const target = { projectId: card.projectId, timelineId: card.timelineId, itemId: card.itemId };
  const proposal = item?.proposal ?? null;
  const chip: SelectionChip = {
    kind: 'item',
    timelineId: card.timelineId,
    itemId: card.itemId,
    itemKind: 'graphic',
  };
  const proposalChat = useProposalChat(card.runId, chip);
  const title = (
    <UserContent translate="no" className="[overflow-wrap:anywhere]">
      {name}
    </UserContent>
  );

  return (
    <article
      data-slot="smart-card"
      data-card-type="motionGraphic"
      data-design=""
      aria-labelledby={labelId}
      className="flex max-w-[42rem] flex-col gap-3"
    >
      {/* Its name for a screen reader: the design's name as the model wrote it, the words before it translated. */}
      <span id={labelId} className="sr-only">
        <Trans>
          Motion graphic: <UserContent translate="no">{name}</UserContent>
        </Trans>
      </span>
      <StepHeader
        title={title}
        aside={item?.origin === 'user' ? <Chip tone="you">{t`You changed this`}</Chip> : null}
      />
      {deleted ? (
        <p className="m-0 text-sm text-ink-2">{t`This video was deleted.`}</p>
      ) : missing ? (
        <p className="m-0 text-sm text-ink-2">{t`The graphic isn’t on the timeline now.`}</p>
      ) : (
        <>
          {proposal ? (
            <DesignProposalRow
              name={name}
              start={start}
              duration={duration}
              poster={poster}
              {...proposalChat}
              actions={!off}
              disabled={off}
              using={command.busy === 'use'}
              useError={command.error?.key === 'use' ? command.error.error : null}
              onUse={() => void command.run('use', USE_PROPOSAL, target)}
            />
          ) : command.done === 'use' ? (
            <ChangedLine projectId={card.projectId}>{t`Added to your video.`}</ChangedLine>
          ) : null}
          {unmatched.length > 0 ? <UnmatchedRow phrases={unmatched} /> : null}
          <div className="flex items-start gap-4">
            {proposal ? null : (
              <>
                <StillName id={stillId} name={name} />
                <ShotThumb url={poster} size="lg" className="w-20 sm:w-24" labelledBy={stillId} />
              </>
            )}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <p className="m-0 text-sm text-ink-2 tabular-nums">
                {t`Starts at ${startWords} · lasts ${lengthWords}`}
              </p>
              {editTurn ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    editTurn.open(card.projectId, chip, (start.value * start.rate.den) / start.rate.num)
                  }
                >
                  {t`Edit in video`}
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={false} />
    </article>
  );
}

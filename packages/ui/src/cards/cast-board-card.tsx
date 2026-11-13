// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cast board card (P2-M3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · while asking it is the run's one decision card (VariantsQuestion); after that a step
 *   panel, unframed: a header line, video tabs when there are variants, then the cast grid on the sunken bed
 * states: asking (decision card) · casting (the AI's running mark, "Picking your clips…") · loading (bone rows in the
 *   grid's shape while a timeline loads) · default (the grid, live: a swap or ⌘Z shows without a new card) · changed
 *   since (teal "You changed this" in the header, from the step) · disabled (the timeline is gone: "This was
 *   deleted.", no actions) · error/success: the grid's rows
 * motion: the video tabs swap content at once (no slide); the grid's frame trade (shared layout) is the one
 *   motion on the card
 * UX round 1: a failed answer to "How many videos?" brings the question back with its cause and Try again (it used to
 *   settle as "Making 3 videos…"); a dropped watch keeps the board as last seen with Try again, never "deleted"
 * pre-emit critique: P5 H5 E4 S5 R5 V5 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { CardOf, ProjectId, TimelineId } from '@taalcut/core';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#components/tabs';
import { StatusMark } from '../chat/status-mark';
import { CastGrid } from '../make/cast-grid';
import { StepHeader } from './step-header';
import { VariantsQuestion } from '../make/variants-question';
import { UserContent } from './card-frame';
import { useCardData, useLiveTemplate, useLiveTimeline, useTimelineRead } from './card-data';
import { liveValue } from './live-read';
import { LiveReadLine } from './live-read-line';
import { AnswerFailureLine, useAnswer } from './use-answer';

function Bones() {
  const { t } = useLingui();
  return (
    <div aria-busy="true" data-slot="loading" className="flex flex-col gap-1 rounded-xl bg-panel p-2">
      <span className="sr-only">{t`Loading your clips`}</span>
      {[0, 1, 2, 3].map((row) => (
        <span key={row} aria-hidden className="flex items-center gap-3 px-1 py-1.5">
          <span className="tc-bone block h-4 w-4 rounded-sm bg-hover" />
          <span className="tc-bone block h-[71px] w-10 rounded-md bg-hover" />
          <span className="tc-bone block h-4 flex-1 rounded-sm bg-hover" />
          <span className="tc-bone block h-[71px] w-32 rounded-md bg-hover" />
        </span>
      ))}
    </div>
  );
}

function Board({
  cardId,
  projectId,
  timelineId,
}: {
  cardId: string;
  projectId: ProjectId;
  timelineId: TimelineId;
}) {
  const { t } = useLingui();
  const watched = useTimelineRead(timelineId);
  const timeline = liveValue(watched.read);
  const template = useLiveTemplate(timeline?.template?.id ?? null, timeline?.template?.version);
  const line = <LiveReadLine read={watched.read} onRetry={watched.retry} gone={t`This video was deleted.`} />;
  // Without a data source (the kit's own gallery) there is nothing to show, not a loss.
  if (watched.read.status === 'off') return null;
  if (!timeline) return watched.read.status === 'loading' ? <Bones /> : line;
  const rawName = timeline.name.trim();
  const customName = rawName && !/^video\s+\d+$/i.test(rawName) ? rawName : null;
  return (
    <div className="flex flex-col gap-2">
      {customName ? (
        <p data-slot="video-title" className="m-0 type-meta text-ink-2">
          <UserContent translate="no">{customName}</UserContent>
        </p>
      ) : null}
      <CastGrid
        cardId={`${cardId}:${timelineId}`}
        projectId={projectId}
        timeline={timeline}
        slots={template?.template.slots ?? null}
      />
      {line}
    </div>
  );
}

/**
 * The run's one question. The make lane's VariantsQuestion settles itself once its answer resolves, so a failed
 * answer starts it again (a new key) with the cause and Try again under it.
 */
function Asking({
  card,
  asking,
}: {
  card: CardOf<'castBoard'>;
  asking: NonNullable<CardOf<'castBoard'>['asking']>;
}) {
  const answer = useAnswer<'count'>();
  const [round, setRound] = useState(0);
  const { approvalId, suggested, slotCount } = asking;
  const send = async (count: number) => {
    const outcome = await answer.send('count', approvalId, 'approve', {
      answer: { kind: 'variants', count },
    });
    if (outcome === null) setRound((n) => n + 1);
  };
  return (
    <div data-card-id={card.id} className="flex max-w-[42rem] flex-col gap-2">
      <VariantsQuestion
        key={round}
        suggested={suggested}
        slotCount={slotCount}
        {...(answer.canAnswer ? { onAnswer: send } : {})}
      />
      <AnswerFailureLine failure={answer.failure} />
    </div>
  );
}

function VideoTabTrigger({ timelineId, index }: { timelineId: TimelineId; index: number }) {
  const { t, i18n } = useLingui();
  const timeline = useLiveTimeline(timelineId);
  const n = i18n.number(index + 1);
  const raw = timeline?.name.trim() ?? '';
  const custom = raw && !/^video\s+\d+$/i.test(raw) ? raw : null;
  const label = t`Video ${n}`;
  return (
    <TabsTrigger value={String(index)} title={custom ? `${label} · ${custom}` : undefined}>
      {label}
    </TabsTrigger>
  );
}

export function CastBoardCard({ card }: { card: CardOf<'castBoard'> }) {
  const { t } = useLingui();
  const data = useCardData();
  const [shown, setShown] = useState(0);

  if (card.asking) return <Asking card={card} asking={card.asking} />;

  const title = t`Your clips, slot by slot`;
  const casting = card.castId === null || card.timelineIds.length === 0;
  const videos = card.timelineIds;
  return (
    <article
      data-slot="smart-card"
      data-card-type="castBoard"
      data-casting={casting || undefined}
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-3"
    >
      <StepHeader title={title} step={card.step} />
      {casting ? (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-ink">
          <StatusMark status="running" />
          {t`Picking your clips…`}
        </p>
      ) : (
        <>
          {card.lowConfidence > 0 ? (
            <p className="m-0 text-sm text-ink-2">
              <Plural
                value={card.lowConfidence}
                one="# pick was a close call, so Taalcut checked it again. Swap it if it isn’t right."
                other="# picks were close calls, so Taalcut checked them again. Swap any that aren’t right."
              />
            </p>
          ) : null}
          {/* Without a data source (the kit's own renders) there is no board to show, so no tabs either. */}
          {!data.watchTimeline ? null : videos.length > 1 ? (
            <Tabs value={String(shown)} onValueChange={(value) => setShown(Number(value))}>
              <TabsList aria-label={t`Videos`}>
                {videos.map((id, index) => (
                  <VideoTabTrigger key={id} timelineId={id} index={index} />
                ))}
              </TabsList>
              {videos.map((id, index) => (
                <TabsContent key={id} value={String(index)}>
                  <Board cardId={card.id} projectId={card.projectId} timelineId={id} />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <Board cardId={card.id} projectId={card.projectId} timelineId={videos[0]!} />
          )}
        </>
      )}
    </article>
  );
}

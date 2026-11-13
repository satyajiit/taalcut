// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: breakdown card, "The reel, slot by slot" (BRK1-REV) · system: DESIGN.md v0.7
 * a step panel in the chat, not a decision card: a summary, then the review. The reel's own frames at its shape on
 *   its time axis, the cuts marked and the ones Taalcut isn't sure of flagged; its facts; how much is left to check,
 *   in words; Review the reel (the review as a large sheet over the chat, which goes on underneath) and Approve as
 *   it is. Nothing to edit in the card itself: the review is where you judge and fix
 * states: loading (analysing by stage: done, in progress with a neutral spinner, waiting; a neutral bar; the job
 *   is background work, so never violet) · ready (the summary) · to check (the dashed warning circle and what's
 *   left, by kind) · nothing to check · approving (Approve as it is spins) · approved (the success check and its
 *   word) · error (the cause and its one fix) · cancelled ("Stopped") · changed since (teal "You changed this", or
 *   the AI mark) · gone ("This template was deleted.", no actions) · reviewing (the sheet is open)
 * layout: fits a narrow chat column (the editor's): the strip shows fewer frames, the actions wrap
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { BreakdownStage, CardOf } from '@taalcut/core';
import { AudioLines, Check, Circle, Layers, LoaderCircle, Music, Timer } from 'lucide-react';
import { useState } from 'react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { toSeconds } from '../templates/slot-words';
import { useFormatters } from '#lib/format';
import { checkItems, checkSummary, reviewCounts } from '../templates/review-checks';
import { REVIEW_ICONS } from '../templates/review-icons';
import { ReelFilmstrip } from '../templates/reel-filmstrip';
import { ReviewSheet } from '../templates/review-sheet';
import { usePrimaryVariant } from './primary-holder';
import { useCardActions } from './card-actions';
import { useCardData, useTemplateRead, type TemplateAt } from './card-data';
import { liveValue } from './live-read';
import { LiveReadLine } from './live-read-line';
import { ErrorLine } from './error-line';
import { toast } from '../feedback/toast-store';
import { VERB_ICONS } from '../icons/concepts';

type Working = Exclude<BreakdownStage, 'ready' | 'failed' | 'cancelled'>;

const STAGE_WORDS: Readonly<Record<Working, MessageDescriptor>> = {
  fetching: msg`Getting the reel`,
  preparing: msg`Preparing it`,
  cuts: msg`Finding the cuts`,
  beats: msg`Finding the beats`,
  text: msg`Reading the text on screen`,
  speech: msg`Listening to what’s said`,
  contactSheet: msg`Keeping a frame from each slot`,
  intents: msg`Writing what each shot is`,
};
const ORDER = Object.keys(STAGE_WORDS) as Working[];

function Stages({ card }: { card: CardOf<'breakdown'> }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const steps = card.source.input === 'link' ? ORDER : ORDER.filter((stage) => stage !== 'fetching');
  const at = steps.indexOf(card.stage as Working);
  const fraction = card.progress?.fraction ?? null;
  const percent = fraction === null ? undefined : format.percent(fraction);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="progressbar"
        aria-label={t`Reading the reference`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        aria-valuetext={percent}
        className="h-1 overflow-hidden rounded-pill bg-hover"
      >
        <span
          className={cn(
            'block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)',
            fraction === null && 'tc-global-loader-bar w-1/3',
          )}
          style={fraction === null ? undefined : { transform: `scaleX(${fraction})` }}
        />
      </div>
      <ol aria-label={t`Steps`} className="m-0 flex list-none flex-col gap-1.5 p-0">
        {steps.map((stage, index) => {
          const state = index < at ? 'done' : index === at ? 'running' : 'waiting';
          return (
            <li key={stage} data-state={state} className="flex items-center gap-2 text-sm">
              {state === 'done' ? (
                <Check aria-hidden className="size-3.5 shrink-0 text-ink-3" />
              ) : state === 'running' ? (
                <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-ink-2" />
              ) : (
                <Circle aria-hidden className="size-3.5 shrink-0 text-rule-strong" />
              )}
              <span
                className={
                  state === 'waiting'
                    ? 'text-ink-3'
                    : state === 'running'
                      ? 'font-medium text-ink'
                      : 'text-ink-2'
                }
              >
                {i18n._(STAGE_WORDS[stage])}
              </span>
              <span className="sr-only">
                {state === 'done' ? t`done` : state === 'running' ? t`in progress` : t`waiting`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The ready card: the reel's frames, its facts, what's left to check, and the way into the review. */
function Summary({ card, at }: { card: CardOf<'breakdown'>; at: TemplateAt }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const data = useCardData();
  const primary = usePrimaryVariant(card.id);
  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const { template, summary } = at;
  const projectId = summary.projectId ?? null;
  const items = checkItems(template);
  const counts = reviewCounts(template, items);
  const sheetUrl = template.contactSheet ? (data.templateAssetUrl?.(template.contactSheet) ?? null) : null;
  const reelUrl = summary.media ? (data.templateReel?.(template.id) ?? null) : null;
  const unsure = new Set(
    items.flatMap((item) =>
      item.target.kind === 'slot' && (item.reason === 'cutUnsure' || item.reason === 'cutMaybeTransition')
        ? [item.target.slotId]
        : [],
    ),
  );
  const length = i18n.number(toSeconds(template.duration), {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 1,
  });
  const bpm = template.beatMap?.bpm ? i18n.number(Math.round(template.beatMap.bpm)) : null;
  const left = i18n.number(counts.toCheck);
  const what = checkSummary(i18n, items);
  const ToCheck = REVIEW_ICONS.toCheck;
  const Approved = REVIEW_ICONS.approved;
  const approveAll = async () => {
    if (!actions.dispatch) return;
    setApproving(true);
    const slotIds = template.slots.filter((slot) => !slot.approved).map((slot) => slot.id);
    const done = await actions.dispatch('template.slot.approve', {
      projectId,
      templateId: template.id,
      baseVersion: template.version,
      slotIds,
      approved: true,
    });
    setApproving(false);
    // Approving every slot unseen is one command: it says so, with Undo (as ⌘Z), since nothing else on the card moves.
    if (done.ok) {
      const count = slotIds.length;
      const undo = actions.undo;
      toast({
        title: t`${plural(count, { one: '# slot approved', other: '# slots approved' })}`,
        ...(undo ? { action: { label: t`Undo`, onSelect: () => void undo() } } : {}),
      });
    }
  };
  return (
    <div data-slot="breakdown-summary" className="flex flex-col gap-3">
      <ReelFilmstrip template={template} sheetUrl={sheetUrl} unsure={unsure} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>
          <Layers aria-hidden />
          <Plural value={template.slots.length} one="# slot" other="# slots" />
        </Chip>
        <Chip>
          <Timer aria-hidden />
          {length}
        </Chip>
        {bpm ? (
          <Chip tone="beat">
            <AudioLines aria-hidden />
            {t`${bpm} beats a minute`}
          </Chip>
        ) : null}
        {summary.media?.hasAudio ? (
          <Chip>
            <Music aria-hidden />
            {t`Music kept`}
          </Chip>
        ) : null}
      </div>
      {/* Every slot approved is said first; what is still open (a line that may be part of the scene, the reel's
          sound) stays under it, since approving a slot never answers those. */}
      {counts.waiting === 0 ? (
        <p role="status" className="m-0 flex items-center gap-1.5 type-body text-success-strong">
          <Approved aria-hidden className="size-4 shrink-0" />
          {t`Approved`}
        </p>
      ) : null}
      {counts.toCheck > 0 ? (
        <p data-slot="breakdown-to-check" className="m-0 flex items-start gap-1.5 type-body text-ink">
          <ToCheck aria-hidden className="mt-1 size-4 shrink-0 text-warning-strong" />
          <span>
            {counts.waiting === 0 ? t`${left} still to check: ${what}.` : t`${left} to check: ${what}.`}
          </span>
        </p>
      ) : counts.waiting > 0 ? (
        <p className="m-0 flex items-center gap-1.5 type-body text-ink-2">
          <Approved aria-hidden className="size-4 shrink-0 text-success-strong" />
          {t`Taalcut is sure of every cut. Watch it once before you approve.`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={primary} icon={REVIEW_ICONS.review} onClick={() => setOpen(true)}>
          {t`Review the reel`}
        </Button>
        {counts.waiting > 0 && actions.dispatch ? (
          <Button
            size="sm"
            icon={REVIEW_ICONS.looksRight}
            loading={approving}
            onClick={() => void approveAll()}
          >
            {t`Approve as it is`}
          </Button>
        ) : null}
        {actions.navigate ? (
          <Button
            size="sm"
            variant="ghost"
            icon={VERB_ICONS.open}
            iconPlacement="end"
            onClick={() => actions.navigate?.({ to: 'template', templateId: template.id })}
          >
            {t`Open the template`}
          </Button>
        ) : null}
      </div>
      <ReviewSheet
        open={open}
        onOpenChange={setOpen}
        name={summary.name}
        template={template}
        reelUrl={reelUrl}
        sheetUrl={sheetUrl}
        projectId={projectId}
        dispatch={actions.dispatch}
        undo={actions.undo ? () => actions.undo!(projectId) : undefined}
        propose={actions.proposeEdits ? (input) => actions.proposeEdits!({ ...input, projectId }) : undefined}
      />
    </div>
  );
}

export function BreakdownCard({ card }: { card: CardOf<'breakdown'> }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const ref = card.template;
  const watched = useTemplateRead(ref?.id ?? null, undefined, ref?.version);
  const live = liveValue(watched.read);
  const gone = ref !== null && watched.read.status === 'gone';
  const step = card.step;
  const stepAt = step ? i18n.number(step.index) : null;
  const stepOf = step ? i18n.number(step.count) : null;

  const title = live ? t`The reel, slot by slot` : t`Reading the reference`;
  return (
    <article
      data-slot="smart-card"
      data-card-type="breakdown"
      data-stage={card.stage}
      aria-label={title}
      className="flex max-w-[42rem] min-w-0 flex-col gap-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 type-card-title text-ink">{title}</h3>
        {step ? <span className="type-meta text-ink-2">{t`Step ${stepAt} of ${stepOf}`}</span> : null}
        {live?.changedBy === 'you' ? <Chip tone="you">{t`You changed this`}</Chip> : null}
        {live?.changedBy === 'ai' ? (
          <span className="flex items-center gap-1 type-meta text-ink-2">
            <AiMark className="size-3" />
            {t`Taalcut changed this`}
          </span>
        ) : null}
      </header>

      {card.stage === 'failed' && card.error ? (
        <ErrorLine error={card.error} {...(actions.runFix ? { onFix: actions.runFix } : {})} />
      ) : card.stage === 'cancelled' ? (
        <p className="m-0 type-body text-ink-2">{t`Stopped. Paste the link again to start over.`}</p>
      ) : gone ? (
        <p className="m-0 type-body text-ink-2">{t`This template was deleted.`}</p>
      ) : live ? (
        <Summary card={card} at={live} />
      ) : (
        <Stages card={card} />
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={false} />
    </article>
  );
}

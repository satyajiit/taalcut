// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review's panel, the slot on screen in words (BRK1-REV) · system: DESIGN.md
 *   v0.7
 * what to judge, then how to act on it: anything about the whole reel Taalcut isn't sure of (its beat, its speech,
 *   its sound's credit) with its fix; the slot's number, part and status; where it sits in seconds and beats; what
 *   Taalcut isn't sure of in it; what it shows (editable); the cut into it as the frame before and the frame after;
 *   its text on screen. The actions stay in view under it: Looks right (the screen's one primary while anything is
 *   left to check), Fix, and Tell Taalcut
 * states: default · current item (the row the review is on takes the hover surface) · renaming (a field in the
 *   heading) · working (the pressed action spins; the rest wait) · error (one line under the actions) · approved
 *   (the success check and its word) · read-only (an older version: the words, no actions)
 */
import { useLingui } from '@lingui/react/macro';
import type { CameraMotion, DoubtReason, GraphicBriefPatch, Id, Template } from '@taalcut/core';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { RoleChip } from './kinds';
import { CutFrames } from './cut-frames';
import { CameraMove } from './camera-move';
import { DescriptionField } from './description-field';
import { DOUBT_WORDS, type CheckItem } from './review-checks';
import { REVIEW_ICONS } from './review-icons';
import { reveal } from './reveal';
import { SlotTexts } from './slot-texts';
import { cutLabel, slotBeats, toSeconds } from './slot-words';
import type { ReviewEdits } from './use-review-edits';

type TextId = Id<'TextOverlay'>;

export interface ReviewPanelProps {
  template: Template;
  index: number;
  items: readonly CheckItem[];
  current: CheckItem | null;
  reelUrl: string | null;
  sheetUrl: string | null;
  /** A cut being moved: the frames show its new place. */
  cutPreview: number | null;
  edits: ReviewEdits;
  editable: boolean;
  lit: TextId | null;
  onLit: (id: TextId | null) => void;
  renaming: boolean;
  onRenaming: (renaming: boolean) => void;
  /** The actions row: Looks right, Fix, Tell Taalcut (template-review.tsx). */
  actions: ReactNode;
  /** Tell Taalcut, when open. */
  tell: ReactNode;
  /** What Taalcut isn't sure of about the whole reel, first. */
  reel?: ReactNode;
  /** Not text or It's text took these keys: the review goes on to the next thing to check. */
  onAnswered?: ((keys: readonly string[]) => void) | undefined;
}

function Heading({
  template,
  index,
  editable,
  renaming,
  onRenaming,
  edits,
}: Pick<ReviewPanelProps, 'template' | 'index' | 'editable' | 'renaming' | 'onRenaming' | 'edits'>) {
  const { t, i18n } = useLingui();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const slot = template.slots[index]!;
  const [name, setName] = useState(slot.name ?? '');
  const number = i18n.number(index + 1);
  const count = i18n.number(template.slots.length);
  useEffect(() => setName(slot.name ?? ''), [slot.id, slot.name]);
  useEffect(() => {
    if (!renaming) return;
    field.current?.focus();
    field.current?.select();
  }, [renaming]);
  const save = async () => {
    const trimmed = name.trim();
    if ((slot.name ?? '') === trimmed) return onRenaming(false);
    if (await edits.run({ kind: 'rename', index, name: trimmed || null })) onRenaming(false);
  };
  if (renaming && editable)
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t`Name for slot ${number}`}
        </label>
        <Input
          ref={field}
          id={id}
          value={name}
          maxLength={60}
          placeholder={t`Slot ${number}`}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setName(slot.name ?? '');
              onRenaming(false);
            }
          }}
          className="h-8 max-w-56 flex-1"
        />
        <Button type="submit" size="sm" loading={edits.pending === 'rename'}>
          {t`Save name`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onRenaming(false)}>
          {t`Cancel`}
        </Button>
      </form>
    );
  return (
    // Where focus lands after a fix takes its own button away (reveal.ts): a heading, so Space still plays.
    <h3
      tabIndex={-1}
      data-landing="slot"
      className="m-0 rounded-sm type-card-title text-ink focus-visible:-outline-offset-2"
    >
      {slot.name ? (
        <>
          {t`Slot ${number} of ${count}:`} <UserContent translate="no">{slot.name}</UserContent>
        </>
      ) : (
        t`Slot ${number} of ${count}`
      )}
    </h3>
  );
}

export function ReviewPanel(props: ReviewPanelProps) {
  const { template, index, items, current, reelUrl, sheetUrl, cutPreview, edits, editable, lit, onLit } =
    props;
  const textItems = (id: TextId) =>
    items.filter((item) => item.target.kind === 'text' && item.target.overlayId === id);
  const notText = async (id: TextId) => {
    const gone = textItems(id).map((item) => item.key);
    if (await edits.run({ kind: 'notText', overlayIds: [id] })) props.onAnswered?.(gone);
  };
  const itsText = async (id: TextId) => {
    const doubt = textItems(id)[0];
    if (!doubt) return;
    const kept = await edits.run({
      kind: 'dismiss',
      target: { kind: 'text', overlayId: id },
      reason: doubt.reason,
    });
    if (kept) props.onAnswered?.([doubt.key]);
  };
  // A slot's own doubts are answered beside them, as the reel's and the text's are: a cut Taalcut isn't sure of is
  // kept (It's a cut) or joined to the slot before (Not a cut); a fade joins the slot before or stays.
  const answerSlot = async (reason: DoubtReason, join: boolean) => {
    const key = `slot:${template.slots[index]!.id}:${reason}`;
    const slotId = template.slots[index]!.id;
    const done = join
      ? await edits.run({ kind: 'notCut', slotId })
      : await edits.run({ kind: 'dismiss', target: { kind: 'slot', slotId }, reason });
    if (done) props.onAnswered?.([key]);
  };
  // FRM1-MOT: a camera move picked answers "isn't sure how the camera moves".
  const pickMotion = async (motion: CameraMotion | null) => {
    const slotId = template.slots[index]!.id;
    const asked = (template.slots[index]!.doubts ?? []).some((doubt) => doubt.reason === 'motionUnsure');
    const done = await edits.run({ kind: 'setMotion', slotId, motion });
    if (done && asked) props.onAnswered?.([`slot:${slotId}:motionUnsure`]);
  };
  // DSG1-READ: the line a graphic fix is about, so only its button spins.
  const [graphicLine, setGraphicLine] = useState<TextId | null>(null);
  const graphic = async (id: TextId, run: () => Promise<boolean>) => {
    setGraphicLine(id);
    const done = await run();
    setGraphicLine(null);
    return done;
  };
  const { t, i18n } = useLingui();
  const details = useRef<HTMLDivElement>(null);
  const currentKey = props.current?.key ?? null;
  // Another slot starts at its heading; the thing to check comes into view when J, K or Looks right moves to it.
  useEffect(() => {
    if (details.current) details.current.scrollTop = 0;
  }, [props.index]);
  useEffect(() => {
    if (!currentKey) return;
    reveal(details.current?.querySelector('[data-current]'));
  }, [currentKey, props.index]);
  const slot = template.slots[index]!;
  const ToCheck = REVIEW_ICONS.toCheck;
  const Approved = REVIEW_ICONS.approved;
  const seconds = (value: number) =>
    i18n.number(value, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 2 });
  const start = toSeconds(slot.start);
  const end = start + toSeconds(slot.duration);
  const from = seconds(start);
  const to = seconds(end);
  const long = seconds(end - start);
  const beats = slotBeats(template, slot);
  const firstBeat = beats ? i18n.number(beats.first) : null;
  const lastBeat = beats ? i18n.number(beats.first + beats.count - 1) : null;
  const doubts = slot.approved ? [] : (slot.doubts ?? []);
  const toCheck = items.some((item) => item.target.kind !== 'reel' && item.target.slotId === slot.id);
  const sure = i18n.number(slot.cut.confidence, { style: 'percent' });
  const method = cutLabel(i18n, slot.cut.method);
  const currentText = current?.target.kind === 'text' ? current.target.overlayId : null;
  const reelCurrent = current?.target.kind === 'reel';

  return (
    <div data-slot="review-panel" className="flex min-h-0 flex-col">
      {/* What's open about the whole reel stays above the slot's scroll until answered; the one current scrolls. */}
      {reelCurrent ? null : props.reel}
      <div
        ref={details}
        data-review-scroll
        // Positioned, so what it holds that is placed absolutely (a screen reader's label) scrolls and clips with it.
        className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pe-1 pb-3"
      >
        {reelCurrent ? props.reel : null}
        <section aria-label={t`This slot`} className="flex flex-col gap-3">
          <header className="flex flex-col gap-1.5">
            <Heading {...props} />
            <div className="flex flex-wrap items-center gap-2">
              <RoleChip role={slot.role} />
              {slot.approved ? (
                <span
                  data-slot="slot-status"
                  className="flex items-center gap-1 type-label-sm text-success-strong"
                >
                  <Approved aria-hidden className="size-3.5" />
                  {t`Approved`}
                </span>
              ) : toCheck ? (
                <span data-slot="slot-status" className="flex items-center gap-1 type-label-sm text-ink">
                  <ToCheck aria-hidden className="size-3.5 text-warning-strong" />
                  {t`To check`}
                </span>
              ) : null}
            </div>
            <p className="m-0 type-body text-ink-2 tabular-nums">
              {firstBeat && lastBeat && firstBeat !== lastBeat
                ? t`${from} to ${to}, ${long} long, beats ${firstBeat} to ${lastBeat}`
                : firstBeat
                  ? t`${from} to ${to}, ${long} long, on beat ${firstBeat}`
                  : t`${from} to ${to}, ${long} long`}
            </p>
          </header>
          {doubts.length > 0 ? (
            <ul aria-label={t`What Taalcut isn’t sure of`} className="m-0 flex list-none flex-col gap-1 p-0">
              {doubts.map((doubt) => {
                const cut = doubt.reason === 'cutUnsure' || doubt.reason === 'cutMaybeTransition';
                const joins = (cut || doubt.reason === 'fadeTail') && index > 0;
                return (
                  <li
                    key={doubt.reason}
                    data-current={current?.key === `slot:${slot.id}:${doubt.reason}` || undefined}
                    className="flex flex-col gap-1.5 rounded-md px-2 py-1 type-body text-ink data-current:bg-hover"
                  >
                    <p className="m-0 flex items-start gap-1.5">
                      <ToCheck aria-hidden className="mt-1 size-3.5 shrink-0 text-warning-strong" />
                      {i18n._(DOUBT_WORDS[doubt.reason])}
                    </p>
                    {editable ? (
                      <div data-slot="doubt-answers" className="flex flex-wrap gap-2 ps-5">
                        {doubt.reason === 'motionUnsure' ? (
                          <CameraMove
                            slot={slot}
                            number={i18n.number(index + 1)}
                            variant="answer"
                            busy={edits.pending === 'setMotion'}
                            disabled={edits.pending !== null}
                            onPick={(motion) => void pickMotion(motion)}
                          />
                        ) : null}
                        {joins ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={REVIEW_ICONS.notCut}
                            loading={edits.pending === 'notCut'}
                            disabled={edits.pending !== null && edits.pending !== 'notCut'}
                            onClick={() => void answerSlot(doubt.reason, true)}
                          >
                            {cut ? t`Not a cut` : t`Join the slot before`}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={REVIEW_ICONS.looksRight}
                          loading={edits.pending === 'dismiss'}
                          disabled={edits.pending !== null && edits.pending !== 'dismiss'}
                          onClick={() => void answerSlot(doubt.reason, false)}
                        >
                          {cut
                            ? t`It’s a cut`
                            : doubt.reason === 'motionUnsure'
                              ? t`Leave it unknown`
                              : t`Leave it as it is`}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <DescriptionField
            slot={slot}
            number={i18n.number(index + 1)}
            saving={edits.pending === 'describe'}
            onSave={editable ? (text) => edits.run({ kind: 'describe', slotId: slot.id, text }) : undefined}
            onSetMotion={editable ? (motion) => void pickMotion(motion) : undefined}
            settingMotion={edits.pending === 'setMotion'}
            busy={edits.pending !== null && edits.pending !== 'setMotion'}
          />
        </section>
        {index > 0 ? (
          <section aria-label={t`The cut into this slot`} className="flex flex-col gap-2">
            <h4 className="m-0 type-label text-ink">{t`The cut into this slot`}</h4>
            <CutFrames
              template={template}
              cut={cutPreview ?? start}
              reelUrl={reelUrl}
              sheetUrl={sheetUrl}
              height={template.canvas.width > template.canvas.height ? 64 : 104}
            />
            <p className="m-0 flex items-center gap-1.5 type-meta text-ink-2">
              {/* Yours in teal, as everything you set is (DESIGN.md, the you kind). */}
              {slot.cut.method === 'user' ? (
                <Chip tone="you">{cutLabel(i18n, 'user')}</Chip>
              ) : slot.cut.method === 'rule' || slot.cut.method === 'format' ? (
                cutLabel(i18n, slot.cut.method)
              ) : (
                t`${method}, ${sure} sure`
              )}
            </p>
          </section>
        ) : null}
        {template.text.some((item) => item.slotId === slot.id) ? (
          <section aria-label={t`Text on screen`} className="flex flex-col gap-1">
            <h4 className="m-0 type-label text-ink">{t`Text on screen`}</h4>
            <SlotTexts
              template={template}
              slotId={slot.id}
              current={currentText}
              lit={lit}
              onLit={onLit}
              removing={edits.pending === 'notText' ? (currentText ?? lit) : null}
              {...(editable
                ? {
                    onRemove: (id: TextId) => void notText(id),
                    onKeep: (id: TextId) => void itsText(id),
                    onGraphic: (id: TextId, on: boolean) =>
                      void graphic(id, () => edits.run({ kind: 'setGraphic', overlayId: id, graphic: on })),
                    onBrief: (id: TextId, brief: GraphicBriefPatch) =>
                      graphic(id, () => edits.run({ kind: 'editBrief', overlayId: id, brief })),
                  }
                : {})}
              pending={edits.pending ? { kind: edits.pending, id: graphicLine } : null}
            />
          </section>
        ) : null}
        {props.tell}
      </div>
      {editable ? (
        <div className={cn('flex flex-col gap-2 border-t border-rule-subtle pt-3')}>
          {props.actions}
          {edits.error ? <ErrorLine key={edits.error.code} error={edits.error} /> : null}
        </div>
      ) : null}
    </div>
  );
}

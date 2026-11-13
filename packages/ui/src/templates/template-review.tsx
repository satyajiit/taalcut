// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review, "the reel, slot by slot" (BRK1-REV; the owner's design of
 *   2026-10-31) · system: DESIGN.md v0.7 · one component for the chat's review sheet and a template's Slots page
 * watch it, step through it, fix it: the kept reel plays at its own shape beside the slot in words; under both, one
 *   time axis (the sound and its beats, the slots with the reel's frames, the text, the cuts you can drag, the
 *   playhead); under that the route through what Taalcut isn't sure of. Picking a slot loops it, and what is current
 *   is that slot's first thing to check. Looks right approves the slot on screen and goes on to the next thing to
 *   check; a doubt's own answers (Leave it as it is, It's text, Not text) go on too. Every fix is a command,
 *   undoable with Undo or ⌘Z; anything else goes to Tell Taalcut as proposals to accept or reject
 * layout: side by side from 40 rem of width (the sheet at 960 × 600, the page at the smallest window), stacked below;
 *   portrait and landscape reels take the stage at their own shape
 * states: the parts' (reel-stage, review-panel, review-timeline, review-nav, tell-taalcut) · read-only (an older
 *   version: it plays and steps, nothing edits) · no reel (frames only)
 * keys: Space plays and pauses, ← → move between slots, J and K between the things to check, ⌘Z undoes
 * motion: none of its own; reduced motion: picking a slot never starts the reel
 */
import type {
  Id,
  ProjectId,
  Result,
  Template,
  TemplateProposals,
  TemplateProposeEditsInput,
} from '@taalcut/core';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Collapse } from '#components/collapse';
import { cn } from '#lib/cn';
import { DUR } from '#lib/motion';
import { cutRange, cutTime, frameSeconds, slotAt } from './cut-math';
import { ReelDoubts } from './reel-doubts';
import { ReelStage } from './reel-stage';
import { checkItems, itemSlot, reviewCounts, stepItem, type CheckItem } from './review-checks';
import { ReviewActions } from './review-actions';
import { ReviewNav } from './review-nav';
import { ReviewPanel } from './review-panel';
import { followSelection, landOnActions, reveal } from './reveal';
import { ReviewTimeline } from './review-timeline';
import { toSeconds } from './slot-words';
import { TellTaalcut } from './tell-taalcut';
import { useReelPlayer } from './use-reel-player';
import { PAGE_NAV, REVIEW_COLUMN, STAGE, STAGE_ROW, STAGE_SHORT } from './review-layout';
import { useReviewEdits } from './use-review-edits';
import { useTemplateReviewKeys } from './use-template-review-keys';

type SlotId = Id<'TemplateSlot'>;

export interface TemplateReviewProps {
  template: Template;
  /** The kept reel's URL (templateReel), or null when the template keeps none. */
  reelUrl: string | null;
  sheetUrl: string | null;
  projectId: ProjectId | null;
  readOnly?: boolean;
  dispatch?: ((name: string, payload: unknown) => Promise<Result<unknown>>) | undefined;
  undo?: (() => Promise<Result<unknown>>) | undefined;
  /** "Tell Taalcut" (templates.proposeEdits); undefined hides it. */
  propose?: ((input: TemplateProposeEditsInput) => Promise<Result<TemplateProposals>>) | undefined;
  /** The sheet over the chat, or the template's Slots page: how tall the stage may be. */
  variant: 'sheet' | 'page';
  /** The slot it opens on (`?slot=3`); else the first thing to check. */
  initialSlot?: number;
  className?: string;
}

export function TemplateReview({
  template,
  reelUrl,
  sheetUrl,
  projectId,
  readOnly = false,
  dispatch,
  undo,
  propose,
  variant,
  initialSlot,
  className,
}: TemplateReviewProps) {
  const reduce = useReducedMotion() ?? false;
  const player = useReelPlayer();
  const edits = useReviewEdits({
    template,
    projectId,
    dispatch: readOnly ? undefined : dispatch,
    undo,
    announce: variant === 'sheet' ? 'inline' : 'toast',
  });
  const editable = edits.canEdit;
  const items = useMemo(() => checkItems(template), [template]);
  const counts = reviewCounts(template, items);
  const [currentKey, setCurrentKey] = useState<string | null>(() =>
    initialSlot === undefined ? (items[0]?.key ?? null) : null,
  );
  const [selectedId, setSelectedId] = useState<SlotId>(() => {
    const first = items[0] ? itemSlot(items[0]) : null;
    const at = initialSlot ?? (first ? template.slots.findIndex((slot) => slot.id === first) : 0);
    return template.slots[Math.max(0, Math.min(at, template.slots.length - 1))]!.id;
  });
  const lastIndex = useRef(0);
  const found = template.slots.findIndex((slot) => slot.id === selectedId);
  // The slot on screen went (joined to the one before it, or dropped): the one before it, which holds its place.
  const index = found >= 0 ? found : Math.min(Math.max(0, lastIndex.current - 1), template.slots.length - 1);
  lastIndex.current = index;
  const slot = template.slots[index]!;
  const current = items.find((item) => item.key === currentKey) ?? null;
  const [looping, setLooping] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [telling, setTelling] = useState(false);
  const [lit, setLit] = useState<Id<'TextOverlay'> | null>(null);
  const [cutPreview, setCutPreview] = useState<number | null>(null);
  const handles = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Tell Taalcut opens at the panel's end: once it has grown, it comes into view and its field takes focus.
  useEffect(() => {
    if (!telling) return;
    const tell = root.current?.querySelector<HTMLElement>('[data-slot=tell-taalcut]');
    tell?.querySelector('textarea')?.focus({ preventScroll: true });
    const grown = window.setTimeout(() => reveal(tell), DUR.short * 1000 + 20);
    return () => window.clearTimeout(grown);
  }, [telling]);

  const range = { start: toSeconds(slot.start), end: toSeconds(slot.start) + toSeconds(slot.duration) };
  useEffect(() => {
    player.setLoop(looping ? range : null);
    // The loop follows the slot's edges as they move; the slot itself is set below.
  }, [player, looping, range.start, range.end]);

  // Playing on without a loop: the selection follows the playhead.
  useEffect(() => {
    if (looping || !player.playing) return;
    return player.subscribe((seconds) => {
      const at = slotAt(template, seconds);
      const id = template.slots[at]?.id;
      if (id && id !== selectedId) setSelectedId(id);
    });
  }, [player, looping, template, selectedId]);

  /** Shows a slot: selects it, puts the playhead on its start and plays it round (never by itself under reduced motion). */
  const show = (at: number, play = true) => {
    const next = template.slots[at];
    if (!next) return;
    setSelectedId(next.id);
    setRenaming(false);
    player.seek(toSeconds(next.start));
    player.setLoop(
      looping
        ? { start: toSeconds(next.start), end: toSeconds(next.start) + toSeconds(next.duration) }
        : null,
    );
    if (play && reelUrl && !reduce) player.play();
    followSelection(root.current);
  };

  const goTo = (item: CheckItem | null) => {
    setCurrentKey(item?.key ?? null);
    if (!item) return;
    const id = itemSlot(item);
    const at = id ? template.slots.findIndex((s) => s.id === id) : -1;
    if (at >= 0) show(at);
    setLit(item.target.kind === 'text' ? item.target.overlayId : null);
  };

  /** A slot's place in the reel, or -1 for the whole reel's doubts (they come first). */
  const placeOf = (item: CheckItem) => {
    const id = itemSlot(item);
    return id ? template.slots.findIndex((s) => s.id === id) : -1;
  };

  /**
   * The person picked a slot (the strip, the arrows): what is on screen is now that slot, and what Looks right and
   * J and K act from is its first thing to check, never one left over from another slot.
   */
  const pick = (at: number) => {
    const next = template.slots[at];
    if (!next) return;
    const first = items.find((item) => placeOf(item) === at) ?? null;
    setCurrentKey(first?.key ?? null);
    setLit(first?.target.kind === 'text' ? first.target.overlayId : null);
    show(at);
  };

  /** J and K: from the current thing to check, or, when the slot on screen has none, from that slot. */
  const stepCheck = (step: 1 | -1) => {
    if (current) return goTo(stepItem(items, currentKey, step));
    const ahead =
      step > 0
        ? items.find((item) => placeOf(item) > index)
        : [...items].reverse().find((item) => placeOf(item) < index);
    goTo(ahead ?? stepItem(items, null, step));
  };

  /** The next thing to check once these keys are resolved: the first after the current one that is still open. */
  const after = (resolved: (item: CheckItem) => boolean) => {
    const at = currentKey ? items.findIndex((item) => item.key === currentKey) : -1;
    const ordered = [...items.slice(at + 1), ...items.slice(0, Math.max(0, at))];
    return ordered.find((item) => !resolved(item)) ?? null;
  };

  const landFocus = (moved = false) => landOnActions(root.current, moved);

  /** An inline answer (Leave it as it is, Half as many beats, It's text, Not text) took these keys: on to the next. */
  const answered = (keys: readonly string[]) => {
    goTo(after((other) => keys.includes(other.key)));
    landFocus(true);
  };

  /**
   * Looks right approves the slot on screen, whatever else is open, then goes on: to its text's doubts (approving a
   * slot never says its text is text), else to the next thing to check after it, else to the next slot that waits.
   */
  const looksRight = async () => {
    if (!(await edits.run({ kind: 'approve', indices: [index], approved: true }))) return;
    landFocus(true);
    const own = (item: CheckItem) => item.target.kind === 'slot' && item.target.slotId === slot.id;
    const next =
      items.find((item) => item.target.kind === 'text' && placeOf(item) === index) ??
      items.find((item) => placeOf(item) > index) ??
      items.find((item) => !own(item));
    if (next) return goTo(next);
    setCurrentKey(null);
    const waiting = template.slots.findIndex((other, i) => i > index && !other.approved);
    if (waiting >= 0) show(waiting);
  };

  const playheadIn = () => {
    const seconds = player.now();
    const frame = frameSeconds(template);
    return seconds > range.start + frame && seconds < range.end - frame;
  };

  useTemplateReviewKeys({
    togglePlay: () => player.toggle(),
    stepSlot: (step) => pick(Math.max(0, Math.min(template.slots.length - 1, index + step))),
    stepCheck,
    undo: () => void edits.undo(),
  });

  const accepted = new Set(
    edits.made.flatMap(({ edit }) => (edit.kind === 'proposal' ? [edit.proposal] : [])),
  );
  const unsureCuts = new Set(
    items.flatMap((item) =>
      item.target.kind === 'slot' && (item.reason === 'cutUnsure' || item.reason === 'cutMaybeTransition')
        ? [item.target.slotId]
        : [],
    ),
  );
  const toCheck = new Set(items.flatMap((item) => (itemSlot(item) ? [itemSlot(item)!] : [])));

  const actions = (
    <ReviewActions
      template={template}
      index={index}
      toCheck={counts.toCheck}
      reelFirst={current?.target.kind === 'reel'}
      edits={edits}
      playhead={() => player.now()}
      canCutAtPlayhead={playheadIn}
      onMenuOpen={() => player.pause()}
      onLooksRight={() => void looksRight()}
      onMoveCut={() => handles.current?.querySelector<HTMLElement>('[role=slider]')?.focus()}
      onRename={() => setRenaming(true)}
      telling={propose ? { open: telling, onToggle: () => setTelling((open) => !open) } : undefined}
    />
  );

  return (
    <div
      ref={root}
      data-slot="template-review"
      data-variant={variant}
      className={cn(REVIEW_COLUMN, className)}
    >
      <div
        // Side by side from 40 rem: the Slots page's column at the smallest window (about 42 rem) keeps the reel
        // beside the slot, and the strip under both, in one screen.
        className={STAGE_ROW}
        style={{ ['--stage' as string]: STAGE[variant], ['--stage-short' as string]: STAGE_SHORT[variant] }}
      >
        <ReelStage
          template={template}
          reelUrl={reelUrl}
          sheetUrl={sheetUrl}
          player={player}
          selected={index}
          looping={looping}
          onLooping={setLooping}
          litText={lit}
          className="h-72 @[40rem]/review:h-auto"
        />
        <ReviewPanel
          template={template}
          index={index}
          items={items}
          current={current}
          reelUrl={reelUrl}
          sheetUrl={sheetUrl}
          cutPreview={cutPreview}
          edits={edits}
          editable={editable}
          lit={lit}
          onLit={setLit}
          onAnswered={answered}
          renaming={renaming}
          onRenaming={(on) => {
            setRenaming(on);
            if (!on) landFocus();
          }}
          actions={actions}
          reel={
            <ReelDoubts
              template={template}
              items={items}
              current={current}
              edits={edits}
              editable={editable}
              onAnswered={answered}
              onPick={(item) => {
                goTo(item);
                landFocus(true);
              }}
            />
          }
          tell={
            propose ? (
              <Collapse open={telling}>
                <TellTaalcut
                  template={template}
                  selected={index}
                  propose={propose}
                  accept={(proposal) => edits.attempt({ kind: 'proposal', proposal }, true)}
                  accepted={accepted}
                  disabled={!editable}
                />
              </Collapse>
            ) : null
          }
        />
      </div>
      <div ref={handles}>
        <ReviewTimeline
          template={template}
          sheetUrl={sheetUrl}
          selected={index}
          onSelect={pick}
          player={player}
          toCheck={toCheck}
          unsureCuts={unsureCuts}
          litText={lit}
          onSeek={(seconds) => player.seek(seconds)}
          onCutPreview={(seconds) => {
            setCutPreview(seconds);
            if (seconds !== null) {
              player.pause();
              player.seek(seconds);
            }
          }}
          {...(editable
            ? {
                onMoveCut: (slotId: SlotId, place: { seconds: number; snap: 'frame' | 'beat' }) => {
                  const at = template.slots.findIndex((s) => s.id === slotId);
                  const to = cutTime(template, place.seconds);
                  if (at > 0 && cutRange(template, at))
                    void edits.run({ kind: 'moveCut', slotId, to, snap: place.snap });
                },
                onRename: () => setRenaming(true),
              }
            : {})}
        />
      </div>
      <ReviewNav
        className={variant === 'page' ? PAGE_NAV : undefined}
        counts={counts}
        editable={editable}
        onStep={stepCheck}
        canUndo={edits.canUndo}
        said={edits.said}
        current={current && { item: current, slot: placeOf(current) >= 0 ? placeOf(current) : null }}
        undoing={edits.pending === 'undo'}
        onUndo={() => void edits.undo().then(() => landFocus())}
        approving={edits.pending === 'approve'}
        onApproveRest={() =>
          void edits
            .run({
              kind: 'approve',
              indices: template.slots.flatMap((s, i) => (s.approved ? [] : [i])),
              approved: true,
            })
            .then(() => landFocus())
        }
      />
    </div>
  );
}

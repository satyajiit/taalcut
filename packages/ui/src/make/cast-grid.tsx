// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cast grid · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * one row per slot on the sunken bed: number, the pick (9:16, the AI mark or teal "You"), what the slot wants (the
 *   reel's words, as written), how sure the AI is, three other shots, Find something else, Lock
 * states: default · hover (hover surface on a frame or a button) · focus (base ring; one tab stop, a grid: rows are
 *   slots, columns the pick, the other shots, find and lock; arrows, Home, End, Ctrl+Home/End) · active (pressed) ·
 *   disabled (the run ended or the timeline is gone: aria-disabled, the card says why) · loading (a pressed shot
 *   dims and is busy; find spins) · error (the cause under the row) · success (silent: the frames trade places) ·
 *   locked ("Locked" beside the pick; swaps stay yours) · folded (low-confidence rows always show)
 * motion: a swap trades the two frames' places (shared layout, --dur-short, ease-out); reduced motion: they swap
 *   at once (MotionProvider)
 * pre-emit critique: P5 H5 E4 S5 R4 V5 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { CastCandidate, ProjectId, SlotCast, TaalcutError, TemplateSlot, Timeline } from '@taalcut/core';
import { Lock, LockOpen, Search } from 'lucide-react';
import { LayoutGroup } from 'motion/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '#components/button';
import { Chip } from '#components/badge';
import { useCardActions } from '../cards/card-actions';
import { UserContent } from '../cards/card-frame';
import { useCardData } from '../cards/card-data';
import { errorMessage } from '../feedback/error-messages';
import { AlternatesStrip } from './alternates';
import { Confidence, confidenceLevel } from './confidence';
import { ShotThumb } from './shot-thumb';
import { shotKey, useShotFrames } from './use-shot-frames';

export interface CastGridProps {
  /** Prefixes the shared-layout ids, so two boards never trade frames. */
  cardId: string;
  projectId: ProjectId;
  timeline: Timeline;
  /** The template's slots (intents, names); null while it loads. */
  slots: readonly TemplateSlot[] | null;
  disabled?: boolean;
}

const FOLDED = 6;
type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: TaalcutError };
const candidateKey = (candidate: CastCandidate) => shotKey(candidate);

export function CastGrid({ cardId, projectId, timeline, slots, disabled = false }: CastGridProps) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const data = useCardData();
  const grid = useRef<HTMLDivElement>(null);
  const cast = timeline.cast?.slots ?? [];
  const [expanded, setExpanded] = useState(false);
  const [stop, setStop] = useState({ row: 0, col: 0 });
  const [found, setFound] = useState<Record<string, readonly CastCandidate[]>>({});
  const [finding, setFinding] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<{ slot: string; index: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, TaalcutError>>({});
  const frames = useShotFrames(
    cast.flatMap((slot) => [
      ...(slot.pick ? [slot.pick] : []),
      ...slot.alternates,
      ...(found[slot.slotId] ?? []),
    ]),
  );
  const clips = new Map(
    timeline.tracks
      .flatMap((track) => (track.kind === 'text' ? [] : track.items))
      .flatMap((item) => (item.type === 'clip' ? [[item.id, item] as const] : [])),
  );
  const isLow = (slot: SlotCast) => slot.confidence !== null && confidenceLevel(slot.confidence) === 'low';
  const rows = cast
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => expanded || cast.length <= FOLDED + 1 || index < FOLDED || isLow(slot));
  const off = disabled || !actions.dispatch;

  /** Runs a row's command; its failure stays under the row until the next try. */
  const run = async (slot: SlotCast, action: () => Promise<Outcome>) => {
    setErrors(({ [slot.slotId]: _gone, ...rest }) => rest);
    const result = await action();
    if (!result.ok) setErrors((known) => ({ ...known, [slot.slotId]: result.error }));
  };

  const swap = async (slot: SlotCast, index: number) => {
    const pool = found[slot.slotId] ?? slot.alternates;
    const candidate = pool[index];
    if (!candidate || !slot.clipId || off || swapping) return;
    setSwapping({ slot: slot.slotId, index });
    try {
      await run(slot, async () => {
        const result = await actions.dispatch!('timeline.swapClip', {
          projectId,
          timelineId: timeline.id,
          clipId: slot.clipId,
          media: { assetId: candidate.assetId, shotId: candidate.shotId },
          sourceStart: candidate.sourceStart,
          from: found[slot.slotId] ? 'search' : 'alternate',
          scored: { score: candidate.score, parts: candidate.parts },
        });
        if (result.ok) setFound(({ [slot.slotId]: _used, ...rest }) => rest);
        return result;
      });
    } finally {
      setSwapping(null);
    }
  };

  const lock = (slot: SlotCast, locked: boolean) =>
    slot.clipId && !off
      ? run(slot, () =>
          actions.dispatch!('timeline.lockClip', {
            projectId,
            timelineId: timeline.id,
            clipId: slot.clipId,
            locked,
          }),
        )
      : undefined;

  const findMore = async (slot: SlotCast) => {
    if (!data.findAlternates) return;
    setFinding(slot.slotId);
    try {
      const exclude = [slot.pick, ...slot.alternates, ...(found[slot.slotId] ?? [])].flatMap((candidate) =>
        candidate?.shotId ? [candidate.shotId] : [],
      );
      const fresh = await data.findAlternates({ timelineId: timeline.id, slotId: slot.slotId, exclude });
      setFound((known) => ({ ...known, [slot.slotId]: (fresh ?? []).slice(0, 3) }));
    } finally {
      setFinding(null);
    }
  };

  // The grid's one tab stop moves with the arrows; columns: 0 pick, 1..n other shots, then find, then lock.
  const columns = (row: number) => {
    const slot = rows[row]?.slot;
    const alternates = slot ? (found[slot.slotId] ?? slot.alternates).length : 0;
    return { alternates, last: alternates + (data.findAlternates ? 2 : 1) };
  };
  const cellOf = (row: number, col: number) => {
    const el = grid.current?.querySelector<HTMLElement>(`[data-row="${row}"]`);
    if (!el) return null;
    const { alternates } = columns(row);
    if (col === 0) return el.querySelector<HTMLElement>('[data-col="pick"]');
    if (col <= alternates) return el.querySelector<HTMLElement>(`[data-alternate="${col - 1}"]`);
    if (col === alternates + 1 && data.findAlternates)
      return el.querySelector<HTMLElement>('[data-col="find"]');
    return el.querySelector<HTMLElement>('[data-col="lock"]');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { row, col } = stop;
    const last = rows.length - 1;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [row, Math.min(columns(row).last, col + 1)],
      ArrowLeft: [row, Math.max(0, col - 1)],
      ArrowDown: [Math.min(last, row + 1), Math.min(columns(Math.min(last, row + 1)).last, col)],
      ArrowUp: [Math.max(0, row - 1), Math.min(columns(Math.max(0, row - 1)).last, col)],
      Home: event.ctrlKey ? [0, 0] : [row, 0],
      End: event.ctrlKey ? [last, columns(last).last] : [row, columns(row).last],
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    setStop({ row: next[0], col: next[1] });
    cellOf(next[0], next[1])?.focus();
  };
  const tabFor = (row: number, col: number) => (stop.row === row && stop.col === col ? 0 : -1);

  return (
    <LayoutGroup id={cardId}>
      <div
        ref={grid}
        role="grid"
        aria-label={t`Your clips, slot by slot`}
        aria-rowcount={cast.length}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const row = Number(
            (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row ?? -1,
          );
          const el = event.target as HTMLElement;
          if (row < 0) return;
          const { alternates } = columns(row);
          const col =
            el.dataset.col === 'pick'
              ? 0
              : el.dataset.alternate !== undefined
                ? 1 + Number(el.dataset.alternate)
                : el.dataset.col === 'find'
                  ? alternates + 1
                  : columns(row).last;
          if (row !== stop.row || col !== stop.col) setStop({ row, col });
        }}
        className="flex flex-col rounded-xl bg-panel p-1"
      >
        {rows.map(({ slot, index }, row) => {
          const templateSlot = slots?.find((candidate) => candidate.id === slot.slotId) ?? null;
          const number = i18n.number((templateSlot ? (slots?.indexOf(templateSlot) ?? index) : index) + 1);
          const clip = slot.clipId ? clips.get(slot.clipId) : undefined;
          const locked = clip?.locked ?? false;
          const pool = found[slot.slotId] ?? slot.alternates;
          const by = slot.note === 'userPick' ? 'you' : 'ai';
          const pickFrame = slot.pick ? frames(slot.pick) : undefined;
          const searched = found[slot.slotId] !== undefined;
          const error = errors[slot.slotId];
          return (
            <div
              key={slot.slotId}
              role="row"
              aria-rowindex={index + 1}
              data-row={row}
              data-slot-id={slot.slotId}
              className="grid grid-cols-[1.5rem_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 [&+&]:border-t [&+&]:border-rule-subtle"
            >
              <span role="rowheader" className="self-start pt-1 text-sm font-semibold text-ink tabular-nums">
                {number}
              </span>
              {/* The pick: a cell you can land on and hear (who chose it, which file), not a button. */}
              <span
                role="gridcell"
                data-col="pick"
                tabIndex={tabFor(row, 0)}
                className="block rounded-md p-0.5"
              >
                <ShotThumb
                  url={pickFrame?.url}
                  size="sm"
                  marker={slot.pick ? by : null}
                  layoutId={slot.pick ? `${cardId}:${slot.slotId}:${candidateKey(slot.pick)}` : undefined}
                />
                <span className="sr-only">
                  {by === 'you' ? t`Your pick` : t`AI pick`}
                  {pickFrame ? (
                    <>
                      {': '}
                      <span translate="no" data-user-content>
                        {pickFrame.name}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
              <span role="gridcell" className="flex min-w-0 flex-col gap-1">
                {templateSlot?.intent.text ? (
                  <UserContent className="text-sm text-ink">{templateSlot.intent.text}</UserContent>
                ) : (
                  <span className="text-sm text-ink-2">{t`Slot ${number}`}</span>
                )}
                <span className="flex flex-wrap items-center gap-2">
                  <Confidence value={slot.confidence} reranked={slot.note === 'reranked'} />
                  {locked ? (
                    <Chip tone="neutral">
                      <Lock aria-hidden />
                      {t`Locked`}
                    </Chip>
                  ) : null}
                </span>
              </span>
              <span role="gridcell" className="flex items-center gap-1">
                <AlternatesStrip
                  items={pool.map((candidate) => ({
                    key: candidateKey(candidate),
                    frame: frames(candidate),
                    layoutId: `${cardId}:${slot.slotId}:${candidateKey(candidate)}`,
                  }))}
                  size="sm"
                  onSwap={(alternate) => void swap(slot, alternate)}
                  disabled={off || !slot.clipId}
                  swapping={swapping?.slot === slot.slotId ? swapping.index : null}
                  tabStop={stop.row === row && stop.col >= 1 && stop.col <= pool.length ? stop.col - 1 : null}
                  label={t`Other shots for slot ${number}`}
                  emptyAction={
                    searched ? (
                      <span className="flex items-center gap-2 text-xs text-ink-2">
                        {t`Nothing else fits this slot.`}
                        {actions.ask ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              actions.ask?.(
                                t`About slot ${number}: `,
                                timeline.template
                                  ? [{ kind: 'slot', templateId: timeline.template.id, slotId: slot.slotId }]
                                  : [],
                              )
                            }
                          >
                            {t`Ask Taalcut`}
                          </Button>
                        ) : null}
                      </span>
                    ) : null
                  }
                />
                {data.findAlternates ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    data-col="find"
                    tabIndex={tabFor(row, pool.length + 1)}
                    aria-label={t`Find something else for slot ${number}`}
                    title={t`Find something else`}
                    disabled={off}
                    loading={finding === slot.slotId}
                    onClick={() => void findMore(slot)}
                  >
                    {finding === slot.slotId ? null : <Search aria-hidden />}
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  data-col="lock"
                  tabIndex={tabFor(row, columns(row).last)}
                  aria-label={locked ? t`Unlock slot ${number}` : t`Lock slot ${number}`}
                  aria-pressed={locked}
                  title={locked ? t`Unlock: Taalcut may change it again` : t`Lock: Taalcut won’t change it`}
                  disabled={off || !slot.clipId}
                  onClick={() => void lock(slot, !locked)}
                >
                  {locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
                </Button>
              </span>
              {error ? (
                <p role="alert" className="col-span-full m-0 ps-9 text-sm text-danger-strong">
                  {errorMessage(i18n, error)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {cast.length > FOLDED + 1 ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setExpanded((open) => !open)}>
          {expanded ? (
            t`Show fewer slots`
          ) : (
            <Plural value={cast.length} one="Show the # slot" other="Show all # slots" />
          )}
        </Button>
      ) : null}
    </LayoutGroup>
  );
}

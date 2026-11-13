// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stand-in model's `agent.gaps` step (agent SPEC section 26), which the gaps extension puts after the
 * Librarian when a cast leaves slots open (the brief journey's story casting does). It applies each gap's given
 * fix as the skill's prompt says: drop ripples the slot out (timeline.dropSlot), film marks a weak pick for the
 * phone's shot list (timeline.markForFilming; an empty slot is on it already). The journeys have no image or
 * stock key, so generate and stock fall back to film, the prompt's rule for a fix that can't run. FIX-GAPS: a weak
 * pick's swap puts the given candidate in (timeline.swapClip, from "agent"); keep calls nothing. FIX-ASK: a borrow
 * first gives the other shot its clip instead (swapClip on `borrow.clipId`), then takes that shot's clip (swapClip
 * for an unsure clip, fillGap for an empty shot); a reuse puts another part of a used clip in (`sourceStart`). It
 * hands off every gap with what it applied and each timeline's revision from its last write.
 */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { call, callsTo, list, record, use, type Json } from './make-flow-reads';
import type { DemoTurn } from './script';

type Applied = { readonly gap: Json; readonly fix: 'drop' | 'film' | 'swap' | 'keep' | 'borrow' | 'reuse' };

const hasClip = (gap: Json) => Boolean(gap.swapTo && typeof gap.swapTo === 'object');

function applyAs(gap: Json): Applied {
  if (gap.fix === 'drop' || gap.fix === 'keep') return { gap, fix: gap.fix };
  if (gap.fix === 'swap' && hasClip(gap)) return { gap, fix: 'swap' };
  if (gap.fix === 'borrow' && hasClip(gap) && gap.borrow && typeof gap.borrow === 'object')
    return { gap, fix: 'borrow' };
  if (gap.fix === 'reuse' && hasClip(gap)) return { gap, fix: 'reuse' };
  return { gap, fix: 'film' };
}

/** The calls that put a gap's clip in, in order: a borrow's give-back first, then the clip itself. */
function clipCalls(projectId: unknown, { gap, fix }: Applied): [string, Json][] {
  const start = fix === 'reuse' && gap.sourceStart ? { sourceStart: gap.sourceStart } : {};
  const media = record(gap.swapTo);
  const take: [string, Json] =
    gap.state === 'weak'
      ? [
          'timeline_swapClip',
          { projectId, timelineId: gap.timelineId, clipId: gap.gapId, media, ...start, from: 'agent' },
        ]
      : [
          'timeline_fillGap',
          {
            projectId,
            timelineId: gap.timelineId,
            gapId: gap.gapId,
            media: { kind: 'video', ...media, ...start },
          },
        ];
  if (fix !== 'borrow') return [take];
  const borrow = record(gap.borrow);
  const giveBack: [string, Json] = [
    'timeline_swapClip',
    { projectId, timelineId: gap.timelineId, clipId: borrow.clipId, media: borrow.instead, from: 'agent' },
  ];
  return [giveBack, take];
}

/** Weak picks to film, by timeline: one markForFilming call each. */
function filmBatches(applied: readonly Applied[]): Map<string, string[]> {
  const batches = new Map<string, string[]>();
  for (const { gap, fix } of applied) {
    if (fix !== 'film' || gap.state !== 'weak' || typeof gap.slotId !== 'string') continue;
    const timelineId = String(gap.timelineId);
    batches.set(timelineId, [...(batches.get(timelineId) ?? []), gap.slotId]);
  }
  return batches;
}

/** Each timeline's revision from the last write this step made to it (its input's timelines, in order). */
function revisions(view: RequestView, timelineIds: readonly unknown[]): Json[] {
  const writes: ToolCall[] = [...view.calls].reverse();
  return timelineIds.map((timelineId) => {
    const last = writes.find((c) => c.input.timelineId === timelineId && resultJson(c.result)?.revision);
    return { timelineId, revision: Number(resultJson(last?.result ?? '')?.revision ?? 1) };
  });
}

export function gapsTurn(view: RequestView): DemoTurn {
  const input = record(view.input);
  const projectId = input.projectId;
  const applied = list(input.gaps).map(record).map(applyAs);
  const drops = applied.filter((a) => a.fix === 'drop');
  const dropped = callsTo(view, 'timeline_dropSlot');
  if (dropped.length < drops.length) {
    const { gap } = drops[dropped.length]!;
    return call(
      view,
      'timeline_dropSlot',
      { projectId, timelineId: gap.timelineId, itemId: gap.gapId, mode: 'ripple' },
      dropped.length === 0 ? 'Some slots have no good shot; I will apply the chosen fixes.' : undefined,
    );
  }
  const placing = applied
    .filter((a) => a.fix === 'swap' || a.fix === 'borrow' || a.fix === 'reuse')
    .flatMap((a) => clipCalls(projectId, a));
  const placed = view.calls.filter((c) => c.name === 'timeline_swapClip' || c.name === 'timeline_fillGap');
  if (placed.length < placing.length) {
    const [name, args] = placing[placed.length]!;
    return call(view, name, args);
  }
  const batches = [...filmBatches(applied)];
  const marked = callsTo(view, 'timeline_markForFilming');
  if (marked.length < batches.length) {
    const [timelineId, slotIds] = batches[marked.length]!;
    return call(view, 'timeline_markForFilming', { projectId, timelineId, slotIds, on: true });
  }
  return use('handOff', {
    gaps: applied.map(({ gap, fix }) => ({
      timelineId: gap.timelineId,
      gapId: gap.gapId,
      slotId: gap.slotId ?? null,
      fixes: list(gap.fixes),
      applied: fix,
    })),
    filming: applied.filter((a) => a.fix === 'film').length,
    timelines: revisions(view, list(input.timelineIds)),
  });
}

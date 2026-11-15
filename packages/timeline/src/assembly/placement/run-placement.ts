// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made timeline's text and its people.
 *
 * TXT1 (the owner's rule): no code decides where a video's text sits. `runPlacement`, which the make and every edit
 * call, lays the text out as the reel had it (place-timeline.ts `reelTextLayout`: a run together at one place and one
 * size, a placed text untouched) and asks for the clips' subject tracks, for the tools that tell whoever places the
 * text what is under it. It moves no text off a head and changes no clip. FRM1-OVL's own pass (the solver's place
 * applied, and for a text with no room its clip retimed or its slot recast) was removed with TXT1: the solver's
 * place reaches the AI as a candidate only (`candidatePlaces`).
 *
 * `spansFor` reads the people of clip ranges for whoever needs them now (the text facts, the make's frame checks),
 * waiting a bounded time for a track still being made.
 */
import type { SubjectClipRange, SubjectSource, SubjectSpan, Template, Timeline } from '@taalcut/core';
import { reelTextLayout } from './place-timeline';
import { clipSourceRange, placedClips } from './subjects';

export interface PlacementDeps {
  readonly subjects?: SubjectSource;
  readonly signal?: AbortSignal;
  /**
   * How long a read waits for missing tracks (SubjectSource.ensure), ms; a track still being made then finishes in
   * the jobs queue and what is stored is read. Default PLACEMENT_ENSURE_MS.
   */
  readonly ensureBudgetMs?: number;
}

/** The make's frame checks wait this long for tracks (FRM1-SUB's assembly budget); the text facts wait less. */
export const PLACEMENT_ENSURE_MS = 90_000;
export const EDIT_ENSURE_MS = 8_000;

/** The promise, or 'late' after `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function spansFor(
  source: SubjectSource,
  ranges: readonly { readonly key: string; readonly range: SubjectClipRange }[],
  warnings: string[],
  deps: PlacementDeps,
): Promise<Map<string, SubjectSpan | undefined>> {
  const out = new Map<string, SubjectSpan | undefined>();
  if (ranges.length === 0) return out;
  // No signal: a track the wait gives up on still finishes in the queue, for the export to read.
  const made = await within(
    source.ensure(ranges.map((entry) => entry.range)),
    deps.ensureBudgetMs ?? PLACEMENT_ENSURE_MS,
  );
  if (made === 'late') warnings.push('placement: some subject tracks are still being made');
  else if (!made.ok) warnings.push(`placement: some subject tracks weren't made (${made.error.code})`);
  for (const { key, range } of ranges) {
    const read = await source.over(range, deps.signal);
    if (!read.ok) warnings.push(`placement: subjects of ${range.assetId} unread (${read.error.code})`);
    out.set(key, read.ok ? read.value : undefined);
  }
  return out;
}

/**
 * TXT1: the text of `timeline` laid out as the reel had it (only `only`, when given), and the clips' subject tracks
 * asked for without waiting for them. It moves nothing a person or the AI placed.
 */
export function runPlacement(
  timeline: Timeline,
  template: Template,
  deps: Pick<PlacementDeps, 'subjects'>,
  only?: ReadonlySet<string>,
): Timeline {
  const source = deps.subjects;
  if (source) {
    const rate = timeline.canvas.rate;
    const ranges = placedClips(timeline).flatMap((placed) =>
      placed.clip.media.kind === 'video'
        ? [{ assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, rate) }]
        : [],
    );
    // Not awaited: a track still being made finishes in the jobs queue, for the tools and the export to read.
    if (ranges.length > 0) void source.ensure(ranges).catch(() => undefined);
  }
  return reelTextLayout({ timeline, template, ...(only ? { only } : {}) });
}

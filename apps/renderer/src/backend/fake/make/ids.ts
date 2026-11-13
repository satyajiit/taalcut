// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Make fakes' fixed ids (P2-M3, P2-M7, P2-M8, P2-M11, P2-X3). The UI
 * kit's card fixtures name the Golden hour project, its first timeline and
 * its exported render by the same ids, so a card in /dev/kit or the chat
 * shows live data from this fake. "Trip to Goa reel" is the project the
 * recovery fake names (src/recovery/fake-recovery.ts). Everything else is a
 * fakeUlid in kinds 20–29 (the library uses 1–4, templates 5–7).
 */
import type {
  CastId,
  CaptionCueId,
  Id,
  JobId,
  PreviewSessionId,
  ProjectId,
  RenderId,
  TimelineId,
  TimelineItemId,
  TimelineVersionId,
} from '@taalcut/core';
import { fakeUlid } from '../library/seed';

export const MAKE_KIND = {
  project: 20,
  timeline: 21,
  item: 22,
  render: 23,
  version: 24,
  cast: 25,
  session: 26,
  cue: 27,
  job: 28,
  conversation: 29,
} as const;

/** Golden hour market: 12 slots at 120 BPM, three variants (packages/ui fixtures-phase2.ts). */
export const GOLDEN_PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as ProjectId;
export const GOLDEN_TIMELINES: readonly TimelineId[] = [
  '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as TimelineId,
  fakeUlid<'Timeline'>(MAKE_KIND.timeline, 2),
  fakeUlid<'Timeline'>(MAKE_KIND.timeline, 3),
];
export const GOLDEN_CAST = '01K7C5M6Q8R9S0T1V2W3X4Y5ZE' as CastId;
/** The exported Reels render of variant 1 (QA passed with one warning). */
export const GOLDEN_RENDER = '01K7C5M6Q8R9S0T1V2W3X4Y5ZC' as RenderId;

/** Named by the recovery fake's report ("Recovered after a crash"). */
export const TRIP_PROJECT = '01K7C5M6Q8R9S0T1V2W3X4P001' as ProjectId;
export const TRIP_TIMELINE = fakeUlid<'Timeline'>(MAKE_KIND.timeline, 10);
/** 60 s at 9:16: the playback benchmark (gate criterion 6). */
export const LONG_PROJECT = fakeUlid<'Project'>(MAKE_KIND.project, 3);
export const LONG_TIMELINE = fakeUlid<'Timeline'>(MAKE_KIND.timeline, 20);
/** A project whose chat hasn't cut anything yet: the empty timeline. */
export const TEASER_PROJECT = fakeUlid<'Project'>(MAKE_KIND.project, 4);
/** Archived, for the "Show archived" list. */
export const DIWALI_PROJECT = fakeUlid<'Project'>(MAKE_KIND.project, 5);
export const DIWALI_TIMELINE = fakeUlid<'Timeline'>(MAKE_KIND.timeline, 30);

/** Ids made as the fakes go (new items, renders, versions): counters per kind, never reused. */
export function idMaker() {
  const next = new Map<number, number>();
  const make = <E extends string>(kind: number): Id<E> => {
    const n = (next.get(kind) ?? 1000) + 1;
    next.set(kind, n);
    return fakeUlid<E>(kind, n);
  };
  return {
    item: () => make<'TimelineItem'>(MAKE_KIND.item) as TimelineItemId,
    render: () => make<'Render'>(MAKE_KIND.render) as RenderId,
    version: () => make<'TimelineVersion'>(MAKE_KIND.version) as TimelineVersionId,
    session: () => make<'PreviewSession'>(MAKE_KIND.session) as PreviewSessionId,
    job: () => make<'Job'>(MAKE_KIND.job) as JobId,
    cue: () => make<'CaptionCue'>(MAKE_KIND.cue) as CaptionCueId,
  };
}
export type IdMaker = ReturnType<typeof idMaker>;

/** A seeded item id: the n-th item of timeline t. */
export const seededItem = (timeline: number, n: number) =>
  fakeUlid<'TimelineItem'>(MAKE_KIND.item, timeline * 100 + n) as TimelineItemId;

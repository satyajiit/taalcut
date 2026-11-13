// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1: the breakdown listens to the reel (SPEC "EAR1 breakdown listening"). Audio's listening
 * (`BreakdownAudio.listen`) hears the reel against every candidate cut; this keeps what a template carries: the most
 * prominent events (and every event that answers a cut), the sections, and the effects the reel put on its cuts
 * (`sfxAtCuts`), each in a family the SFX planner places. A missing model or a failed listening is the warning
 * `listening_unavailable`, and the breakdown goes on with `listening: null`. The report's `cutIndex` is still the
 * candidate's here; buildTemplate moves it to the slot's (listening-slots.ts).
 */
import {
  RationalTime,
  TEMPLATE_LISTENING_EVENTS_MAX,
  templateListeningSchema,
  type BeatMap,
  type CutSyncReport,
  type CutSyncStatus,
  type FrameRate,
  type SfxAtCut,
  type SfxCategory,
  type SoundEvent,
  type SoundEventKind,
  type TemplateListening,
} from '@taalcut/core';
import type { BreakdownAudio } from './ports';

/** The breakdown's warning when it couldn't listen (no model installed, or the listening failed). */
export const LISTENING_UNAVAILABLE = 'listening_unavailable';

/** The statuses whose answering event is an effect on the cut: an onset within 100 ms, or a swell within 300 ms. */
const ANSWERED: ReadonlySet<CutSyncStatus> = new Set(['ok', 'near', 'swell']);

/** A tagged event's family: the effects as they are; a drum or a note only when it stands out; a voice never. */
const FAMILY_OF_KIND: Readonly<Record<SoundEventKind, SfxCategory | 'exposed' | null>> = {
  whoosh: 'whoosh',
  riser: 'riser',
  hit: 'impact',
  ui: 'hit',
  key: 'hit',
  foley: 'hit',
  step: 'hit',
  drum: 'exposed',
  note: 'exposed',
  voice: null,
};

/** An untagged swell that builds this long is a riser; a shorter one, a whoosh. */
const RISER_MS = 600;
/** The schema's limits. */
const SECTIONS_MAX = 60;
const SFX_AT_CUTS_MAX = 200;
const HINT_MAX = 120;
/** An event answers a cut when it is the report's `eventAt` (both at 1 ms). */
const SAME_EVENT_S = 0.0015;
const MS_RATE = { num: 1000, den: 1 } as const;

/**
 * The SFX family an event plays, or null when it isn't an effect. With a model, by its top tag's kind; without one
 * (no tags), a swell by how long it builds, and a hit only when exposed (12 dB over its bed): a low one an impact.
 */
export function sfxFamilyOf(event: SoundEvent): SfxCategory | null {
  if (event.kind) {
    const family = FAMILY_OF_KIND[event.kind];
    return family === 'exposed' ? (event.exposed ? 'hit' : null) : family;
  }
  if (event.shape === 'swell') return (event.riseMs ?? 0) >= RISER_MS ? 'riser' : 'whoosh';
  if (!event.exposed) return null;
  return event.band === 'low' ? 'impact' : 'hit';
}

const seconds = (time: RationalTime) => RationalTime.toSeconds(time);

/** Events sorted by time: the index of the one at `at` (within 1.5 ms), or −1. */
function eventIndexAt(events: readonly SoundEvent[], at: RationalTime): number {
  const t = seconds(at);
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seconds(events[mid]!.at) < t - SAME_EVENT_S) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  for (let i = lo; i < events.length && seconds(events[i]!.at) <= t + SAME_EVENT_S; i++)
    if (best < 0 || Math.abs(seconds(events[i]!.at) - t) < Math.abs(seconds(events[best]!.at) - t)) best = i;
  return best;
}

const byTime = (a: SoundEvent, b: SoundEvent) => seconds(a.at) - seconds(b.at);

/** The effect on each cut an onset or a swell answers, with its family, offset and what it sounded like. */
export function sfxAtCutsOf(listening: {
  readonly cutSync: CutSyncReport;
  readonly events: readonly SoundEvent[];
}): SfxAtCut[] {
  const events = [...listening.events].sort(byTime);
  const found: SfxAtCut[] = [];
  for (const item of listening.cutSync.items) {
    if (!ANSWERED.has(item.status) || item.offsetMs === null || !item.eventAt) continue;
    const index = eventIndexAt(events, item.eventAt);
    const event = index >= 0 ? events[index]! : null;
    const family = event ? sfxFamilyOf(event) : null;
    if (!event || !family) continue;
    const hint = event.tags?.[0]?.term.trim().slice(0, HINT_MAX);
    found.push({
      cutIndex: item.cutIndex,
      family,
      offsetMs: Math.min(1000, Math.max(-1000, item.offsetMs)),
      ...(hint ? { soundHint: hint } : {}),
    });
  }
  return found.slice(0, SFX_AT_CUTS_MAX);
}

/** At most `max` events, in time order: every event that answers a cut, then the most prominent. */
export function keptEvents(
  events: readonly SoundEvent[],
  cutSync: CutSyncReport,
  max: number = TEMPLATE_LISTENING_EVENTS_MAX,
): SoundEvent[] {
  const sorted = [...events].sort(byTime);
  if (sorted.length <= max) return sorted;
  const answers = new Set<number>();
  for (const item of cutSync.items) {
    const index = item.eventAt ? eventIndexAt(sorted, item.eventAt) : -1;
    if (index >= 0) answers.add(index);
  }
  const ranked = sorted
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        Number(answers.has(b.index)) - Number(answers.has(a.index)) ||
        b.event.prominenceDb - a.event.prominenceDb ||
        a.index - b.index,
    );
  return ranked
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map(({ event }) => event);
}

/**
 * What the template keeps of a listening over the candidate cuts at `frames`: each item's `at` the cut's exact
 * frame, the events capped, the sections capped, and the effects on the cuts derived. Null when it doesn't parse.
 */
export function reelListening(
  heard: TemplateListening,
  frames: readonly number[],
  rate: FrameRate,
): TemplateListening | null {
  const items = heard.cutSync.items.flatMap((item) => {
    const frame = frames[item.cutIndex];
    return frame === undefined ? [] : [{ ...item, at: RationalTime.of(frame, rate) }];
  });
  const cutSync: CutSyncReport = {
    ...heard.cutSync,
    items,
    cutsWithoutHit: heard.cutSync.cutsWithoutHit.filter((index) => frames[index] !== undefined),
  };
  const { critiqueMetrics, ...rest } = heard;
  const parsed = templateListeningSchema.safeParse({
    ...rest,
    events: keptEvents(heard.events, cutSync),
    sections: heard.sections.slice(0, SECTIONS_MAX),
    cutSync,
    sfxAtCuts: sfxAtCutsOf({ cutSync, events: heard.events }),
    ...(critiqueMetrics ? { critiqueMetrics: keptMetrics(critiqueMetrics) } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** K1's limits on the reel's critique metrics: named like a metric id, a finite value or null, at most 64. */
const METRIC_ID = /^[a-z][a-zA-Z0-9_]{0,39}$/;
const METRICS_MAX = 64;

function keptMetrics(metrics: Readonly<Record<string, number | null>>): Record<string, number | null> {
  const kept = Object.entries(metrics).filter(
    ([id, value]) => METRIC_ID.test(id) && (value === null || Number.isFinite(value)),
  );
  return Object.fromEntries(kept.slice(0, METRICS_MAX));
}

export interface ListeningOutcome {
  /** Absent: the analysers can't listen. Null: the reel has no sound, or it couldn't be heard. */
  readonly listening?: TemplateListening | null;
  readonly warning?: string;
}

/** The listening stage: the reel's sound against its candidate cut frames (any order, repeats ignored). */
export async function listenToReel(
  audio: BreakdownAudio,
  input: {
    readonly path: string;
    readonly cuts: readonly number[];
    readonly rate: FrameRate;
    readonly beatMap: BeatMap | null;
    readonly hasAudio: boolean;
    readonly signal: AbortSignal;
    readonly log?: (message: string) => void;
  },
): Promise<ListeningOutcome> {
  if (!audio.listen) return {};
  if (!input.hasAudio) return { listening: null };
  const frames = [...new Set(input.cuts)].sort((a, b) => a - b);
  const unavailable = (why: string): ListeningOutcome => {
    input.log?.(`[breakdown] ${LISTENING_UNAVAILABLE}: ${why}`);
    return { listening: null, warning: LISTENING_UNAVAILABLE };
  };
  try {
    const heard = await audio.listen({
      path: input.path,
      // To the millisecond, as earshot's cut list has them: an onset exactly a frame off a cut reads as it does there.
      cuts: frames.map((frame) =>
        RationalTime.of(Math.round((frame * input.rate.den * 1000) / input.rate.num), MS_RATE),
      ),
      ...(input.beatMap ? { beats: input.beatMap.beats } : {}),
      frameRate: input.rate,
      signal: input.signal,
    });
    if (!heard.ok) return unavailable(heard.error.code);
    const kept = reelListening(heard.value, frames, input.rate);
    return kept ? { listening: kept } : unavailable('the listening did not parse');
  } catch (cause) {
    // A bug in the listener must not lose the reel's breakdown: it is logged and the template goes without.
    return unavailable(String(cause));
  }
}

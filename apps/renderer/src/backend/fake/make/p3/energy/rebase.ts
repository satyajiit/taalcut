// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.applyEnergyCurve's edit, as @taalcut/timeline's applyEnergy and rebaseVideo make it (P3-V12): the new
 * slots in the timeline's order, each at the old item its first source slot held. An unchanged slot keeps its
 * item exactly; a changed one gets the plan's pick for its new length (a gap when there is none); a clip you
 * locked stays on the first new slot of its span (the agent may not move it: timeline.clip_locked). Text from
 * the template follows its overlay, other text takes its slot's first new slot; markers are clamped.
 */
import {
  RationalTime,
  type CastCandidate,
  type Clip,
  type CommandSource,
  type EnergySlotMap,
  type SequenceItem,
  type SlotCast,
  type SlotId,
  type Template,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import type { EnergySplit } from '../../../../../features/timeline/energy/energy-split';
import { timelineError, type Edit } from '../../edits';
import type { PoolShot } from '../../shot-pool';

type Entry = EnergySlotMap[number];

export interface RebaseInput {
  readonly split: EnergySplit;
  readonly picks: ReadonlyMap<string, CastCandidate>;
  readonly shots: ReadonlyMap<string, PoolShot>;
  readonly source: CommandSource;
  readonly ids: () => TimelineItemId;
}

const MANUAL_PARTS = {
  intent: 0,
  motion: 0,
  quality: 0,
  subject: 0,
  energy: 0,
  hook: null,
  rerank: null,
  penalty: 0,
};
const EMPTY_CAST = (): Pick<SlotCast, 'alternates' | 'confidence' | 'needsRerank'> => ({
  alternates: [],
  confidence: null,
  needsRerank: false,
});

/** Whether the clip's media covers `frames` from its in-point. */
function fits(clip: Clip, rate: Timeline['canvas']['rate']): boolean {
  if (clip.media.kind === 'image') return true;
  const { available } = clip.media;
  const end = RationalTime.add(clip.sourceStart, RationalTime.of(clip.duration.value, rate));
  return (
    RationalTime.compare(clip.sourceStart, available.start) >= 0 &&
    RationalTime.compare(end, RationalTime.add(available.start, available.duration)) <= 0
  );
}

/** The locked clip each changed new slot inherits: the first new slot of the locked clip's span. */
function lockedClips(items: readonly SequenceItem[], slotMap: EnergySlotMap, source: CommandSource) {
  const out = new Map<string, Clip>();
  for (const item of items) {
    if (item.type !== 'clip' || !item.locked || !item.slotId) continue;
    const slotId: string = item.slotId;
    const entry = slotMap.find((candidate) => (candidate.from as readonly string[]).includes(slotId));
    if (!entry || entry.unchanged) continue;
    if (source === 'agent') return { ok: false as const, clipId: item.id };
    if (!out.has(entry.slotId)) out.set(entry.slotId, item);
  }
  return { ok: true as const, locked: out };
}

interface Made {
  readonly item: SequenceItem;
  readonly cast: SlotCast;
}

function changedItem(
  entry: Entry,
  previous: Exclude<SequenceItem, { type: 'transition' }>,
  input: RebaseInput,
  context: { readonly template: Template; readonly locked: ReadonlyMap<string, Clip> },
): Made | { readonly error: Edit } {
  const slot = context.template.slots.find((each) => each.id === entry.slotId);
  if (!slot)
    return { error: { ok: false, error: timelineError('timeline.invalid_move', { reason: 'slotMap' }) } };
  const rate = context.template.canvas.rate;
  const timing = { duration: slot.duration, slotId: entry.slotId, beatAnchor: slot.beatAnchor };
  const kept = context.locked.get(entry.slotId);
  if (kept) {
    const clip: Clip = { ...kept, ...timing, syncPoint: null };
    if (!fits(clip, rate))
      return { error: { ok: false, error: timelineError('timeline.media_too_short', { clipId: kept.id }) } };
    const shotId = kept.media.kind === 'video' ? kept.media.shotId : null;
    const pick = {
      assetId: kept.media.assetId,
      shotId,
      sourceStart: kept.sourceStart,
      syncPoint: null,
      score: 0,
    };
    return {
      item: clip,
      cast: {
        slotId: entry.slotId,
        clipId: kept.id,
        pick: { ...pick, parts: MANUAL_PARTS },
        ...EMPTY_CAST(),
        note: 'userPick',
      },
    };
  }
  // The piece that keeps the old slot's id keeps its item's id too, unless that is a locked clip placed elsewhere.
  const reuse = previous.slotId === entry.slotId && !(previous.type === 'clip' && previous.locked);
  const id = reuse ? previous.id : input.ids();
  const pick = input.picks.get(entry.slotId);
  if (!pick)
    return {
      item: { type: 'gap', id, duration: slot.duration, slotId: entry.slotId },
      cast: { slotId: entry.slotId, clipId: null, pick: null, ...EMPTY_CAST(), note: 'noCandidates' },
    };
  const shot = input.shots.get(pick.shotId ?? pick.assetId);
  if (!shot)
    return {
      error: { ok: false, error: timelineError('timeline.media_missing', { assetId: pick.assetId }) },
    };
  const before = previous.type === 'clip' ? previous : null;
  const clip: Clip = {
    type: 'clip',
    id,
    media: { kind: 'video', assetId: pick.assetId, shotId: pick.shotId, available: shot.available },
    sourceStart: pick.sourceStart,
    ...timing,
    speed: null,
    syncPoint: pick.syncPoint,
    fit: before?.fit ?? 'cover',
    audio: before?.audio ?? { gainDb: 0, muted: true },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
  if (!fits(clip, rate))
    return { error: { ok: false, error: timelineError('timeline.media_too_short', { clipId: id }) } };
  return { item: clip, cast: { slotId: entry.slotId, clipId: id, pick, ...EMPTY_CAST(), note: null } };
}

type VideoRebase =
  | { readonly error: Edit }
  | { readonly items: SequenceItem[]; readonly cast: SlotCast[]; readonly changed: ReadonlySet<string> };

function rebaseVideo(timeline: Timeline, input: RebaseInput): VideoRebase {
  const video = timeline.tracks[0];
  const items = video?.kind === 'video' ? video.items : [];
  const { template, slotMap } = input.split;
  const locked = lockedClips(items, slotMap, input.source);
  if (!locked.ok)
    return { error: { ok: false, error: timelineError('timeline.clip_locked', { clipId: locked.clipId }) } };
  const groups = new Map<string, Entry[]>();
  for (const entry of slotMap)
    groups.set(entry.from[0] ?? '', [...(groups.get(entry.from[0] ?? '') ?? []), entry]);
  const mapped = new Set<string>(slotMap.flatMap((entry) => entry.from as readonly string[]));
  const castOf = new Map<string, SlotCast>((timeline.cast?.slots ?? []).map((slot) => [slot.slotId, slot]));
  const movedLocks = new Set<string>([...locked.locked.values()].map((clip) => clip.id));
  const placed: SequenceItem[] = [];
  const cast: SlotCast[] = [];
  const changed = new Set<string>();
  const keepTransition = (index: number) => {
    const transition = items[index - 1];
    const before = items[index - 2];
    if (transition?.type === 'transition' && before && placed.at(-1)?.id === before.id)
      placed.push(transition);
  };
  for (const [index, item] of items.entries()) {
    if (item.type === 'transition') continue;
    if (!item.slotId || !mapped.has(item.slotId)) {
      if (movedLocks.has(item.id)) continue;
      keepTransition(index);
      placed.push(item);
      continue;
    }
    for (const entry of groups.get(item.slotId) ?? []) {
      if (entry.unchanged) {
        keepTransition(index);
        placed.push({ ...item, slotId: entry.slotId });
        const slotCast = item.slotId ? castOf.get(item.slotId) : undefined;
        if (slotCast) cast.push({ ...slotCast, slotId: entry.slotId });
        continue;
      }
      const made = changedItem(entry, item, input, { template, locked: locked.locked });
      if ('error' in made) return { error: made.error };
      placed.push(made.item);
      cast.push(made.cast);
      changed.add(entry.slotId);
    }
  }
  return { items: placed, cast, changed };
}

function clampTo<T extends { readonly start: RationalTime; readonly duration: RationalTime }>(
  item: T,
  length: number,
) {
  if (item.start.value >= length) return null;
  const end = Math.min(item.start.value + item.duration.value, length);
  if (end === item.start.value + item.duration.value) return item;
  return { ...item, duration: RationalTime.of(end - item.start.value, item.duration.rate) };
}

function rebaseText(timeline: Timeline, split: EnergySplit, length: number): Timeline['tracks'] {
  const overlays = new Map<string, Template['text'][number]>(
    split.template.text.map((overlay) => [overlay.id, overlay]),
  );
  const firstNew = new Map<string, SlotId>();
  for (const entry of split.slotMap)
    for (const from of entry.from) if (!firstNew.has(from)) firstNew.set(from, entry.slotId);
  const moved = (item: TextTrackItem): TextTrackItem | null => {
    if (item.type !== 'text') return clampTo(item, length);
    const overlay = item.overlayId && item.origin !== 'user' ? overlays.get(item.overlayId) : undefined;
    if (overlay)
      return clampTo(
        { ...item, start: overlay.start, duration: overlay.duration, slotId: overlay.slotId },
        length,
      );
    const slotId = item.slotId ? (firstNew.get(item.slotId) ?? item.slotId) : null;
    return clampTo({ ...item, slotId }, length);
  };
  return timeline.tracks.map((track) =>
    track.kind === 'text' ? { ...track, items: track.items.flatMap((item) => moved(item) ?? []) } : track,
  );
}

/** The timeline on the re-split template's version `version`: V1, the cast, the text and the markers. */
export function rebaseOnCurve(timeline: Timeline, input: RebaseInput, version: number): Edit {
  const video = rebaseVideo(timeline, input);
  if ('error' in video) return video.error;
  const length = video.items.reduce(
    (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
    0,
  );
  const tracks = timeline.tracks.map((track, index) =>
    index === 0 && track.kind === 'video' ? { ...track, items: video.items } : track,
  );
  const placed: Timeline = {
    ...timeline,
    tracks,
    cast: timeline.cast ? { ...timeline.cast, slots: video.cast } : null,
    template: { id: input.split.template.id, version },
  };
  const markers = timeline.markers.flatMap((marker) => {
    const range = clampTo(marker.range, length);
    return range ? [{ ...marker, range }] : [];
  });
  return { ok: true, timeline: { ...placed, tracks: rebaseText(placed, input.split, length), markers } };
}

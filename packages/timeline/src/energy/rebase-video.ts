// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * V1 and the cast state rebased onto the template version an energy curve made (P3-V12). The new slots are
 * emitted in the timeline's own order, each at the old item its first source slot held: an unchanged slot keeps
 * its item exactly (id, media, in-point, length), a changed one gets the plan's pick for the slot's new length (or
 * a gap), and the clip the user locked keeps its shot on the first new slot of its span. Transitions stay where
 * the cut and both neighbours are as they were, and come from the template on the changed cuts.
 */
import {
  err,
  ok,
  ValidationError,
  type CastCandidate,
  type Clip,
  type CommandSource,
  type EnergySlotMap,
  type MediaRef,
  type Result,
  type SequenceItem,
  type SlotCast,
  type Template,
  type TemplateSlot,
  type TimelineItemId,
} from '@taalcut/core';
import { ClipLocked, MediaMissing, MediaTooShort } from '../errors';
import { candidateKey, manualCandidate } from '../model/cast';
import type { Filler } from '../model/sequence';
import { clipMediaFits, gentlerRamp } from '../model/speed';

type Entry = EnergySlotMap[number];

export interface VideoRebaseInput {
  readonly items: readonly SequenceItem[];
  readonly cast: readonly SlotCast[];
  readonly template: Template;
  readonly slotMap: EnergySlotMap;
  /** The plan's pick per changed slot id. */
  readonly picks: ReadonlyMap<string, CastCandidate>;
  /** Media by candidate key. */
  readonly media: ReadonlyMap<string, MediaRef>;
  readonly source: CommandSource;
  readonly ids: () => TimelineItemId;
}

export interface VideoRebase {
  readonly items: SequenceItem[];
  readonly cast: SlotCast[];
  /** New slot ids whose item changed. */
  readonly changed: ReadonlySet<string>;
}

/** The clip each changed slot inherits because the user locked it: the first new slot of the locked clip's span. */
function lockedClips(input: VideoRebaseInput): Result<Map<string, Clip>> {
  const out = new Map<string, Clip>();
  for (const item of input.items) {
    if (item.type !== 'clip' || !item.locked || !item.slotId) continue;
    const slotId: string = item.slotId;
    const entry = input.slotMap.find((candidate) => (candidate.from as readonly string[]).includes(slotId));
    if (!entry || entry.unchanged) continue;
    if (input.source === 'agent') return err(ClipLocked({ clipId: item.id }));
    if (!out.has(entry.slotId)) out.set(entry.slotId, item);
  }
  return ok(out);
}

/** The clip fitted to the new slot; a ramp the media can't carry gets gentler, else MediaTooShort. */
function fitted(clip: Clip, rate: Template['canvas']['rate']): Result<Clip> {
  if (clipMediaFits(clip, rate)) return ok(clip);
  if (clip.media.kind !== 'image' && clip.speed) {
    const gentler = { ...clip, speed: gentlerRamp(clip, clip.media.available, rate) };
    if (clipMediaFits(gentler, rate)) return ok(gentler);
  }
  return err(MediaTooShort({ clipId: clip.id }));
}

function changedItem(
  entry: Entry,
  slot: TemplateSlot,
  previous: Filler,
  context: { readonly input: VideoRebaseInput; readonly locked: ReadonlyMap<string, Clip> },
): Result<{ item: SequenceItem; cast: SlotCast }> {
  const { input, locked } = context;
  const template = input.template;
  const timing = {
    duration: slot.duration,
    speed: slot.speedRamp,
    slotId: entry.slotId,
    beatAnchor: template.beatMap ? slot.beatAnchor : null,
  };
  const empty = { alternates: [], confidence: null, needsRerank: false };
  const kept = locked.get(entry.slotId);
  if (kept) {
    const clip = fitted({ ...kept, ...timing, syncPoint: null }, template.canvas.rate);
    if (!clip.ok) return clip;
    const shotId = kept.media.kind === 'video' ? kept.media.shotId : null;
    const pick = manualCandidate({ assetId: kept.media.assetId, shotId }, kept.sourceStart, null);
    return ok({
      item: clip.value,
      cast: { slotId: entry.slotId, clipId: kept.id, pick, ...empty, note: 'userPick' },
    });
  }
  // The piece that keeps the old slot's id keeps its item's id too, unless that is a locked clip placed elsewhere.
  const reuse = previous.slotId === entry.slotId && !(previous.type === 'clip' && previous.locked);
  const id = reuse ? previous.id : input.ids();
  const pick = input.picks.get(entry.slotId);
  if (!pick) {
    const gap: SequenceItem = { type: 'gap', id, duration: slot.duration, slotId: entry.slotId };
    return ok({
      item: gap,
      cast: { slotId: entry.slotId, clipId: null, pick: null, ...empty, note: 'noCandidates' },
    });
  }
  const media = input.media.get(candidateKey(pick));
  if (!media) return err(MediaMissing({ assetId: pick.assetId }));
  const before = previous.type === 'clip' ? previous : null;
  const clip = fitted(
    {
      type: 'clip',
      id,
      media,
      sourceStart: pick.sourceStart,
      ...timing,
      syncPoint: media.kind === 'image' ? null : pick.syncPoint,
      fit: before?.fit ?? 'cover',
      audio: before?.audio ?? { gainDb: 0, muted: true },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    },
    template.canvas.rate,
  );
  if (!clip.ok) return clip;
  return ok({ item: clip.value, cast: { slotId: entry.slotId, clipId: id, pick, ...empty, note: null } });
}

/** Where each old slot's new slots come from: lookups built once per rebase. */
interface Lookup {
  readonly slots: ReadonlyMap<string, TemplateSlot>;
  readonly castOf: ReadonlyMap<string, SlotCast>;
  /** Old slot ids the slot map covers. */
  readonly mapped: ReadonlySet<string>;
  /** The new slots each old slot starts, keyed by that old slot's id. */
  readonly groups: ReadonlyMap<string, readonly Entry[]>;
  /** Locked clips that move to a new slot: not placed where they were. */
  readonly lockedIds: ReadonlySet<string>;
}

function lookupOf(input: VideoRebaseInput, locked: ReadonlyMap<string, Clip>): Lookup {
  const groups = new Map<string, Entry[]>();
  for (const entry of input.slotMap) {
    const first: string = entry.from[0] ?? '';
    groups.set(first, [...(groups.get(first) ?? []), entry]);
  }
  return {
    slots: new Map(input.template.slots.map((slot) => [slot.id as string, slot])),
    castOf: new Map(input.cast.map((slot) => [slot.slotId as string, slot])),
    mapped: new Set(input.slotMap.flatMap((entry) => entry.from as readonly string[])),
    groups,
    lockedIds: new Set([...locked.values()].map((clip) => clip.id as string)),
  };
}

/** What has been placed so far: the new V1, the new cast and the changed slots. */
interface Placed {
  readonly items: SequenceItem[];
  readonly cast: SlotCast[];
  readonly changed: Set<string>;
}

/** Keeps the transition before old item `index` when the item before it is the last one placed. */
function keepOldTransition(placed: Placed, old: readonly SequenceItem[], index: number): void {
  const transition = old[index - 1];
  const before = old[index - 2];
  if (transition?.type === 'transition' && before && placed.items.at(-1)?.id === before.id)
    placed.items.push(transition);
}

/** The new slot's own transition in, on a cut between two clips. */
function addTemplateTransition(
  placed: Placed,
  slot: TemplateSlot,
  next: SequenceItem,
  ids: () => TimelineItemId,
) {
  const transition = slot.transitionIn;
  if (!transition || placed.items.at(-1)?.type !== 'clip' || next.type !== 'clip') return;
  placed.items.push({
    type: 'transition',
    id: ids(),
    kind: transition.kind,
    inOffset: transition.before,
    outOffset: transition.after,
    direction: transition.direction,
  });
}

interface PlaceContext {
  readonly input: VideoRebaseInput;
  readonly locked: ReadonlyMap<string, Clip>;
  readonly lookup: Lookup;
  readonly placed: Placed;
}

/** One new slot made from old item `index` (`item`): kept as it was when unchanged, else the plan's pick. */
function placeEntry(entry: Entry, index: number, item: Filler, context: PlaceContext): Result<void> {
  if (item.type === 'program') return err(ValidationError({ field: 'template' }, { detail: 'An authored program has its own continuous timing.' }));
  const { input, lookup, placed } = context;
  const slot = lookup.slots.get(entry.slotId);
  if (!slot)
    return err(
      ValidationError({ field: 'slotMap' }, { detail: `No slot ${entry.slotId} in the new version` }),
    );
  if (entry.unchanged) {
    keepOldTransition(placed, input.items, index);
    placed.items.push({ ...item, slotId: entry.slotId });
    const slotCast = item.slotId ? lookup.castOf.get(item.slotId) : undefined;
    if (slotCast) placed.cast.push({ ...slotCast, slotId: entry.slotId });
    return ok(undefined);
  }
  const made = changedItem(entry, slot, item, { input, locked: context.locked });
  if (!made.ok) return made;
  addTemplateTransition(placed, slot, made.value.item, input.ids);
  placed.items.push(made.value.item);
  placed.cast.push(made.value.cast);
  placed.changed.add(entry.slotId);
  return ok(undefined);
}

export function rebaseVideo(input: VideoRebaseInput): Result<VideoRebase> {
  const locked = lockedClips(input);
  if (!locked.ok) return locked;
  const lookup = lookupOf(input, locked.value);
  const placed: Placed = { items: [], cast: [], changed: new Set<string>() };
  const context: PlaceContext = { input, locked: locked.value, lookup, placed };
  for (const [index, item] of input.items.entries()) {
    if (item.type === 'transition') continue;
    // An item outside the template's slots stays as it was, unless it is a locked clip that moves to a new slot.
    if (!item.slotId || !lookup.mapped.has(item.slotId)) {
      if (lookup.lockedIds.has(item.id)) continue;
      keepOldTransition(placed, input.items, index);
      placed.items.push(item);
      continue;
    }
    for (const entry of lookup.groups.get(item.slotId) ?? []) {
      const done = placeEntry(entry, index, item, context);
      if (!done.ok) return done;
    }
  }
  return ok(placed);
}

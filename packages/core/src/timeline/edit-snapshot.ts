// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: what the changes card compares. A snapshot keeps, for every item a person can point at, only the facts
 * the card words (its length, start, words, place, speed, footage, framing, transition, volume) and a digest of the
 * rest, plus a digest of each whole-video setting. It is small enough to log with a run (the agent takes one when a
 * docked message arrives), and JSON as it is. Times are seconds. HFW1: a graphic's design (its composition's name
 * and version) and whether it is still a proposal.
 */
import type { EDIT_SETTINGS, EditChange } from '../cards/edit-changes-card';
import type { TEXT_ROLES } from '../templates/template-parts';
import { FrameRateValue } from '../time/frame-rate-value';
import { RationalTime } from '../time/rational-time';
import { compositionFor, type GraphicComposition } from '../workspace/composition';
import { editItemsOf, type EditItemPlace } from './edit-items';
import type { EditItemKind } from './edit-target';
import type { GraphicItem } from './graphics';
import type { Clip, TextItem, TransitionItem } from './timeline-items';
import type { Timeline } from './timeline-schema';

type Of<K extends EditChange['kind']> = Extract<EditChange, { kind: K }>;

/** Words longer than this are cut: the card shows a line, and the log stays small. */
const MAX_WORDS = 200;

export interface EditItemFacts {
  readonly id: string;
  readonly kind: EditItemKind;
  readonly number: number;
  readonly start: number;
  readonly length: number;
  readonly role?: (typeof TEXT_ROLES)[number];
  readonly words?: string;
  readonly place?: Of<'place'>['after'];
  readonly speed?: Of<'speed'>['after'];
  /** The footage it plays (asset and shot), to tell a swap from a trim. */
  readonly media?: string;
  /** FIX-TRIM: a video clip's in-point, seconds of its media, to tell a slip. */
  readonly part?: number;
  readonly framing?: Of<'framing'>['after'];
  readonly transition?: Of<'transition'>['after'];
  /** Gain in dB; null is muted. */
  readonly volume?: number | null;
  /**
   * HFW1: a graphic's design: its composition (`key` is its id and hash; name and version as the card says them).
   * Absent for other items and in a snapshot from before HFW1.
   */
  readonly design?: { readonly key: string; readonly name: string; readonly version: number };
  /** HFW1: a graphic that is still a proposal. */
  readonly proposed?: boolean;
  /** A digest of everything else about it (its style, its motion, its slip). */
  readonly rest: string;
}

export type EditSetting = (typeof EDIT_SETTINGS)[number];

export interface EditSnapshot {
  readonly timelineId: string;
  readonly revision: number;
  readonly items: readonly EditItemFacts[];
  /** A digest of each whole-video setting. */
  readonly settings: Readonly<Record<EditSetting, string>>;
}

/** FNV-1a over a value's JSON: equal values give equal digests. Not for security. */
export function digest(value: unknown): string {
  const text = JSON.stringify(value) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Without these keys: what's left is digested into `rest`. */
function without<T extends object>(value: T, keys: readonly (keyof T)[]): Partial<T> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

const placeOfY = (middle: number): Of<'place'>['after'] =>
  middle < 1 / 3 ? 'top' : middle < 2 / 3 ? 'middle' : 'bottom';

function speedOf(clip: Clip): Of<'speed'>['after'] {
  const points = clip.speed?.points;
  if (!points) return 1;
  const first = points[0]!.speed;
  return points.every((point) => point.speed === first) ? first : 'ramp';
}

function clipFacts(clip: Clip) {
  const shot = clip.media.kind === 'video' ? clip.media.shotId : null;
  return {
    speed: speedOf(clip),
    media: `${clip.media.assetId}:${shot ?? ''}`,
    ...(clip.media.kind === 'video' ? { part: RationalTime.toSeconds(clip.sourceStart) } : {}),
    framing: clip.reframe?.mode ?? clip.fit,
    volume: clip.audio.muted ? null : clip.audio.gainDb,
    rest: digest(without(clip, ['id', 'duration', 'media', 'speed', 'fit', 'reframe', 'audio'])),
  };
}

function textFacts(item: TextItem) {
  return {
    role: item.role,
    place: placeOfY(item.box.y + item.box.height / 2),
    rest: digest(without(item, ['id', 'start', 'duration', 'text', 'box', 'placement'])),
  };
}

function graphicFacts(item: GraphicItem, compositions: readonly GraphicComposition[] | undefined) {
  const { placement } = item;
  const place =
    typeof placement === 'string' ? placement : placeOfY(placement.box.y + placement.box.height / 2);
  const ref = item.composition;
  const copy = compositionFor(ref, compositions);
  // A composition the timeline doesn't hold is still a design: its id names it.
  const design = { key: `${ref.id}@${ref.hash}`, name: copy?.name ?? '', version: copy?.version ?? 1 };
  return {
    place,
    design,
    proposed: item.proposal !== undefined,
    rest: digest(without(item, ['id', 'start', 'duration', 'placement', 'anchor'])),
  };
}

const transitionFacts = (item: TransitionItem) => ({
  transition: item.kind,
  rest: digest(without(item, ['id', 'kind', 'inOffset', 'outOffset'])),
});

/** Every item of the timeline, by id. */
function itemsById(timeline: Timeline): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const track of timeline.tracks) for (const item of track.items) byId.set(item.id, item);
  for (const cue of timeline.captions?.cues ?? []) byId.set(cue.id, cue);
  return byId;
}

function factsOf(
  place: EditItemPlace,
  item: unknown,
  fps: number,
  compositions: readonly GraphicComposition[] | undefined,
): EditItemFacts {
  const kind = place.target.itemKind;
  const base = {
    id: place.target.itemId,
    kind,
    number: place.number,
    start: Math.max(0, place.start) / fps,
    length: (place.end - place.start) / fps,
    ...(place.words !== null ? { words: place.words.slice(0, MAX_WORDS) } : {}),
  };
  if (kind === 'clip' || kind === 'audio') return { ...base, ...clipFacts(item as Clip) };
  if (kind === 'text') return { ...base, ...textFacts(item as TextItem) };
  if (kind === 'graphic') return { ...base, ...graphicFacts(item as GraphicItem, compositions) };
  if (kind === 'transition') return { ...base, ...transitionFacts(item as TransitionItem) };
  return {
    ...base,
    rest: digest(without(item as { id: string; range: unknown; words: unknown }, ['id', 'range', 'words'])),
  };
}

/** The timeline as the changes card compares it. */
export function editSnapshot(timeline: Timeline): EditSnapshot {
  const fps = FrameRateValue.toNumber(timeline.canvas.rate);
  const byId = itemsById(timeline);
  const captions = timeline.captions && without(timeline.captions, ['cues']);
  return {
    timelineId: timeline.id,
    revision: timeline.revision,
    items: editItemsOf(timeline).map((place) =>
      factsOf(place, byId.get(place.target.itemId), fps, timeline.graphicCompositions),
    ),
    settings: {
      music: digest(timeline.music),
      captions: digest(captions),
      look: digest(timeline.styleId),
      voiceover: digest(timeline.voiceover),
      mix: digest(timeline.mix),
    },
  };
}

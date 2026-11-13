// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the breakdown already knows about each resolved slot (LRN1-CTX, spike 09 idea 2), so the Analyst
 * writes an intent for what the shot is for, not for its frame alone: the on-screen text over the slot, the
 * words said during it, and where it sits (start, length, on or off the beat). Pure and deterministic; no
 * model runs here. All of the text is someone else's (OCR and speech of the reference): the tool's output
 * schema marks it untrusted so the agent fences it, and the limits below keep it inside the model's context.
 */
import { RationalTime, type OverlayDesignKind, type TEXT_REVEALS, type TEXT_ROLES } from '@taalcut/core';
import { beatFrames, onBeat } from '../edits/timing';
import { clip, levelFor } from './slot-context-budget';
import { SMALLEST_WINDOW } from './slot-context-pages';

/** The window the share is half at: the smallest measured, where the slot text caps were first sized (follow-ups 3). */
const HALF_SHARE_WINDOW = 8_192;
import { speechBySlot } from './slot-context-speech';
import { cameraWords, slotMeasure } from './camera';
import { BREAKDOWN_CONFIG, type BreakdownConfig } from './config';
import { SURE_DESIGN } from './graphic-brief/compose';
import type { BreakdownDraft } from './draft';

export const SLOT_CONTEXT_LIMITS = {
  /** An overlay belongs to a slot it shows over for at least this many frames (or the whole slot, if shorter). */
  minOverlapFrames: 3,
  /** On-screen text tracks per slot, after de-duplication, in reading order. */
  tracksPerSlot: 4,
  /** Characters of on-screen text per slot, all of its tracks together. */
  onScreenChars: 160,
  /** Characters of speech per slot. */
  speechChars: 200,
  /** Characters of on-screen text and speech across every slot together. */
  totalChars: 1800,
} as const;

/** BRK1 looks: the longest strip description kept in a slot's context (`looks.ts`). */
export const LOOKS_CHARS = 800;

export interface SlotContextLimits {
  readonly minOverlapFrames: number;
  readonly tracksPerSlot: number;
  readonly onScreenChars: number;
  readonly speechChars: number;
  readonly totalChars: number;
}

/**
 * The share of SLOT_CONTEXT_LIMITS' text a model's window gets (LRN1-CTX, SPEC "Writing the slots a page at a
 * time"): half at HALF_SHARE_WINDOW (8,192), a quarter more each time the window doubles, all of it from 32,768 up.
 * An unknown window is the smallest a local tier runs (SMALLEST_WINDOW). A slot's text is most of what a page grows
 * by, so a small window holds more slots a page, each with the start of its text.
 */
export function slotContextShare(window: number | undefined): number {
  const doublings = Math.log2((window ?? SMALLEST_WINDOW) / HALF_SHARE_WINDOW);
  return Math.min(1, Math.max(0.5, 0.5 + 0.25 * doublings));
}

/** SLOT_CONTEXT_LIMITS with its text caps at the window's share. */
export function slotContextLimitsFor(window: number | undefined): SlotContextLimits {
  const share = slotContextShare(window);
  return {
    ...SLOT_CONTEXT_LIMITS,
    onScreenChars: Math.round(SLOT_CONTEXT_LIMITS.onScreenChars * share),
    speechChars: Math.round(SLOT_CONTEXT_LIMITS.speechChars * share),
    totalChars: Math.round(SLOT_CONTEXT_LIMITS.totalChars * share),
  };
}

/** Where on the canvas a text sits: the third of the height and of the width its box's centre is in. */
export const TEXT_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const satisfies readonly `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`[];
export type TextPosition = (typeof TEXT_POSITIONS)[number];

/**
 * One on-screen text over a slot. Fields that say nothing are left out, to keep a long reel's context small:
 * `reveal` when the text simply shows ('none'), `earlier` unless the text was already showing before the cut.
 */
export interface SlotTextTrack {
  /** OCR of the reference: untrusted. */
  readonly text: string;
  readonly role: (typeof TEXT_ROLES)[number];
  readonly position: TextPosition;
  readonly reveal?: Exclude<(typeof TEXT_REVEALS)[number], 'none'>;
  /** The text carries across the cut from an earlier slot. */
  readonly earlier?: true;
  /**
   * FIX-HOOK: what the text is drawn on, as the breakdown measured it (its design's kind, at SURE_DESIGN or more): a
   * chat bubble, a pill, a lower third. Absent for plain text and for a design it wasn't sure of. The Analyst reads
   * a slot's needs from it as much as from the words.
   */
  readonly shape?: Exclude<OverlayDesignKind, 'plain'>;
}

/** The overlay's measured shape, when sure and not plain text. */
function shapeOf(overlay: Overlay): Exclude<OverlayDesignKind, 'plain'> | undefined {
  const design = overlay.design;
  return design && design.confidence >= SURE_DESIGN && design.kind !== 'plain' ? design.kind : undefined;
}

/** A slot's context; `onBeat`, `onScreen` and `speech` are left out when there is nothing to say. */
export interface SlotContext {
  /**
   * Length in seconds, rounded to milliseconds: for the model to read, never to compute with. Where the slot
   * starts is already on the slot (`index`, `start`).
   */
  readonly seconds: number;
  /** The slot starts within one frame of a beat; absent when the reel has no beat map. */
  readonly onBeat?: boolean;
  /** Absent when no text shows over the slot. */
  readonly onScreen?: SlotTextTrack[];
  /** The words said during the slot (speech of the reference: untrusted); absent when nothing is said. */
  readonly speech?: string;
  /**
   * FRM1-MOT: the camera's move through the slot, measured, in words ("pan right", "unsure: maybe tracking …";
   * camera.ts `cameraWords`); absent when the breakdown has no measure for it.
   */
  readonly camera?: string;
  /**
   * BRK1 looks: what the slot's strip shows, described on this Mac by the pipeline (a model's reading of someone
   * else's video: untrusted); only on templates.resolveCuts' page, never in the draft.
   */
  readonly looks?: string;
}

/**
 * Whether a slot moves, from the provisional slot with its bounds: the camera's motion through it, or how far its
 * picture travels when there was no motion curve; null when there is no such slot or no measure. FRM1-MOT: only for
 * a draft without a measured camera (camera.ts).
 */
export function slotMoves(
  draft: BreakdownDraft,
  slot: Bounds,
  moves: BreakdownConfig['moves'] = BREAKDOWN_CONFIG.moves,
): boolean | null {
  const measured = draft.slotFrames.find((item) => item.start === slot.start && item.end === slot.end);
  if (measured?.motion !== undefined) return measured.motion >= moves.motion;
  return measured?.change === undefined ? null : measured.change >= moves.change;
}

interface Bounds {
  readonly start: number;
  readonly end: number;
}

type Overlay = BreakdownDraft['text'][number];

/** A clipped text shorter than this says nothing; the track is dropped instead. */
const MIN_TRACK_CHARS = 4;
/** Lines whose centres are within 5% of the height read as one row. */
const ROW_BAND = 0.05;

const fold = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
const rowOf = (centre: number) => (centre < 1 / 3 ? 'top' : centre < 2 / 3 ? 'middle' : 'bottom');
const columnOf = (centre: number) => (centre < 1 / 3 ? 'left' : centre < 2 / 3 ? 'center' : 'right');
const seconds = (frames: number, rate: BreakdownDraft['canvas']['rate']) =>
  Math.round(RationalTime.toSeconds(RationalTime.of(frames, rate)) * 1000) / 1000;

function positionOf(box: Overlay['box']): TextPosition {
  return `${rowOf(box.y + box.height / 2)}-${columnOf(box.x + box.width / 2)}`;
}

/** Top to bottom by rows, then left to right, then by when it appears. */
function readingOrder(a: { overlay: Overlay; start: number }, b: { overlay: Overlay; start: number }) {
  const row = (overlay: Overlay) => Math.floor((overlay.box.y + overlay.box.height / 2) / ROW_BAND);
  return row(a.overlay) - row(b.overlay) || a.overlay.box.x - b.overlay.box.x || a.start - b.start;
}

/**
 * The overlays over a slot, de-duplicated: the same text (case and spacing folded) once, and a text inside a
 * longer one over the same slot (a typewriter's earlier states, a line repeated in a longer one) dropped.
 */
function tracksOver(draft: BreakdownDraft, slot: Bounds, limits: SlotContextLimits): SlotTextTrack[] {
  const rate = draft.canvas.rate;
  const need = Math.min(limits.minOverlapFrames, slot.end - slot.start);
  const over = draft.text
    .map((overlay) => {
      const start = RationalTime.toFrames(overlay.start, rate);
      return { overlay, start, end: start + RationalTime.toFrames(overlay.duration, rate) };
    })
    .filter((item) => Math.min(item.end, slot.end) - Math.max(item.start, slot.start) >= need)
    .sort(readingOrder)
    .map((item) => ({ ...item, key: fold(item.overlay.text) }));
  const kept = over.filter(
    ({ key }, index) =>
      !over.some(
        (other, at) =>
          (other.key === key && at < index) || (other.key.length > key.length && other.key.includes(key)),
      ),
  );
  return kept.slice(0, limits.tracksPerSlot).map(({ overlay, start }) => ({
    text: overlay.text,
    role: overlay.role,
    position: positionOf(overlay.box),
    ...(overlay.reveal !== 'none' ? { reveal: overlay.reveal } : {}),
    ...(start < slot.start ? { earlier: true as const } : {}),
    ...(shapeOf(overlay) ? { shape: shapeOf(overlay) } : {}),
  }));
}

/** The tracks in order, each cut to what is left of `max`; a track that would be cut to nothing ends the list. */
function fitTracks(tracks: readonly SlotTextTrack[], max: number): SlotTextTrack[] {
  const fitted: SlotTextTrack[] = [];
  let left = max;
  for (const track of tracks) {
    const text = clip(track.text, left);
    if (text.length === 0 || (text !== track.text && text.length < MIN_TRACK_CHARS)) break;
    fitted.push({ ...track, text });
    left -= text.length;
  }
  return fitted;
}

const textLength = (tracks: readonly SlotTextTrack[]) =>
  tracks.reduce((sum, track) => sum + track.text.length, 0);

/**
 * The slots, each with its context. `slots` are resolveCuts' slots (frames at the canvas rate). Text is held to
 * the per-slot caps first; when all slots together are still over `totalChars`, every slot's on-screen text and
 * speech are cut to the same level (`levelFor`).
 */
export function withSlotContext<T extends Bounds>(
  draft: BreakdownDraft,
  slots: readonly T[],
  limits: SlotContextLimits = SLOT_CONTEXT_LIMITS,
): (T & { readonly context: SlotContext })[] {
  const rate = draft.canvas.rate;
  const beats = draft.beatMap ? beatFrames(draft.beatMap, rate) : null;
  const said = speechBySlot(draft, slots);
  const capped = slots.map((slot, index) => {
    const speech = said[index];
    return {
      slot,
      onScreen: fitTracks(tracksOver(draft, slot, limits), limits.onScreenChars),
      speech: speech ? clip(speech, limits.speechChars) : null,
    };
  });
  const level = levelFor(
    capped.flatMap((item) => [textLength(item.onScreen), item.speech?.length ?? 0]),
    limits.totalChars,
  );
  return capped.map(({ slot, onScreen, speech }) => {
    const spoken = Number.isFinite(level) && speech ? clip(speech, level) : speech;
    const tracks = Number.isFinite(level) ? fitTracks(onScreen, level) : onScreen;
    const camera = cameraWords(slotMeasure(draft.camera, slot));
    const context: SlotContext = {
      seconds: seconds(slot.end - slot.start, rate),
      ...(beats ? { onBeat: onBeat(beats, slot.start) } : {}),
      ...(tracks.length > 0 ? { onScreen: tracks } : {}),
      ...(spoken ? { speech: spoken } : {}),
      ...(camera ? { camera } : {}),
    };
    return { ...slot, context };
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planFormat (P2-T7): a slot plan from rules rather than a reference. Every
 * slot starts on a beat of a grid at the format's bpm (or the caller's); the
 * last slot absorbs the sub-beat remainder so the total is exactly the target
 * in frames. Pure and deterministic: ids come from the injected factory, the
 * time from the input.
 */
import {
  err,
  FrameRates,
  ok,
  RationalTime,
  templateSchema,
  ValidationError,
  type AudioProfile,
  type BeatMap,
  type Canvas,
  type FormatId,
  type FrameRate,
  type Result,
  type SlotId,
  type SpeedRamp,
  type Template,
  type TemplateId,
  type TemplateSlot,
  type TextOverlay,
  type TextOverlayId,
  type Transition,
} from '@taalcut/core';
import { computePacing } from '../edits/timing';
import { FormatTarget } from '../errors';
import { allocateBeats, type BeatRange, type PlannedSlot } from './allocate';
import { LABEL_BOX, TITLE_BOX, type TextBox } from './boxes';
import { labelsOf, type FormatSection, type SectionLabel } from './format-module';
import { getFormat } from './registry';

export const FORMAT_VERSION = '1.0.0';
export const FORMAT_MIN_SECONDS = 6;
export const FORMAT_MAX_SECONDS = 120;
export const FORMAT_BPM = { min: 80, max: 180, default: 120 } as const;
const HOOK_MAX_SECONDS = 1.5;
const DEFAULT_CANVAS: Canvas = { width: 1080, height: 1920, rate: FrameRates.fps30 };

/** Where new ids come from: newId in the app, a counter in tests. */
export interface TemplateIds {
  template(): TemplateId;
  slot(): SlotId;
  overlay(): TextOverlayId;
}

export interface PlanFormatInput {
  readonly formatId: FormatId;
  readonly targetSeconds: number;
  /** Default 30/1 (the canvas's rate when a canvas is given). */
  readonly rate?: FrameRate;
  readonly bpm?: number;
  readonly canvas?: Canvas;
  /** The user's words, kept on the origin. */
  readonly brief?: string | null;
  readonly createdAt?: number;
}

const BODY_SHORT: BeatRange = { min: 2, pref: 3, max: 4 };
const BODY_LONG: BeatRange = { min: 3, pref: 4, max: 6 };
const BRIEF_SLOT_COUNT_RE =
  /\b(?:exactly|only|use(?:\s+all)?)\s+(\d{1,2})\s+(?:unique\s+)?(?:named\s+)?(?:slots?|shots?|clips?)\b|\b(\d{1,2})\s+(?:unique\s+)?(?:slots?|shots?|clips?)\s*,?\s*(?:once\s+each|each\s+(?:clip\s+)?once|one\s+per\b)/i;

function requestedSlotCount(brief: string | null | undefined, maxBeats: number): number | undefined {
  if (!brief) return undefined;
  const match = BRIEF_SLOT_COUNT_RE.exec(brief);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const count = Number.parseInt(raw, 10);
  return Number.isInteger(count) && count >= 3 && count <= 60 && count <= maxBeats ? count : undefined;
}

function reindexPlan(slots: readonly PlannedSlot[]): PlannedSlot[] {
  const counts = new Map<FormatSection, number>();
  for (const slot of slots) counts.set(slot.section, (counts.get(slot.section) ?? 0) + 1);
  const indices = new Map<FormatSection, number>();
  return slots.map((slot) => {
    const index = indices.get(slot.section) ?? 0;
    indices.set(slot.section, index + 1);
    return { ...slot, index, count: counts.get(slot.section) ?? 1 };
  });
}

function fitRequestedSlotCount(
  plan: readonly PlannedSlot[],
  brief: string | null | undefined,
  maxBeats: number,
): readonly PlannedSlot[] {
  const target = requestedSlotCount(brief, maxBeats);
  if (!target || plan.length === target) return plan;
  const work = [...plan];
  while (work.length > target) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 1; i < work.length - 1; i++) {
      const a = work[i]!;
      const b = work[i + 1]!;
      if (b.section.role === 'outro' && a.section !== b.section) continue;
      const sameSection = a.section === b.section;
      const penalty = sameSection ? (a.section.fill ? 0 : 100) : 1000;
      const score = penalty + a.beats + b.beats;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 1) break;
    const left = work[best]!;
    const right = work[best + 1]!;
    work.splice(best, 2, { ...left, beats: left.beats + right.beats });
  }
  while (work.length < target) {
    let best = -1;
    let bestScore = -1;
    for (let i = 1; i < work.length; i++) {
      const slot = work[i]!;
      if (slot.beats < 2) continue;
      const score = (slot.section.fill ? 1000 : 0) + slot.beats;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 1) break;
    const slot = work[best]!;
    const first = Math.ceil(slot.beats / 2);
    work.splice(best, 1, { ...slot, beats: first }, { ...slot, beats: slot.beats - first });
  }
  return reindexPlan(work);
}

/** Beat k of the grid as a whole frame. */
function beatFrame(k: number, bpm: number, rate: FrameRate): number {
  return Math.round((k * 60 * rate.num) / (bpm * rate.den));
}

function gridBeatMap(total: number, bpm: number, rate: FrameRate): BeatMap {
  const beats: RationalTime[] = [];
  for (let k = 0; beatFrame(k, bpm, rate) < total; k++)
    beats.push(RationalTime.of(beatFrame(k, bpm, rate), rate));
  return {
    rate,
    beats,
    downbeats: beats.map((_, index) => index).filter((index) => index % 4 === 0),
    bpm,
    beatsPerBar: 4,
    confidence: 1,
    source: 'format',
  };
}

const TITLE_ROLES: readonly TextOverlay['role'][] = ['title'];

function boxFor(label: SectionLabel): TextBox {
  if (label.box) return label.box;
  return TITLE_ROLES.includes(label.role) ? TITLE_BOX : LABEL_BOX;
}

function shows(label: SectionLabel, index: number, count: number): boolean {
  if (label.when) return label.when(index, count);
  if (label.every) return true;
  return index === 0;
}

function overlay(ids: TemplateIds, slot: TemplateSlot, label: SectionLabel): TextOverlay {
  const title = label.role === 'title';
  return {
    id: ids.overlay(),
    text: label.text,
    role: label.role,
    start: slot.start,
    duration: slot.duration,
    slotId: slot.id,
    // Inside every export preset's safe rect, so render's captionSafeZone check passes.
    box: boxFor(label),
    appearance: {
      size: title ? 0.05 : 0.03,
      align: title ? 'center' : 'left',
      case: 'mixed',
      background: 'none',
    },
    styleKey: label.role,
    reveal: 'fade',
    language: null,
    confidence: 1,
  };
}

/** Points at 0, half the slot, and the slot's end. Curve ease. Null if the slot is too short to rise. */
function rampOf(section: FormatSection, duration: number, rate: FrameRate): SpeedRamp | null {
  const spec = section.speedRamp;
  if (!spec) return null;
  const mid = Math.floor(duration / 2);
  if (mid <= 0 || mid >= duration) return null;
  return {
    curve: 'ease',
    points: [
      { at: RationalTime.of(0, rate), speed: spec.from },
      { at: RationalTime.of(mid, rate), speed: spec.mid },
      { at: RationalTime.of(duration, rate), speed: spec.to },
    ],
  };
}

/** Two frames, or less when a neighbour is shorter, so the whip fits both slots. */
function whipOf(
  section: FormatSection,
  order: number,
  index: number,
  previous: TemplateSlot | undefined,
  duration: number,
  rate: FrameRate,
): Transition | null {
  if (order === 0 || index !== 0 || section.transitionIn?.kind !== 'whip' || !previous) return null;
  const frames = Math.min(2, previous.duration.value, duration);
  if (frames < 1) return null;
  return {
    kind: 'whip',
    before: RationalTime.of(frames, rate),
    after: RationalTime.of(frames, rate),
    direction: null,
    confidence: 1,
  };
}

function audioOf(kind: 'music' | 'voice'): AudioProfile {
  return { kind, loudnessLufs: null, sound: null, speech: null, waveform: null };
}

interface LaidPlan {
  readonly slots: TemplateSlot[];
  readonly text: TextOverlay[];
}

/** One slot per planned beat run. Null when a run would start past the beat grid. */
function laySlots(
  plan: readonly PlannedSlot[],
  beatMap: BeatMap,
  total: number,
  rate: FrameRate,
  ids: TemplateIds,
): LaidPlan | null {
  const slots: TemplateSlot[] = [];
  const text: TextOverlay[] = [];
  let beat = 0;
  for (let order = 0; order < plan.length; order++) {
    const planned = plan[order];
    if (!planned) return null;
    const startBeat = beatMap.beats[beat];
    if (!startBeat) return null;
    const start = startBeat.value;
    beat += planned.beats;
    let end = total;
    if (order !== plan.length - 1) {
      const next = beatMap.beats[beat];
      if (!next) return null;
      end = next.value;
    }
    const duration = end - start;
    const seed = planned.section.intent(planned.index, planned.count);
    const previous = slots[slots.length - 1];
    const slot: TemplateSlot = {
      id: ids.slot(),
      name: null,
      role: planned.section.role,
      start: RationalTime.of(start, rate),
      duration: RationalTime.of(duration, rate),
      intent: { ...seed, place: null, source: 'format' },
      beatAnchor: { beatIndex: beat - planned.beats, offset: RationalTime.zero(rate) },
      transitionIn: whipOf(planned.section, order, planned.index, previous, duration, rate),
      speedRamp: rampOf(planned.section, duration, rate),
      cut: { method: 'format', confidence: 1 },
      approved: false,
      frame: null,
    };
    slots.push(slot);
    for (const label of labelsOf(planned.section)) {
      if (shows(label, planned.index, planned.count)) text.push(overlay(ids, slot, label));
    }
  }
  return { slots, text };
}

export function planFormat(input: PlanFormatInput, ids: TemplateIds): Result<Template> {
  const found = getFormat(input.formatId);
  if (!found.ok) return found;
  const format = found.value;
  const { minSeconds, maxSeconds } = format.summary;
  const seconds = input.targetSeconds;
  if (!Number.isFinite(seconds) || seconds < minSeconds || seconds > maxSeconds)
    return err(FormatTarget({ min: minSeconds, max: maxSeconds }));
  const bpm = input.bpm ?? format.summary.defaultBpm;
  if (!Number.isFinite(bpm) || bpm < FORMAT_BPM.min || bpm > FORMAT_BPM.max)
    return err(ValidationError({ field: 'bpm' }, { detail: `bpm ${bpm} is outside 80–180` }));
  const base = input.canvas ?? DEFAULT_CANVAS;
  const canvas = input.rate ? { ...base, rate: input.rate } : base;
  const rate = canvas.rate;
  const total = RationalTime.toFrames(RationalTime.fromSeconds(input.targetSeconds, rate), rate);
  const beatMap = gridBeatMap(total, bpm, rate);
  const beatSeconds = 60 / bpm;
  const plan = allocateBeats(
    format.sections,
    beatMap.beats.length,
    {
      seconds: input.targetSeconds,
      hookBeats: 2 * beatSeconds <= HOOK_MAX_SECONDS ? 2 : 1,
      body: input.targetSeconds <= 30 ? BODY_SHORT : BODY_LONG,
    },
    format.constraints,
  );
  if (!plan || plan.length === 0) return err(FormatTarget({ min: minSeconds, max: maxSeconds }));
  const fitted = fitRequestedSlotCount(plan, input.brief, beatMap.beats.length);
  const laid = laySlots(fitted, beatMap, total, rate, ids);
  if (!laid) return err(FormatTarget({ min: minSeconds, max: maxSeconds }));

  return ok(
    templateSchema.parse({
      schemaVersion: 1,
      id: ids.template(),
      version: 1,
      parentVersion: null,
      createdAt: input.createdAt ?? 0,
      origin: {
        kind: 'format',
        formatId: input.formatId,
        formatVersion: format.summary.version,
        target: RationalTime.of(total, rate),
        brief: input.brief ? input.brief.slice(0, 500) : null,
      },
      canvas,
      duration: RationalTime.of(total, rate),
      slots: laid.slots,
      beatMap,
      text: laid.text,
      audio: audioOf(format.summary.audio),
      pacing: computePacing(laid.slots, beatMap, rate),
      styleId: null,
      contactSheet: null,
      language: null,
    } satisfies Template),
  );
}

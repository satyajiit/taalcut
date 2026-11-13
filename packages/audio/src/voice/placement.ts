// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Beat-aware placement of voiceover lines (SPEC P3.4), pure, in canvas frames. A line's onset (its first word)
 * lands on the first beat at or after its slot's start, or the downbeat when one falls within a beat of it; with
 * no beat map, 120 ms into the slot. A line that would overrun its span (its slot plus half of an unvoiced next
 * slot, never past the end) first tries the beat before the slot (a pre-lap of at most one beat, never closer
 * than 150 ms to the previous line), then a time-compression of at most 8 %, then fails with
 * `audio.script_too_long` so the skill shortens the text. The clip starts on the onset frame with its source
 * half a frame before the onset, so frame snapping never cuts the first phoneme.
 */
import {
  err,
  ok,
  RationalTime,
  type AssetId,
  type FrameRate,
  type Result,
  type SlotId,
  type Timeline,
  type VoiceLineId,
} from '@taalcut/core';
import { LINE_RATE } from './alignment';
import { frameMs as frameMsOf, timelineFrames } from '../timeline/span';
import { VOICE_CONFIG } from './config';
import { ScriptTooLong } from './errors';
import { timelineSlots, type SlotSpan } from './slots';

export interface PlacementLine {
  readonly lineId: VoiceLineId;
  readonly slotId: SlotId | null;
  readonly assetId: AssetId;
  /** The generated file's length, on its clock (LINE_RATE). */
  readonly duration: RationalTime;
  /** The first word's start in the file. */
  readonly onset: RationalTime;
  /** The last word's end in the file. */
  readonly speechEnd: RationalTime;
}

export interface Placement {
  readonly lineId: VoiceLineId;
  readonly slotId: SlotId | null;
  readonly assetId: AssetId;
  readonly startFrame: number;
  readonly durationFrames: number;
  /** Where the clip starts in the (compressed, if `compress` < 1) file, at LINE_RATE. */
  readonly sourceStart: RationalTime;
  readonly onsetFrame: number;
  readonly beatIndex: number | null;
  /** The onset couldn't land on a beat (the previous line ran too long). */
  readonly offBeat: boolean;
  /** 1, or the share of its length the line is compressed to (≥ 0.92). */
  readonly compress: number;
}

interface Grid {
  readonly beats: readonly number[];
  readonly downbeats: ReadonlySet<number>;
  readonly beatFrames: number;
}

function beatGrid(timeline: Timeline): Grid | null {
  const map = timeline.beatMap;
  if (!map || map.beats.length < 2) return null;
  const beats = map.beats.map((b) => RationalTime.toFrames(b, timeline.canvas.rate));
  const gaps = beats
    .slice(1)
    .map((b, i) => b - (beats[i] ?? 0))
    .sort((a, b) => a - b);
  return { beats, downbeats: new Set(map.downbeats), beatFrames: gaps[Math.floor(gaps.length / 2)] ?? 15 };
}

/** The beat a slot's line starts on: the downbeat within a beat of its start, else the first beat at or after it. */
function slotBeat(grid: Grid, slotStart: number, earliest: number): number | null {
  const from = Math.max(slotStart, earliest);
  const first = grid.beats.findIndex((b) => b >= from);
  if (first < 0) return null;
  for (let i = first; i < grid.beats.length && (grid.beats[i] ?? 0) <= from + grid.beatFrames; i++)
    if (grid.downbeats.has(i)) return i;
  return first;
}

export interface PlacementResult {
  readonly placements: readonly Placement[];
  readonly warnings: readonly string[];
}

interface Span {
  readonly start: number;
  /** The slot plus half of an unvoiced next slot, never past the timeline. */
  readonly allowedEnd: number;
}

function spanOf(
  line: PlacementLine,
  slots: readonly SlotSpan[],
  voiced: ReadonlySet<SlotId>,
  earliest: number,
  end: number,
): Span {
  const index = slots.findIndex((s) => s.slotId === line.slotId);
  const slot = slots[index];
  if (!slot) return { start: Math.max(0, earliest), allowedEnd: end };
  const next = slots[index + 1];
  const spill =
    next && !voiced.has(next.slotId)
      ? Math.floor((next.endFrame - next.startFrame) * VOICE_CONFIG.spillMax)
      : 0;
  return { start: slot.startFrame, allowedEnd: Math.min(end, slot.endFrame + spill) };
}

/** Candidate onsets, best first: the slot's beat, then one beat earlier (a pre-lap); without beats, the lead-in. */
function candidates(grid: Grid | null, span: Span, earliest: number, frame: number) {
  const out: { onset: number; beatIndex: number | null }[] = [];
  if (grid) {
    const beat = slotBeat(grid, span.start, earliest);
    if (beat !== null) {
      out.push({ onset: grid.beats[beat] ?? 0, beatIndex: beat });
      const before = grid.beats.findLastIndex(
        (b) => b < span.start && b >= span.start - grid.beatFrames && b >= earliest,
      );
      if (before >= 0) out.push({ onset: grid.beats[before] ?? 0, beatIndex: before });
    }
  }
  if (out.length === 0)
    out.push({
      onset: Math.max(earliest, span.start + Math.round(VOICE_CONFIG.leadInMs / frame)),
      beatIndex: null,
    });
  return out;
}

/** Samples of LINE_RATE → canvas frames. */
const toFrames = (samples: number, rate: FrameRate, rounding: 'floor' | 'ceil' | 'round') =>
  RationalTime.toFrames(RationalTime.of(Math.round(samples), LINE_RATE), rate, rounding);
const samplesOf = (time: RationalTime) => RationalTime.rescale(time, LINE_RATE).value;

/** The warning a line compressed by placement carries, in the pass that compressed it and in the outcome. */
export const compressionNote = (lineId: VoiceLineId, compress: number) =>
  `line ${lineId} compressed to ${compress}`;

export function planPlacement(timeline: Timeline, lines: readonly PlacementLine[]): Result<PlacementResult> {
  const rate = timeline.canvas.rate;
  const frame = frameMsOf(timeline);
  const frameSamples = samplesOf(RationalTime.of(1, rate));
  const end = timelineFrames(timeline);
  const slots = timelineSlots(timeline);
  const voiced = new Set(lines.map((l) => l.slotId).filter((s): s is SlotId => s !== null));
  const grid = beatGrid(timeline);
  const gap = Math.ceil(VOICE_CONFIG.gapMinMs / frame);
  const placed: Omit<Placement, 'durationFrames'>[] = [];
  const warnings: string[] = [];
  // Where the previous line's speech ends: the next onset keeps the gap after it.
  let speechEnd = -gap;
  for (const line of lines) {
    const earliest = speechEnd + gap;
    const span = spanOf(line, slots, voiced, earliest, end);
    const speechSamples = samplesOf(line.speechEnd) - samplesOf(line.onset);
    const speechFrames = toFrames(speechSamples, rate, 'ceil');
    const options = candidates(grid, span, earliest, frame);
    const fits = options.find((c) => c.onset + speechFrames <= span.allowedEnd);
    const chosen = fits ?? options.reduce((a, c) => (c.onset < a.onset ? c : a));
    let compress = 1;
    if (!fits) {
      const room = samplesOf(RationalTime.of(span.allowedEnd - chosen.onset, rate));
      const ratio = speechSamples > 0 ? room / speechSamples : 0;
      if (ratio < 1 - VOICE_CONFIG.maxCompress) {
        const squeezed = toFrames(speechSamples * (1 - VOICE_CONFIG.maxCompress), rate, 'ceil');
        const overByMs = Math.round((chosen.onset + squeezed - span.allowedEnd) * frame);
        return err(ScriptTooLong({ lineId: line.lineId, overByMs: Math.max(1, overByMs) }));
      }
      compress = Math.floor(ratio * 1000) / 1000;
      warnings.push(compressionNote(line.lineId, compress));
    }
    const offBeat = grid !== null && chosen.beatIndex === null;
    if (offBeat) warnings.push(`line ${line.lineId} is off the beat: the line before ran long`);
    const sourceStart = Math.max(0, Math.round(samplesOf(line.onset) * compress - frameSamples / 2));
    placed.push({
      lineId: line.lineId,
      slotId: line.slotId,
      assetId: line.assetId,
      startFrame: chosen.onset,
      sourceStart: RationalTime.of(sourceStart, LINE_RATE),
      onsetFrame: chosen.onset,
      beatIndex: chosen.beatIndex,
      offBeat,
      compress,
    });
    speechEnd = chosen.onset + toFrames(speechSamples * compress, rate, 'ceil');
  }
  // Each clip plays its file's tail up to the next line (never overlapping) and the timeline's end.
  const placements: Placement[] = [];
  for (const [i, p] of placed.entries()) {
    const fileSamples = samplesOf(lines[i]?.duration ?? RationalTime.zero(LINE_RATE)) * p.compress;
    const fileFrames = toFrames(fileSamples - p.sourceStart.value, rate, 'floor');
    const nextStart = placed[i + 1]?.startFrame ?? end;
    const durationFrames = Math.min(fileFrames, nextStart - p.startFrame, end - p.startFrame);
    if (durationFrames < 1) return err(ScriptTooLong({ lineId: p.lineId, overByMs: Math.round(frame) }));
    placements.push({ ...p, durationFrames });
  }
  return ok({ placements, warnings });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * SMPTE timecode, HH:MM:SS:FF. NTSC rates count in their nominal rate (24, 30,
 * 60). Drop-frame (29.97 and 59.94 only) skips frame labels 00 and 01 (or 00 to
 * 03 at 59.94) at the start of each minute except every tenth, so the label
 * tracks the wall clock; it is written with ';' before the frames.
 *
 * Timecode is for display and interchange. Store RationalTime, not timecode.
 */
import { ValidationError } from '../basics/errors';
import { err, ok, type Result } from '../basics/result';
import { FrameRate } from './frame-rate';
import { RationalTime } from './rational-time';

export interface TimecodeOptions {
  /** Default: true at 29.97 and 59.94 fps, false at every other rate. */
  readonly dropFrame?: boolean;
}

interface Base {
  readonly fps: number;
  /** Frame labels dropped per minute: 0, 2 (29.97) or 4 (59.94). */
  readonly drop: number;
}

/** 29.97 and 59.94 only. 119.88 (120000/1001) and other NTSC multiples are non-drop. */
function canDropFrame(rate: FrameRate): boolean {
  const nominal = FrameRate.nominal(rate);
  return FrameRate.isNtsc(rate) && (nominal === 30 || nominal === 60);
}

function baseFor(rate: FrameRate, dropFrame: boolean | undefined): Base {
  if (rate.den !== 1 && !FrameRate.isNtsc(rate)) {
    throw new RangeError(`Timecode needs a whole or NTSC rate, got ${rate.num}/${rate.den}`);
  }
  const fps = FrameRate.nominal(rate);
  const drop = dropFrame ?? canDropFrame(rate);
  if (drop && !canDropFrame(rate)) throw new RangeError(`Drop-frame timecode needs 29.97 or 59.94 fps`);
  return { fps, drop: drop ? fps / 15 : 0 };
}

/** Frame count to the frame count the labels show (adds the skipped labels back). */
function toLabelFrames(frames: number, { fps, drop }: Base): number {
  if (drop === 0) return frames;
  const perTenMinutes = fps * 600 - drop * 9;
  const perMinute = fps * 60 - drop;
  const tens = Math.floor(frames / perTenMinutes);
  const rest = frames % perTenMinutes;
  const skippedThisBlock = rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0;
  return frames + drop * 9 * tens + skippedThisBlock;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** '01:00:00:00', or '00:01:00;02' in drop-frame. Negative times get a leading '-'. */
export function formatTimecode(time: RationalTime, options: TimecodeOptions = {}): string {
  const base = baseFor(time.rate, options.dropFrame);
  if (time.value < 0) return `-${formatTimecode(RationalTime.of(-time.value, time.rate), options)}`;
  const label = toLabelFrames(time.value, base);
  const frames = label % base.fps;
  const totalSeconds = Math.floor(label / base.fps);
  const separator = base.drop > 0 ? ';' : ':';
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}${separator}${pad(frames)}`;
}

const TIMECODE = /^(-)?(\d{2,}):(\d{2}):(\d{2})([:;.,])(\d{2,3})$/;

/**
 * Parses timecode at `rate`. Without `dropFrame`, ';' or ',' before the frames
 * means drop-frame. Rejects labels that don't exist (minute 1 frame 00 in
 * drop-frame, frame 30 at 30 fps).
 */
export function parseTimecode(
  text: string,
  rate: FrameRate,
  options: TimecodeOptions = {},
): Result<RationalTime> {
  // Fixed messages only: the text is never echoed into `detail`.
  const invalid = (why: string): Result<RationalTime> =>
    err(ValidationError({ field: 'timecode' }, { detail: why }));
  const match = TIMECODE.exec(text.trim());
  if (!match) return invalid('Not a timecode');
  const [, sign, hh, mm, ss, separator, ff] = match;
  const dropFrame = options.dropFrame ?? (separator === ';' || separator === ',');
  if (dropFrame && !canDropFrame(rate)) return invalid('Drop-frame needs 29.97 or 59.94 fps');
  const base = baseFor(rate, dropFrame);
  const [hours, minutes, seconds, frames] = [hh, mm, ss, ff].map(Number) as [number, number, number, number];
  if (minutes > 59 || seconds > 59 || frames >= base.fps) return invalid('Field out of range');
  const totalMinutes = hours * 60 + minutes;
  if (base.drop > 0 && seconds === 0 && frames < base.drop && minutes % 10 !== 0) {
    return invalid('This frame label is dropped');
  }
  const label = (totalMinutes * 60 + seconds) * base.fps + frames;
  const count = label - base.drop * (totalMinutes - Math.floor(totalMinutes / 10));
  return ok(RationalTime.of(sign ? -count : count, rate));
}

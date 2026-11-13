// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: the recording's own ends (SPEC, casting step 5, "recording handles"). An editor never opens a clip on the
 * first second of a phone recording: the person and whoever films are only getting going. On the owner's footage the
 * picks the owner called "me starting up" sat 0 and 0.35 s into their files, follow shots from behind where neither
 * the frame's motion nor the person's box shows the start. So a window loses for the share of it inside the file's
 * first `startSeconds`, and less for its last `endSeconds` (reaching to stop). These are the file's ends, not the
 * shot's: a shot that starts mid-file has no handle at its start. A file too short for the window and both handles
 * keeps a share of each, so the window still fits between them. No tracking needed: every in-point has it.
 */
import { RationalTime, type ShotProfile } from '@taalcut/core';
import type { CastingConfig } from './config';

export type RecordingConfig = CastingConfig['inPoint']['recording'];

/** The recording's ends as they fall on a shot, in media frames from the shot's start. */
export interface RecordingHandles {
  /** The handles' lengths, after a short file shrank them. */
  readonly start: number;
  readonly end: number;
  /** A window starting before this plays some of the file's first handle: 0 when the shot starts after it. */
  readonly startEnd: number;
  /** A window running past this plays some of its last: the shot's length when the shot ends before it. */
  readonly endStart: number;
}

/** Where the file's handles fall on a shot whose windows are `window` media frames; none for a photo. */
export function recordingHandles(
  profile: ShotProfile,
  window: number,
  config: RecordingConfig,
): RecordingHandles {
  const length = profile.range.duration.value;
  const available = profile.available;
  if (profile.kind !== 'video' || !available) return { start: 0, end: 0, startEnd: 0, endStart: length };
  const rate = profile.range.start.rate;
  const frames = (time: RationalTime) => RationalTime.rescale(time, rate, 'round').value;
  const fileLength = frames(available.duration);
  const offset = profile.range.start.value - frames(available.start);
  const tail = fileLength - offset - length;
  let start = RationalTime.fromSeconds(config.startSeconds, rate, 'round').value;
  let end = RationalTime.fromSeconds(config.endSeconds, rate, 'round').value;
  const room = Math.max(0, fileLength - window);
  if (start + end > room) {
    const share = room / (start + end);
    start = Math.floor(start * share);
    end = Math.floor(end * share);
  }
  return {
    start,
    end,
    startEnd: Math.max(0, Math.min(length, start - offset)),
    endStart: Math.max(0, Math.min(length, length - Math.max(0, end - tail))),
  };
}

/**
 * What a window `[start, start + window)` loses to the handles: each part is the share of the window inside it, over
 * the share it could be (the window's length, or the handle's when that is shorter), as settle.ts counts the onset.
 */
export function recordingPenalty(
  handles: RecordingHandles,
  start: number,
  window: number,
  config: RecordingConfig,
): number {
  const stop = start + window;
  const inStart =
    handles.start > 0
      ? Math.max(0, Math.min(stop, handles.startEnd) - start) / Math.min(window, handles.start)
      : 0;
  const inEnd =
    handles.end > 0
      ? Math.max(0, stop - Math.max(start, handles.endStart)) / Math.min(window, handles.end)
      : 0;
  return config.startWeight * inStart + config.endWeight * inEnd;
}

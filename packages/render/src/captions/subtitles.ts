// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * SRT and VTT from a caption track (SPEC section 6). Cue times are the
 * frame boundaries floored to the millisecond, and an end never equals its
 * start. SRT: numbered from 1, `HH:MM:SS,mmm`, CRLF. VTT: a `WEBVTT` header,
 * `HH:MM:SS.mmm`, LF, and with `wordTimestamps` an inner `<HH:MM:SS.mmm>`
 * before every word after the first. Both are plain UTF-8 strings with no
 * byte-order mark; the window saves them as files.
 */
import { RationalTime, type CaptionCue, type CaptionTrack, type FrameRate } from '@taalcut/core';

/** Milliseconds at the start of frame k, floored: ⌊k · den · 1000 / num⌋. */
export function frameMs(frame: number, rate: FrameRate): number {
  return Number((BigInt(frame) * BigInt(rate.den) * 1000n) / BigInt(rate.num));
}

function clock(ms: number, separator: ',' | '.'): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const millis = ms % 1000;
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`;
}

interface TimedCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly cue: CaptionCue;
}

function timed(track: CaptionTrack, rate: FrameRate): TimedCue[] {
  return [...track.cues]
    .map((cue) => {
      const start = RationalTime.toFrames(cue.range.start, rate);
      const end = start + RationalTime.toFrames(cue.range.duration, rate);
      const startMs = frameMs(start, rate);
      return { startMs, endMs: Math.max(startMs + 1, frameMs(end, rate)), cue };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

const cueText = (cue: CaptionCue) => cue.words.map((word) => word.text).join(' ');

export function toSrt(track: CaptionTrack, rate: FrameRate): string {
  return timed(track, rate)
    .map(
      ({ startMs, endMs, cue }, index) =>
        `${index + 1}\r\n${clock(startMs, ',')} --> ${clock(endMs, ',')}\r\n${cueText(cue)}\r\n`,
    )
    .join('\r\n');
}

/** Text in a VTT cue payload: &, < and > are markup there. */
function escapeVtt(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function toVtt(
  track: CaptionTrack,
  rate: FrameRate,
  options: { readonly wordTimestamps?: boolean } = {},
): string {
  const cues = timed(track, rate).map(({ startMs, endMs, cue }) => {
    const payload = options.wordTimestamps
      ? cue.words
          .map((word, index) => {
            const text = escapeVtt(word.text);
            if (index === 0) return text;
            const at = frameMs(RationalTime.toFrames(word.range.start, rate), rate);
            return `<${clock(at, '.')}>${text}`;
          })
          .join(' ')
      : escapeVtt(cueText(cue));
    return `${clock(startMs, '.')} --> ${clock(endMs, '.')}\n${payload}\n`;
  });
  return ['WEBVTT\n', ...cues].join('\n');
}

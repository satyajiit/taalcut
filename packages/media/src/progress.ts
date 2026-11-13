// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Parses `ffmpeg -progress pipe:1 -nostats` output. FFmpeg writes blocks of
 * key=value lines, each ending with `progress=continue` or `progress=end`:
 *
 *   frame=60
 *   fps=40.25
 *   bitrate= 805.2kbits/s
 *   total_size=201509
 *   out_time_us=2002000
 *   speed=1.34x
 *   progress=end
 *
 * Values can be 'N/A' (or missing) early in a run; those fields are left out.
 */
import type { FallbackReason, MediaBackend } from './backends';
import type { RationalTime } from './rational-time';
import { toSeconds } from './rational';

export interface FfmpegProgress {
  readonly frame?: number;
  /** Encoding speed in frames per second (a measurement, so a float). */
  readonly fps?: number;
  /** Output position, exact in microseconds: { value: µs, rate: 1_000_000 }. */
  readonly outTime?: RationalTime;
  /** Realtime multiple, e.g. 1.34 for '1.34x'. */
  readonly speed?: number;
  readonly bitrateKbps?: number;
  readonly totalSizeBytes?: number;
  readonly dupFrames?: number;
  readonly dropFrames?: number;
  /** 0–100, present when the caller gave the expected output duration. 100 on the final event. */
  readonly percent?: number;
  /** True on the last event (`progress=end`). */
  readonly done: boolean;
  /** Which backend does the work, when the caller told `runFfmpeg` (ADR 0002). */
  readonly backend?: MediaBackend;
  /** Why it is the CPU, when it is. */
  readonly fallbackReason?: FallbackReason;
}

export type ProgressListener = (progress: FfmpegProgress) => void;

const MICROS = 1_000_000;

/** Incremental parser: feed it stdout chunks, get complete progress events back. */
export class ProgressParser {
  private partial = '';
  private fields = new Map<string, string>();

  /** @param duration Expected output duration, used for `percent`. */
  constructor(private readonly duration?: RationalTime) {}

  push(chunk: string | Buffer): FfmpegProgress[] {
    const text = this.partial + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    const lines = text.split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    const events: FfmpegProgress[] = [];
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'progress') {
        events.push(this.build(value === 'end'));
        this.fields = new Map();
      } else {
        this.fields.set(key, value);
      }
    }
    return events;
  }

  private build(done: boolean): FfmpegProgress {
    const f = this.fields;
    const outMicros =
      integer(f.get('out_time_us')) ?? integer(f.get('out_time_ms')) ?? parseClock(f.get('out_time'));
    const outTime = outMicros === undefined ? undefined : { value: Math.max(0, outMicros), rate: MICROS };
    // Fields FFmpeg reported as N/A stay undefined.
    return {
      frame: integer(f.get('frame')),
      fps: float(f.get('fps')),
      outTime,
      speed: float(f.get('speed')?.replace(/x$/, '')),
      bitrateKbps: float(f.get('bitrate')?.replace(/kbits\/s$/, '')),
      totalSizeBytes: integer(f.get('total_size')),
      dupFrames: integer(f.get('dup_frames')),
      dropFrames: integer(f.get('drop_frames')),
      percent: percentOf(outTime, this.duration, done),
      done,
    };
  }
}

function percentOf(outTime: RationalTime | undefined, duration: RationalTime | undefined, done: boolean) {
  if (!duration || toSeconds(duration) <= 0) return undefined;
  if (done) return 100;
  if (!outTime) return undefined;
  // One division, so round numbers stay round (5.5 s of 10 s is exactly 55).
  const percent = (outTime.value * duration.rate * 100) / (outTime.rate * duration.value);
  return Math.min(100, Math.max(0, percent));
}

function integer(text: string | undefined): number | undefined {
  if (!text || !/^-?\d+$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

function float(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

/** '00:00:02.002000' → 2002000 µs. */
function parseClock(text: string | undefined): number | undefined {
  const match = text ? /^(-)?(\d+):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(text) : null;
  if (!match) return undefined;
  const [, sign, h, m, s, frac = ''] = match;
  const micros = ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * MICROS + Number(frac.padEnd(6, '0'));
  return sign ? -micros : micros;
}

/**
 * Limits how often a listener fires. The first event and the final (`done`)
 * event always get through; others at most once per `intervalMs`.
 */
export function throttleProgress(
  listener: ProgressListener,
  intervalMs: number,
  now: () => number = Date.now,
): ProgressListener {
  let last: number | undefined;
  return (progress) => {
    const t = now();
    if (!progress.done && last !== undefined && t - last < intervalMs) return;
    last = t;
    listener(progress);
  };
}

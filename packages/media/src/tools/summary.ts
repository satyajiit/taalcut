// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model-facing view of a ProbeResult: what an editing agent needs
 * (duration, displayed size, fps, HDR, rotation, codecs) in about 150 tokens.
 * The full result goes to an artifact.
 */
import { basename } from 'node:path';
import { rationalToNumber, toSeconds } from '../rational';
import type { ProbeResult } from '../probe/types';
import type { ProbeSummary } from './schemas';

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export function summariseProbe(probe: ProbeResult): ProbeSummary {
  const { video, audio, phone } = probe;
  const device = [phone?.make, phone?.model].filter(Boolean).join(' ');
  return {
    file: basename(probe.path),
    container: probe.container.formatName,
    sizeBytes: probe.container.sizeBytes,
    duration: probe.duration,
    durationSeconds: probe.duration ? round(toSeconds(probe.duration), 3) : undefined,
    video: video && {
      codec: video.codec ?? 'unknown',
      profile: video.profile,
      width: video.displayWidth,
      height: video.displayHeight,
      rotation: video.rotation,
      frameRate: video.frameRate,
      fps: video.frameRate ? round(rationalToNumber(video.frameRate), 3) : undefined,
      variableFrameRate: video.vfrHint,
      hdr: [...video.hdrFormats],
      bitDepth: video.bitDepth,
    },
    audio: audio && {
      codec: audio.codec ?? 'unknown',
      channels: audio.channels,
      sampleRate: audio.sampleRate,
    },
    streamCount: probe.streams.length,
    creationTime: probe.creationTime,
    device: device || undefined,
  };
}

const HDR_NAMES = { hlg: 'HLG', pq: 'PQ', dolby_vision: 'Dolby Vision' } as const;

/**
 * One line for artifact summaries, e.g. '5.002 s, hevc 1080x1920 (rotated 90°), 30 fps VFR, HDR HLG'.
 * Built only from FFmpeg's own names and numbers: the file name and device tags are untrusted and
 * artifact summaries reach the model without the agent's untrusted-data wrapping.
 */
export function describeProbeSummary(summary: ProbeSummary): string {
  const parts: string[] = [];
  if (summary.durationSeconds !== undefined) parts.push(`${summary.durationSeconds} s`);
  const v = summary.video;
  if (v) {
    const rotated = v.rotation ? ` (rotated ${v.rotation}°)` : '';
    const fps = v.fps !== undefined ? `, ${v.fps} fps${v.variableFrameRate ? ' VFR' : ''}` : '';
    const hdr = v.hdr.length > 0 ? `, HDR ${v.hdr.map((h) => HDR_NAMES[h]).join(' + ')}` : ', SDR';
    parts.push(`${v.codec} ${v.width}x${v.height}${rotated}${fps}${hdr}`);
  }
  const a = summary.audio;
  if (a)
    parts.push(
      `${a.codec}${a.channels ? ` ${a.channels} ch` : ''}${a.sampleRate ? ` ${a.sampleRate} Hz` : ''}`,
    );
  return parts.join(', ') || 'no audio or video details';
}

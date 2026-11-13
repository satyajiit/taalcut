// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg runs that make one clip, as phones record:
 *
 * 1. encode: the clip's graph at the clip's bitrate, one-second GOPs, 48 kHz stereo AAC, into a work file. H.264
 *    is encoded with Apple's software encoder: footage that isn't testing hardware avoids the hardware
 *    H.264 encoder, which stalled and preceded two watchdog resets (brief-common
 *    "VideoToolbox stalls"). HEVC has no software encoder in the LGPL build, so it stays on hevc_videotoolbox
 *    (hvc1, as iPhones tag it) under the stall watch (stall.ts). ix-v1 as generated on 2026-10-17 still has
 *    VideoToolbox H.264; the spec, and so the set, is the same.
 * 2. finish: a stream copy into the final file with the phone's metadata: creation_time (and in a .mov the
 *    QuickTime make, model, creation date and location keys), the display rotation of a portrait clip (-90:
 *    stored landscape, shown upright), and faststart.
 *
 * Also the one-frame run that renders a pan or zoom still.
 */
import type { ClipPlan } from './plan';
import type { StillSpec } from './video/looks';

const QUIET = ['-hide_banner', '-v', 'error', '-y'];

/** Megabits as FFmpeg reads them ('40M'), for maxrate and bufsize. */
function scaled(bitrate: string, factor: number): string {
  const match = /^(\d+(?:\.\d+)?)M$/.exec(bitrate);
  if (!match) throw new Error(`bitrate '${bitrate}' is not <n>M`);
  return `${Math.round(Number(match[1]) * factor)}M`;
}

export function videoCodecArgs(plan: ClipPlan): string[] {
  const { codec, bitrate, fps } = plan.clip;
  const rate = ['-b:v', bitrate, '-maxrate', scaled(bitrate, 1.5), '-bufsize', scaled(bitrate, 2)];
  const gop = ['-g', String(fps), '-r', String(fps)];
  if (codec === 'hevc')
    return ['-c:v', 'hevc_videotoolbox', '-tag:v', 'hvc1', '-profile:v', 'main', ...rate, ...gop];
  return ['-c:v', 'h264_videotoolbox', '-require_sw', '1', '-profile:v', 'high', ...rate, ...gop];
}

export interface EncodeInput {
  readonly plan: ClipPlan;
  readonly videoInputs: readonly string[];
  readonly speech: string | null;
  readonly speechInput: number | null;
  readonly filter: string;
  readonly hasAudio: boolean;
  readonly out: string;
}

export function encodeArgs(input: EncodeInput): string[] {
  const audio = input.hasAudio
    ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']
    : ['-an'];
  return [
    ...QUIET,
    ...input.videoInputs,
    ...(input.speech === null ? [] : ['-i', input.speech]),
    '-filter_complex',
    input.filter,
    '-map',
    '[v]',
    ...videoCodecArgs(input.plan),
    ...audio,
    '-t',
    String(input.plan.clip.seconds),
    input.out,
  ];
}

/** Where each "phone" says it was: Mumbai, Madrid, São Paulo, San Francisco, by the clip's language. */
const PLACES: Readonly<Record<string, string>> = {
  hi: '+19.0760+072.8777/',
  es: '+40.4168-003.7038/',
  'pt-BR': '-23.5505-046.6333/',
  en: '+37.8080-122.4177/',
};

export function finishArgs(plan: ClipPlan, from: string, out: string): string[] {
  const { clip } = plan;
  const portrait = clip.height > clip.width;
  const place = PLACES[clip.speech?.language ?? 'en'] ?? '';
  // A .mov carries the iPhone's QuickTime keys (mdta, hence use_metadata_tags). An .mp4 carries only the movie's
  // creation time: with use_metadata_tags it would be written twice (the movie header and an mdta key), which
  // ffprobe joins into one 50-character value, and the app's normalise rejects it (ix-v1, 2026-10-17).
  const tags = clip.file.endsWith('.mov')
    ? [
        ...['-metadata', `creation_time=${clip.createdAt}`],
        ...['-metadata', 'com.apple.quicktime.make=Apple'],
        ...['-metadata', 'com.apple.quicktime.model=iPhone 16 Pro'],
        ...['-metadata', `com.apple.quicktime.creationdate=${clip.createdAt}`],
        ...['-metadata', `com.apple.quicktime.location.ISO6709=${place}`],
        ...['-movflags', '+faststart+use_metadata_tags'],
      ]
    : [
        ...['-map_metadata', '-1'],
        ...['-metadata', `creation_time=${clip.createdAt}`],
        ...['-movflags', '+faststart'],
      ];
  return [
    ...QUIET,
    ...(portrait ? ['-display_rotation:v:0', '-90'] : []),
    '-i',
    from,
    '-map',
    '0',
    '-c',
    'copy',
    ...tags,
    out,
  ];
}

export function stillArgs(still: StillSpec, out: string): string[] {
  return [...QUIET, '-f', 'lavfi', '-i', still.source, '-frames:v', '1', '-q:v', '3', out];
}

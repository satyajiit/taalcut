// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Maps validated ffprobe JSON to ProbeResult. Pure: no I/O, so it is tested
 * with recorded and hand-made ffprobe output.
 */
import { decimalToRationalTime, parseRational, ticksToRationalTime, type Rational } from '../rational';
import {
  bitDepthOf,
  dolbyVisionOf,
  frameRateOf,
  hdrFormatsOf,
  mirroredOf,
  rotationOf,
  vfrHintOf,
} from './map-video';
import type { PhoneBoxes } from './phone-boxes';
import type { FfprobeOutput, FfprobeStream } from './schema';
import type {
  AudioStreamInfo,
  ChapterInfo,
  OtherStreamInfo,
  PhoneMetadata,
  ProbeResult,
  StreamBase,
  StreamInfo,
  VideoStreamInfo,
} from './types';

/** `boxes`: what the file's `moov` says that ffprobe doesn't pass on, when it was read (probe.ts). */
export function mapProbeOutput(path: string, raw: FfprobeOutput, boxes?: PhoneBoxes): ProbeResult {
  const streams = raw.streams.map(mapStream);
  const formatTags = raw.format.tags ?? {};
  const phone = phoneMetadataOf(formatTags, boxes);
  const video = streams.find((s): s is VideoStreamInfo => s.kind === 'video' && !s.isAttachedPicture);
  const audio = streams.find((s): s is AudioStreamInfo => s.kind === 'audio');
  return {
    path,
    container: {
      formatName: raw.format.format_name,
      longName: raw.format.format_long_name,
      majorBrand: formatTags.major_brand,
      sizeBytes: count(raw.format.size),
      bitRate: count(raw.format.bit_rate),
    },
    duration: decimalToRationalTime(raw.format.duration),
    startTime: decimalToRationalTime(raw.format.start_time),
    streams,
    video,
    audio,
    chapters: raw.chapters.flatMap(mapChapter),
    creationTime: firstValue(
      phone?.creationDate ??
        formatTags.creation_time ??
        raw.streams.find((s) => s.tags?.creation_time)?.tags?.creation_time,
    ),
    phone,
    tags: formatTags,
  };
}

/**
 * ffprobe joins the values of a tag the file repeats with `;` (`2024-05-01T10:00:00Z;2024-05-01T10:00:00Z`):
 * the first one. None of the tags read this way (times, device names, ISO 6709, ids) has a `;` of its own.
 */
function firstValue(text: string | undefined): string | undefined {
  const first = text?.split(';')[0]?.trim();
  return first === '' ? undefined : first;
}

function count(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Stream time from ticks in its time base (exact), else from ffprobe's decimal seconds. */
function streamTime(ticks: number | undefined, timeBase: Rational | undefined, decimal: string | undefined) {
  if (ticks !== undefined && timeBase) return ticksToRationalTime(ticks, timeBase);
  return decimalToRationalTime(decimal);
}

function mapStream(stream: FfprobeStream): StreamInfo {
  const timeBase = parseRational(stream.time_base);
  const language = stream.tags?.language;
  const base: StreamBase = {
    index: stream.index,
    codec: stream.codec_name,
    codecLongName: stream.codec_long_name,
    timeBase,
    startTime: streamTime(stream.start_pts, timeBase, stream.start_time),
    duration: streamTime(stream.duration_ts, timeBase, stream.duration),
    bitRate: count(stream.bit_rate),
    language: language && language !== 'und' ? language : undefined,
    tags: stream.tags ?? {},
  };
  if (stream.codec_type === 'video') return mapVideo(stream, base);
  if (stream.codec_type === 'audio') {
    const audio: AudioStreamInfo = {
      ...base,
      kind: 'audio',
      profile: stream.profile,
      channels: stream.channels,
      channelLayout: stream.channel_layout,
      sampleRate: count(stream.sample_rate),
      sampleFormat: stream.sample_fmt,
    };
    return audio;
  }
  const other: OtherStreamInfo = { ...base, kind: otherKind(stream.codec_type) };
  return other;
}

function otherKind(type: string | undefined): OtherStreamInfo['kind'] {
  return type === 'subtitle' || type === 'data' || type === 'attachment' ? type : 'unknown';
}

function mapVideo(stream: FfprobeStream, base: StreamBase): VideoStreamInfo {
  const width = stream.width ?? 0;
  const height = stream.height ?? 0;
  const rotation = rotationOf(stream);
  const mirrored = mirroredOf(stream);
  const sideways = rotation === 90 || rotation === 270;
  const dolbyVision = dolbyVisionOf(stream);
  const hdrFormats = hdrFormatsOf(stream.color_transfer, dolbyVision);
  const frameRate = frameRateOf(stream.r_frame_rate);
  const averageFrameRate = frameRateOf(stream.avg_frame_rate);
  return {
    ...base,
    kind: 'video',
    profile: stream.profile,
    width,
    height,
    displayWidth: sideways ? height : width,
    displayHeight: sideways ? width : height,
    rotation,
    mirrored,
    pixelFormat: stream.pix_fmt,
    bitDepth: bitDepthOf(stream.pix_fmt, stream.bits_per_raw_sample),
    colour: {
      range: stream.color_range,
      space: stream.color_space,
      transfer: stream.color_transfer,
      primaries: stream.color_primaries,
    },
    isHdr: hdrFormats.length > 0,
    hdrFormats,
    dolbyVision,
    frameRate,
    averageFrameRate,
    vfrHint: vfrHintOf(frameRate, averageFrameRate),
    frameCount: count(stream.nb_frames),
    isAttachedPicture: stream.disposition?.attached_pic === 1,
  };
}

function mapChapter(chapter: FfprobeOutput['chapters'][number]): ChapterInfo[] {
  const timeBase = parseRational(chapter.time_base);
  const start = timeBase && ticksToRationalTime(chapter.start, timeBase);
  const end = timeBase && ticksToRationalTime(chapter.end, timeBase);
  if (!start || !end) return [];
  return [{ id: chapter.id, start, end, title: chapter.tags?.title }];
}

/** Apple (QuickTime mdta) keys first, then Android keys, then Samsung's. */
const PHONE_KEYS = {
  make: ['com.apple.quicktime.make', 'com.android.manufacturer'],
  model: ['com.apple.quicktime.model', 'com.android.model'],
  software: ['com.apple.quicktime.software', 'com.android.version'],
  creationDate: ['com.apple.quicktime.creationdate'],
  location: ['com.apple.quicktime.location.ISO6709', 'location'],
  livePhotoId: ['com.apple.quicktime.content.identifier'],
  utcOffset: ['com.samsung.android.utc_offset'],
} as const;

/** Keys Apple writes in the video track, not the movie (ffprobe doesn't pass them on). */
const VIDEO_TRACK_KEYS = {
  lens: 'com.apple.quicktime.camera.lens_model',
  captureMode: 'com.apple.photos.captureMode',
} as const;

const SAMSUNG_KEY = /^com\.samsung\./;

/**
 * The phone's metadata: ffprobe's format tags, then the boxes it doesn't read (phone-boxes.ts). Samsung's camera
 * writes no make key: its own `com.samsung.android.*` keys and `smta` atom name the maker, and its `auth` box the
 * phone ("Galaxy Example").
 */
export function phoneMetadataOf(
  tags: Readonly<Record<string, string>>,
  boxes?: PhoneBoxes,
): PhoneMetadata | undefined {
  const keys = { ...boxes?.movieKeys, ...tags };
  const found: Record<string, string | number> = {};
  for (const [field, names] of Object.entries(PHONE_KEYS)) {
    const value = names.map((key) => firstValue(keys[key])).find((v) => v !== undefined);
    if (value !== undefined) found[field] = value;
  }
  const captureFps = Number(keys['com.android.capture.fps']);
  if (captureFps > 0) found.captureFrameRate = captureFps;
  for (const [field, key] of Object.entries(VIDEO_TRACK_KEYS)) {
    const value = firstValue(boxes?.videoKeys[key]);
    if (value !== undefined) found[field] = value.slice(0, 64);
  }
  const focal = Number(boxes?.videoKeys['com.apple.quicktime.camera.focal_length.35mm_equivalent']);
  if (focal > 0) found.focalLength35mm = focal;
  const samsung = boxes?.samsungAtom === true || Object.keys(keys).some((key) => SAMSUNG_KEY.test(key));
  if (found.make === undefined && boxes?.make) found.make = boxes.make;
  if (found.model === undefined && boxes?.model) found.model = boxes.model;
  if (samsung) {
    found.make ??= 'Samsung';
    if (found.model === undefined && boxes?.author) found.model = boxes.author.slice(0, 64);
    if (boxes?.samsungModel) found.modelCode = boxes.samsungModel.slice(0, 32);
  }
  Object.assign(found, appOf(firstValue(keys.comment)));
  return Object.keys(found).length > 0 ? (found as PhoneMetadata) : undefined;
}

/** The Sample Cam app writes `app=Sample Cam&device=XC01&gid=…` in the comment: the app, and the device it names. */
function appOf(comment: string | undefined): Pick<PhoneMetadata, 'app' | 'appDevice'> {
  if (!comment || !/^app=[^&]+(&|$)/.test(comment)) return {};
  const params = new URLSearchParams(comment);
  const app = params.get('app')?.trim().slice(0, 40);
  const device = params.get('device')?.trim().slice(0, 40);
  return { ...(app ? { app } : {}), ...(app && device ? { appDevice: device } : {}) };
}

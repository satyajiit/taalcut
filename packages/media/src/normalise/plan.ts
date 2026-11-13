// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns one probe into the plan every later decode uses. Nothing is written:
 * an hour of 4K does not fit the minimum Mac's free space.
 */
import {
  err,
  FrameRate,
  ok,
  RationalTime,
  type FrameRate as Rate,
  type RationalTime as CoreTime,
  type Result,
} from '@taalcut/core';
import { planDecode } from '../backends';
import type { MediaFacts } from '@taalcut/core';
import { fileParams, UnsupportedMedia } from '../errors';
import type { ProbeResult, VideoStreamInfo } from '../probe/types';
import type { RationalTime as MediaTime } from '../rational-time';
import { fromMediaTime, mediaDelta, mediaSeconds } from '../time-bridge';
import { captureTimeOf } from './capture-time';
import { deviceOf } from './device';
import { orientationOf, parseIso6709 } from './location';
import { gridFor, type GridChoice } from './rates';
import { PLAN_RECIPE, type NormalisationPlan, type PlanOptions, type PlanSource, type PlanStill } from './types';

const RAW = /\b(dng|arw|cr2|cr3|nef|orf|rw2)\b|\braw\b/i;
const STILL_FORMAT = /\b(heic|heif|png|jpeg|jpg|image2|gif|webp|tiff|bmp)\b/i;
const ONE = FrameRate.of(1);

const EXIF: Record<number, { rotation: 0 | 90 | 180 | 270; mirrored: boolean }> = {
  1: { rotation: 0, mirrored: false },
  2: { rotation: 0, mirrored: true },
  3: { rotation: 180, mirrored: false },
  4: { rotation: 180, mirrored: true },
  5: { rotation: 90, mirrored: true },
  6: { rotation: 90, mirrored: false },
  7: { rotation: 270, mirrored: true },
  8: { rotation: 270, mirrored: false },
};

function blob(probe: ProbeResult): string {
  return [probe.container.formatName, probe.container.majorBrand, probe.path, probe.video?.codec].filter(Boolean).join(' ');
}

function isStill(probe: ProbeResult): boolean {
  const video = probe.video;
  if (video && video.frameCount !== undefined && video.frameCount < 2) return true;
  return STILL_FORMAT.test(blob(probe)) && (video?.frameCount ?? 1) < 2;
}

function stillFormat(probe: ProbeResult, still: PlanStill | undefined): string {
  if (still?.format) return still.format;
  const text = blob(probe).toLowerCase();
  if (text.includes('heic') || text.includes('heif')) return 'heic';
  if (text.includes('png')) return 'png';
  if (text.includes('jpeg') || text.includes('jpg') || text.includes('mjpeg') || text.includes('image2')) return 'jpeg';
  return probe.video?.codec ?? 'image';
}

function hdrOf(video: VideoStreamInfo | undefined): NormalisationPlan['hdr'] {
  const formats = video?.hdrFormats ?? [];
  if (formats.includes('dolby_vision')) return 'dolby-vision';
  if (formats.includes('hlg')) return 'hlg';
  if (formats.includes('pq')) return 'pq';
  return 'none';
}

function upright(width: number, height: number, rotation: 0 | 90 | 180 | 270): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

function zero(): CoreTime {
  return RationalTime.of(0, ONE);
}

function startOf(time: MediaTime | undefined): CoreTime {
  if (!time || time.rate <= 0) return zero();
  return fromMediaTime(time);
}

function audioBlock(probe: ProbeResult, videoStart: MediaTime | undefined): NormalisationPlan['audio'] {
  const audio = probe.audio;
  if (!audio) return undefined;
  const origin = videoStart ?? { value: 0, rate: 1 };
  const audioStart = audio.startTime ?? { value: 0, rate: 1 };
  return { offset: mediaDelta(audioStart, origin), trimToVideo: true };
}

function sourceOf(video: VideoStreamInfo | undefined, displayW: number, displayH: number, vfr: boolean): PlanSource {
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    displayWidth: displayW,
    displayHeight: displayH,
    bitDepth: video?.bitDepth,
    pixelFormat: video?.pixelFormat,
    codec: video?.codec,
    colour: video?.colour ?? {},
    hdrFormats: video?.hdrFormats ?? [],
    dolbyProfile: video?.dolbyVision?.profile,
    vfr,
  };
}

function factsOf(input: {
  displayW: number;
  displayH: number;
  kind: NormalisationPlan['kind'];
  duration: CoreTime;
  grid: GridChoice | undefined;
  vfr: boolean;
  hdr: NormalisationPlan['hdr'];
  hasAudio: boolean;
  probe: ProbeResult;
  still?: PlanStill;
  livePhoto?: MediaFacts['livePhoto'];
}): MediaFacts {
  const phone = input.probe.phone;
  const location =
    input.still?.latitude !== undefined && input.still.longitude !== undefined
      ? {
          latitude: input.still.latitude,
          longitude: input.still.longitude,
          ...(input.still.altitudeM !== undefined ? { altitudeM: input.still.altitudeM } : {}),
        }
      : parseIso6709(phone?.location);
  const capture = captureTimeOf({
    ...(input.still ? { still: input.still } : {}),
    ...(phone?.creationDate ? { creationDate: phone.creationDate } : {}),
    ...(phone?.utcOffset ? { utcOffset: phone.utcOffset } : {}),
    ...(input.probe.creationTime ? { creationTime: input.probe.creationTime } : {}),
  });
  const device = deviceOf(input.still, phone);
  const speed = input.grid?.speed ?? { kind: 'normal' as const, factor: 1, retimedInFile: false };
  return {
    version: 1,
    width: Math.max(1, input.displayW),
    height: Math.max(1, input.displayH),
    orientation: orientationOf(input.displayW, input.displayH),
    ...(input.kind === 'video' ? { duration: input.duration, frameRate: input.grid?.output } : {}),
    ...(input.grid?.captureRate ? { captureRate: input.grid.captureRate } : {}),
    variableFrameRate: input.vfr,
    hdr: input.kind === 'image' ? 'none' : input.hdr,
    speed: speed.kind,
    speedFactor: speed.factor,
    retimedInFile: speed.retimedInFile,
    hasAudio: input.hasAudio,
    ...codecFacts(input.kind, input.hasAudio, input.probe),
    ...(capture ? { captureTime: capture.captureTime } : {}),
    ...(capture?.captureOffsetMin !== undefined ? { captureOffsetMin: capture.captureOffsetMin } : {}),
    ...(location ? { location } : {}),
    ...(device ? { device } : {}),
    ...(phone?.captureMode ? { captureMode: phone.captureMode.slice(0, 40) } : {}),
    ...(input.livePhoto ? { livePhoto: input.livePhoto } : {}),
  };
}

/** The codecs and bit depth the clip page shows (UX2): short names as probed, cut to the facts' 32 characters. */
function codecFacts(
  kind: NormalisationPlan['kind'],
  hasAudio: boolean,
  probe: ProbeResult,
): Pick<MediaFacts, 'videoCodec' | 'audioCodec' | 'bitDepth'> {
  const video = kind === 'video' ? probe.video : undefined;
  const videoCodec = video?.codec?.slice(0, 32);
  const audioCodec = hasAudio ? probe.audio?.codec?.slice(0, 32) : undefined;
  const bitDepth = video?.bitDepth;
  return {
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    ...(bitDepth !== undefined && Number.isInteger(bitDepth) && bitDepth >= 1 && bitDepth <= 16 ? { bitDepth } : {}),
  };
}

function videoSeconds(probe: ProbeResult, video: VideoStreamInfo, average: { num: number; den: number }): number {
  const seconds = mediaSeconds(video.duration ?? probe.duration);
  if (seconds > 0) return seconds;
  if (video.frameCount && video.frameCount >= 2 && average.num > 0) return video.frameCount / (average.num / average.den);
  return 0;
}

export function planNormalisation(probe: ProbeResult, options: PlanOptions = {}): Result<NormalisationPlan> {
  if (RAW.test(blob(probe))) return err(UnsupportedMedia(fileParams(probe.path), { detail: 'RAW and DNG are not decoded' }));
  const video = probe.video;
  const audio = probe.audio;
  if (!video && !audio) return err(UnsupportedMedia(fileParams(probe.path), { detail: 'no decodable video or audio stream' }));

  const exif = options.still?.orientation !== undefined ? EXIF[options.still.orientation] : undefined;
  const rotation = exif?.rotation ?? video?.rotation ?? 0;
  const mirrored = exif?.mirrored ?? video?.mirrored ?? false;
  const kind: NormalisationPlan['kind'] = !video ? 'audio' : isStill(probe) ? 'image' : 'video';
  const display = upright(video?.width ?? 1, video?.height ?? 1, rotation);
  const hdr = hdrOf(video);
  const warnings: string[] = [];
  if (mirrored) warnings.push('mirrored');

  const rawAverage = video?.averageFrameRate ?? video?.frameRate ?? { num: 30, den: 1 };
  const average = rawAverage.num > 0 && rawAverage.den > 0 ? rawAverage : { num: 30, den: 1 };
  const grid = kind === 'video' ? gridFor(average, probe.phone?.captureFrameRate) : undefined;
  const output: Rate = grid?.output ?? ONE;
  const seconds = video && kind === 'video' ? videoSeconds(probe, video, average) : mediaSeconds(audio?.duration);
  const frames = kind === 'image' ? 1 : kind === 'audio' ? 0 : Math.max(1, Math.round(seconds * (output.num / output.den)));
  const duration =
    kind === 'image'
      ? RationalTime.of(0, ONE)
      : RationalTime.of(
          kind === 'audio' ? Math.round(seconds * 1_000_000) : frames,
          kind === 'audio' ? FrameRate.of(1_000_000) : output,
        );
  const start = startOf(video?.startTime ?? audio?.startTime);
  const audioAlign = kind === 'image' ? undefined : audioBlock(probe, video?.startTime);
  if (audio && video && mediaSeconds(audio.duration) - seconds > 1) warnings.push('audio_longer_than_video');

  const format = stillFormat(probe, options.still);
  const tiled = options.still?.tiled === true || (kind === 'image' && probe.streams.filter((s) => s.kind === 'video').length > 1);
  const writeStill = kind === 'image' && (/heic|heif/.test(format) || rotation !== 0 || mirrored);
  const decode = video
    ? planDecode(video, { platform: options.platform, decode: options.decode, still: kind === 'image' })
    : { backend: 'software' as const, fallbackReason: { code: 'codec_unsupported' as const, detail: 'no video stream' } };

  const plan: NormalisationPlan = {
    version: 1,
    recipe: PLAN_RECIPE,
    kind,
    decode,
    rotation,
    mirrored,
    hdr: kind === 'image' ? 'none' : hdr,
    toneMap: kind === 'video' && hdr !== 'none' ? 'required' : 'none',
    frameRate: { output, ...(grid?.native ? { native: grid.native } : {}) },
    start,
    duration,
    frames,
    ...(audioAlign ? { audio: audioAlign } : {}),
    speed: grid?.speed ?? { kind: 'normal', factor: 1, retimedInFile: false },
    ...(writeStill ? { still: { format, tiled } } : {}),
    source: sourceOf(video, display.width, display.height, video?.vfrHint ?? false),
    facts: factsOf({
      displayW: kind === 'audio' ? 1 : display.width,
      displayH: kind === 'audio' ? 1 : display.height,
      kind,
      duration,
      grid,
      vfr: video?.vfrHint ?? false,
      hdr,
      hasAudio: Boolean(audio),
      probe,
      still: options.still,
      livePhoto: options.livePhoto,
    }),
    warnings,
  };
  return ok(plan);
}

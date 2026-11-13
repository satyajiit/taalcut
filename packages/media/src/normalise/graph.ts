// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One filter chain for every decode: rotate, tone-map, crop, scale, CFR, audio align.
 * A hardware decode (its row in hw-video) stays on the device until the download; libplacebo runs after it
 * (VideoToolbox downloads 10-bit frames as p010le: a yuv420p download of them exits 234). No
 * `-filter_hw_device` for the tone-map: on a Mac that sends the VideoToolbox download at Vulkan.
 *
 * Zero copy: when the encoder takes the decoder's device frames (NVENC from CUDA) and no CPU filter has to run
 * (no tone-map, crop or mirror) and the frames are BT.709 limited-range 8-bit (keepsColourOnDevice), nothing downloads; the frame-rate conform (setpts, fps, trim) only retimes
 * frames, wherever they are. An encoder that takes device frames only (VA-API) gets its upload at the end.
 */
import { RationalTime, type FrameRate, type RationalTime as CoreTime } from '@taalcut/core';
import type { DecodePlan, ToneMapChoice } from '../backends';
import { fitWithin } from '../frames/frame-args';
import {
  encoderTakesDeviceFrames,
  hwDecodeArgs,
  hwDownloadFilters,
  hwScaleFilter,
  hwUprightFilters,
  keepsColourOnDevice,
  turnsOnDevice,
  TURN_DIRECTION,
} from '../hw-video/filters';
import { backendOfEncoder } from '../hw-video/table';
import { fileInput, stillPipeDemuxer, USER_MEDIA_INPUT } from '../input';
import { toneMapFilters } from '../tonemap';
import { cropFilter, uprightSource, type GraphCrop } from './crop';
import { ONE_THREAD_SCALES } from './one-thread';
import type { NormalisationPlan } from './types';

/** Clockwise, matching frame-args: 90 is `clock` after probe negates ffprobe's CCW angle (hw-video's TURN_DIRECTION). */
export const TRANSPOSE_VT = TURN_DIRECTION;

export interface GraphSize {
  readonly longSide?: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * With width and height: exactly that size, aspect and all, even past the source's (a model's input
   * grid). Without, a width and height are a box the picture fits inside, never upscaled.
   */
  readonly exact?: boolean;
}

export interface GraphRange {
  readonly start: CoreTime;
  readonly duration?: CoreTime;
}

export interface NormalisationGraphOptions {
  readonly route: DecodePlan;
  readonly toneMap: ToneMapChoice;
  readonly size?: GraphSize;
  readonly fps?: FrameRate;
  readonly range?: GraphRange;
  /**
   * A rectangle of the upright frame (checked by the caller, `checkCrop`); `size` then scales the
   * cropped picture. VideoToolbox frames are downloaded before the crop, so the scale runs on the CPU.
   */
  readonly crop?: GraphCrop | undefined;
  /**
   * Raw gray or RGB frames out (IX2-F15): where the frames reach the CPU at their size (VideoToolbox's scale), they
   * convert on one thread so they repeat (one-thread.ts). A graph that scales on the CPU keeps its threads.
   */
  readonly repeatable?: boolean;
  /**
   * The video encoder that takes this graph's frames. When it takes the decoder's device frames and no CPU filter
   * runs, the frames never download (`FilterGraph.deviceFrames`); an encoder that takes device frames only gets
   * its upload.
   */
  readonly encoder?: string;
}

export interface FilterGraph {
  readonly preInput: readonly string[];
  readonly seek?: string;
  readonly videoFilter?: string;
  readonly audioFilter?: string;
  /** `-fps_mode cfr`, `-shortest`, and `-t` for a range. Codecs stay with the caller. */
  readonly tail: readonly string[];
  /** The frames reach the encoder on its device: pass it to `videoEncodeFlags` (no `-pix_fmt`, no colour options). */
  readonly deviceFrames?: boolean;
}

function even(n: number): number {
  const v = Math.max(2, Math.floor(n));
  return v - (v % 2);
}

export interface GraphTarget {
  readonly width: number;
  readonly height: number;
}

/** The scaled size `size` asks for, or undefined when the upright picture already is that size. */
export function targetSize(
  plan: NormalisationPlan,
  size: GraphSize | undefined,
  crop: GraphCrop | undefined,
): GraphTarget | undefined {
  const { width: srcW, height: srcH } = uprightSource(plan, crop);
  if (!size) return undefined;
  if (size.width !== undefined && size.height !== undefined) {
    const width = even(size.exact ? size.width : Math.min(size.width, srcW));
    const height = even(size.exact ? size.height : Math.min(size.height, srcH));
    if (width === srcW && height === srcH) return undefined;
    return { width, height };
  }
  if (size.longSide === undefined || Math.max(srcW, srcH) <= size.longSide) return undefined;
  const fit = fitWithin(srcW, srcH, size.longSide);
  return { width: even(fit.width), height: even(fit.height) };
}

export function softwareRotate(rotation: NormalisationPlan['rotation']): string[] {
  if (rotation === 90) return ['transpose=1'];
  if (rotation === 270) return ['transpose=2'];
  if (rotation === 180) return ['hflip', 'vflip'];
  return [];
}

export function scaleFilter(width: number, height: number, exact = false): string {
  if (exact) return `scale=${width}:${height}:flags=bicubic`;
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=bicubic`;
}

/**
 * After a box scale that feeds a video encoder: drop an odd last row or column. VideoToolbox and OpenH264 drop it
 * themselves; NVENC keeps it (a 240×427 conform where the Mac writes 240×426), so every encoder gets the same size.
 */
export const EVEN_SIDES = 'crop=w=trunc(iw/2)*2:h=trunc(ih/2)*2:x=0:y=0';

type GpuRoute = Exclude<DecodePlan, { readonly backend: 'software' }>;

/**
 * Whether frames download as p010le: deeper than 8 bits (a yuv420p download of them fails, exit 234), or HDR of
 * unknown depth, which is nearly always 10-bit. A known 8-bit stream downloads in its own surface format, HDR or not
 * (LIB1-FIX): some phones record 8-bit HLG, its surface is nv12, and `hwdownload` can't convert, so p010le fails.
 */
export function downloadsDeep(plan: NormalisationPlan, hdr: boolean): boolean {
  const depth = plan.source.bitDepth;
  return depth === undefined ? hdr : depth > 8;
}

/**
 * A hardware decode: drop the display matrix, turn (and scale, when given) on the device, then download unless
 * the encoder takes the frames there. A device that can't turn or scale downloads first and turns on the CPU.
 */
function gpuFilters(
  plan: NormalisationPlan,
  route: GpuRoute,
  gpuScale: GraphTarget | undefined,
  hdr: boolean,
  stayOnDevice: boolean,
) {
  const onDevice = turnsOnDevice(route.backend);
  const filters = onDevice
    ? hwUprightFilters(route.backend, plan.rotation)
    : hwUprightFilters(route.backend, 0);
  const scale =
    gpuScale && onDevice ? hwScaleFilter(route.backend, gpuScale.width, gpuScale.height) : undefined;
  if (scale) filters.push(scale);
  if (stayOnDevice) return filters;
  filters.push(...hwDownloadFilters(route.backend, route.surfaceFormat, downloadsDeep(plan, hdr)));
  if (!onDevice) filters.push(...softwareRotate(plan.rotation));
  return filters;
}

const hardwareRoute = (plan: NormalisationPlan, route: DecodePlan): GpuRoute | undefined =>
  route.backend !== 'software' && plan.kind !== 'audio' ? route : undefined;

/**
 * Whether the frames stay on the device into the encoder: it takes them there, no CPU filter runs, and their colour
 * needs no conversion (keepsColourOnDevice).
 */
function staysOnDevice(plan: NormalisationPlan, options: NormalisationGraphOptions): boolean {
  const route = hardwareRoute(plan, options.route);
  if (!route || !options.encoder || !turnsOnDevice(route.backend)) return false;
  const hdr = plan.toneMap === 'required' && options.toneMap.method !== 'none';
  if (hdr || options.crop !== undefined || plan.mirrored) return false;
  if (!keepsColourOnDevice(plan.source.colour, route.surfaceFormat)) return false;
  return encoderTakesDeviceFrames(route.backend, options.encoder);
}

/** A still is turned upright (and un-mirrored) here; video on the CPU route is turned by FFmpeg. */
export function imageFilters(plan: NormalisationPlan): string[] {
  if (plan.kind !== 'image') return [];
  return [...softwareRotate(plan.rotation), ...(plan.mirrored ? ['hflip'] : [])];
}

export function hdrFilters(plan: NormalisationPlan, toneMap: ToneMapChoice): string[] {
  const profile = plan.source.dolbyProfile;
  return toneMapFilters(toneMap, {
    colour: plan.source.colour,
    dolbyVision: profile === undefined ? undefined : { profile },
  });
}

/** Hardware frames scale on the device unless they are tone-mapped or cropped after the download. */
function scalesOnCpu(plan: NormalisationPlan, options: NormalisationGraphOptions): boolean {
  const route = hardwareRoute(plan, options.route);
  const hdr = plan.toneMap === 'required' && options.toneMap.method !== 'none';
  return !route || !turnsOnDevice(route.backend) || hdr || options.crop !== undefined;
}

/** Upright, tone-mapped, cropped and scaled picture, before the frame-rate conform. */
function pictureFilters(plan: NormalisationPlan, options: NormalisationGraphOptions): string[] {
  const route = hardwareRoute(plan, options.route);
  const { crop } = options;
  const scaled = targetSize(plan, options.size, crop);
  const hdr = plan.toneMap === 'required' && options.toneMap.method !== 'none';
  const cpuScale = scalesOnCpu(plan, options);
  const device = staysOnDevice(plan, options);
  const filters = route
    ? gpuFilters(plan, route, cpuScale ? undefined : scaled, hdr, device)
    : imageFilters(plan);
  if (hdr) filters.push(...hdrFilters(plan, options.toneMap));
  // A hardware route's mirror flips after the scale (the small frame), or before a crop, which is in display orientation.
  const flip = route && plan.mirrored ? ['hflip'] : [];
  if (crop) filters.push(...flip, cropFilter(crop));
  if (scaled && cpuScale) {
    filters.push(scaleFilter(scaled.width, scaled.height, options.size?.exact));
    if (!options.size?.exact && options.encoder !== undefined) filters.push(EVEN_SIDES);
  }
  if (!crop) filters.push(...flip);
  return filters;
}

/**
 * Where a range starts: the seek (half a grid frame early, so the frame on its start survives the
 * decoder's accurate seek whatever the container's rounding; that frame then becomes 0 through
 * `setpts`) and that lead, which the audio drops too.
 */
export function rangeSeek(
  plan: NormalisationPlan,
  range: GraphRange | undefined,
): { readonly seek?: string; readonly lead: number } {
  const start = range ? RationalTime.toSeconds(range.start) : 0;
  const grid = plan.frameRate.output;
  const lead = plan.kind === 'video' && start > 0 ? Math.min(start, (0.5 * grid.den) / grid.num) : 0;
  return { ...(range ? { seek: Math.max(0, start - lead).toFixed(6) } : {}), lead };
}

/**
 * The frame-rate conform of a video: a fresh timeline on `rate` (the grid by default) and, for a range,
 * its end as a frame count on that grid, not `-t`, whose six decimals let one frame too many through.
 */
export function conformFilters(plan: NormalisationPlan, rate: FrameRate, range?: GraphRange): string[] {
  if (plan.kind !== 'video') return [];
  const filters = [`setpts=PTS-STARTPTS,fps=fps=${rate.num}/${rate.den}:round=near`];
  if (range?.duration) {
    const frames = Math.max(1, Math.round((RationalTime.toSeconds(range.duration) * rate.num) / rate.den));
    filters.push(`trim=end_frame=${frames}`);
  }
  return filters;
}

export function normalisationGraph(plan: NormalisationPlan, options: NormalisationGraphOptions): FilterGraph {
  const route = hardwareRoute(plan, options.route);
  const filters = pictureFilters(plan, options);
  const { seek, lead } = rangeSeek(plan, options.range);
  filters.push(...conformFilters(plan, options.fps ?? plan.frameRate.output, options.range));
  const deviceFrames = staysOnDevice(plan, options);
  // An encoder that takes device frames only (VA-API) gets the CPU's frames uploaded to it.
  const upload = deviceFrames
    ? undefined
    : options.encoder && backendOfEncoder(options.encoder)?.encode?.upload;
  if (upload && plan.kind === 'video') filters.push(...upload.filters);

  let audioFilter: string | undefined;
  if (plan.audio && plan.kind !== 'image') {
    const offset = RationalTime.toSeconds(plan.audio.offset);
    const end = options.range?.duration
      ? RationalTime.toSeconds(options.range.duration)
      : RationalTime.toSeconds(plan.duration);
    const parts: string[] = [];
    if (lead > 0) parts.push(`atrim=start=${lead.toFixed(6)}`, 'asetpts=PTS-STARTPTS');
    if (offset > 0.0005) parts.push(`adelay=${Math.round(offset * 1000)}:all=1`);
    if (offset < -0.0005) parts.push(`atrim=start=${(-offset).toFixed(6)}`);
    // End trim is on the reset timeline. Before asetpts, a start trim makes the
    // clip shorter than the video and -shortest drops the last frame.
    parts.push('asetpts=PTS-STARTPTS', `atrim=end=${Math.max(0, end).toFixed(6)}`);
    audioFilter = parts.join(',');
  }

  const tail: string[] = [];
  if (plan.kind === 'video') tail.push('-fps_mode', 'cfr');
  if (plan.audio && plan.kind === 'video') tail.push('-shortest');
  if (options.range?.duration && plan.kind !== 'video')
    tail.push('-t', RationalTime.toSeconds(options.range.duration).toFixed(6));

  const preInput: string[] = [];
  if (upload && plan.kind === 'video') preInput.push(...upload.inputArgs);
  if (route) preInput.push(...hwDecodeArgs(route.backend));
  else if (plan.kind === 'image' && (plan.rotation !== 0 || plan.mirrored)) preInput.push('-noautorotate');

  const oneThread = options.repeatable && !scalesOnCpu(plan, options) ? ONE_THREAD_SCALES : '';
  return {
    preInput,
    ...(seek !== undefined ? { seek } : {}),
    ...(filters.length > 0 ? { videoFilter: `${oneThread}${filters.join(',')}` } : {}),
    ...(audioFilter ? { audioFilter } : {}),
    tail,
    ...(deviceFrames ? { deviceFrames: true } : {}),
  };
}

/**
 * ffmpeg arguments for `graph` between the prelude and the caller's codec flags.
 * `videoOnly` is for JPEG, raw frames and analysis: image2 has no audio encoder.
 * The input is confined like probe's: local files, the user-media demuxers
 * only, and a still forced onto its pipe demuxer (FFmpeg would pick image2
 * from a `.jpg` name, which the allowlist leaves out because it reads sequences).
 */
export function graphInputArgs(
  path: string,
  plan: NormalisationPlan,
  graph: FilterGraph,
  videoOnly = false,
): string[] {
  const args = [...graph.preInput];
  if (graph.seek) args.push('-ss', graph.seek);
  const still = stillPipeDemuxer(path);
  args.push(...USER_MEDIA_INPUT, ...(still ? ['-f', still] : []), '-i', fileInput(path));
  if (plan.kind !== 'audio') args.push('-map', '0:V:0');
  const withAudio = !videoOnly && Boolean(plan.audio) && plan.kind !== 'image';
  if (withAudio) args.push('-map', '0:a:0');
  else args.push('-an');
  if (graph.videoFilter) args.push('-vf', graph.videoFilter);
  if (withAudio && graph.audioFilter) args.push('-af', graph.audioFilter);
  args.push(...(videoOnly ? graph.tail.filter((token) => token !== '-shortest') : graph.tail));
  return args;
}

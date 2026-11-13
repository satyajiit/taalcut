// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg arguments of one conformed segment (SPEC section 4, `conforming`): fit, upright, the
 * frame-rate conform, speed and the held tail frame, encoded with the route's encoder (the machine's hardware
 * encoder, or OpenH264 on the software retry's route, IX3-K4), and the sound as 48 kHz PCM next to it.
 *
 * The graph comes from the decode's hw-video row through media's builders (VideoToolbox: `transpose_vt`,
 * `scale_vt`; NVDEC: `transpose_cuda`, `scale_cuda`); no backend is named here. Where nothing in the graph needs
 * the CPU (no tone-map, no mirror, no crop or pad, 8-bit BT.709 limited-range frames: nothing to convert) and the
 * encoder takes the row's device frames (NVENC), the frames never leave the GPU: zero copy. Otherwise they download
 * after the scale.
 *
 * Upright exactly once, on every route (media SPEC "Rotation"): FFmpeg's autorotate is off, the
 * rotation from the probe is applied here (the row's transpose on the GPU, `transpose` on the CPU), the
 * display matrix is deleted so no player turns the segment again, and a mirrored matrix (some front
 * cameras) adds `hflip` on the downloaded, already scaled frame, as media's normalisation graph does.
 */
import type { FrameRate, RationalTime } from '@taalcut/core';
import {
  DROP_DISPLAY_MATRIX,
  encoderTakesDeviceFrames,
  hwDecodeArgs,
  hwDownloadFilters,
  hwScaleFilter,
  hwUprightFilters,
  keepsColourOnDevice,
  turnsOnDevice,
  videoEncodeFlags,
  type VideoStreamInfo,
} from '@taalcut/media';
import { sourceFramesAt, tempoPieces, visualCurve } from '../plan/speed-curve';
import { speedFilter, tempoFragment } from '../plan/speed-filters';
import type { PlannedVisual } from '../plan/types';
import type { RouteDecode, VideoRoute } from './video-route';

/**
 * A reframed segment's geometry (P3-V2): the upright source scaled to `scaled` (so the crop window maps onto
 * the canvas), then cut to `crop`, the crop path's extent, in that scaled frame. A blurred pad keeps the whole
 * frame (`crop` null). Even sizes; the composition pans inside it.
 */
export interface SegmentGeometry {
  readonly scaled: { readonly width: number; readonly height: number };
  readonly crop: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

/** The output a segment is conformed to. */
export interface SegmentCanvas {
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  /** P3-V2: reframed (absent: the visual's fit on the canvas). */
  readonly geometry?: SegmentGeometry;
}

/** The part of the graph after upright and scale: the canvas fit, or a reframe's extent crop; none when it is a no-op. */
function placeOf(
  visual: PlannedVisual,
  options: SegmentCanvas,
  size: { readonly width: number; readonly height: number },
): string[] {
  const geometry = options.geometry;
  if (!geometry) {
    if (size.width === options.width && size.height === options.height) return [];
    return [placeFilter(visual.fit, options.width, options.height)];
  }
  const crop = geometry.crop;
  return crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`] : [];
}

/** Frames held past a segment's end (see segmentArgs). */
export const TAIL_FRAMES = 1;
/** Mezzanine bitrate: segments are decoded once more by the producer, so they stay near-lossless. */
export const SEGMENT_BPS = 40_000_000;

/** Clockwise, as the probe reports it: an iPhone portrait clip is 90, `clock`. */
const TRANSPOSE_CPU = { 0: [], 90: ['transpose=1'], 180: ['hflip', 'vflip'], 270: ['transpose=2'] } as const;

export const decimal = (time: RationalTime) => {
  const micros = Math.round((time.value * time.rate.den * 1_000_000) / time.rate.num);
  return `${Math.floor(micros / 1_000_000)}.${String(micros % 1_000_000).padStart(6, '0')}`;
};

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** The scaled size before crop (cover) or pad (contain) to the canvas. */
export function fitSize(
  display: { readonly width: number; readonly height: number },
  canvas: { readonly width: number; readonly height: number },
  fit: 'cover' | 'contain',
): { readonly width: number; readonly height: number } {
  const sx = canvas.width / display.width;
  const sy = canvas.height / display.height;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = even(display.width * scale);
  const height = even(display.height * scale);
  return fit === 'cover'
    ? { width: Math.max(width, canvas.width), height: Math.max(height, canvas.height) }
    : { width: Math.min(width, canvas.width), height: Math.min(height, canvas.height) };
}

export function placeFilter(fit: 'cover' | 'contain', width: number, height: number): string {
  return fit === 'cover'
    ? `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`
    : `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

/** Input flags: autorotate off on every route (the graph rotates), plus the row's device frames on a hardware decode. */
export function decodeArgs(decode: RouteDecode): string[] {
  return decode.backend === 'software' ? ['-noautorotate'] : hwDecodeArgs(decode.backend);
}

type Upright = Pick<VideoStreamInfo, 'rotation' | 'mirrored' | 'bitDepth'>;
type Colour = Pick<VideoStreamInfo, 'colour'>;

/**
 * Upright and scaled to `size`: the part of the graph before crop or pad. On a row that turns and scales on its
 * device, both run there, then the frames download in the plan's surface format (10-bit frames as the row
 * downloads them deep), unless `onDevice` keeps them there for an encoder that takes them. Otherwise the frames
 * download first and turn and scale on the CPU.
 */
export function uprightFilters(
  video: Upright,
  decode: RouteDecode,
  size: { readonly width: number; readonly height: number },
  options: { readonly onDevice?: boolean } = {},
): string[] {
  const mirror = video.mirrored ? ['hflip'] : [];
  const cpu = [
    ...TRANSPOSE_CPU[video.rotation],
    `scale=${size.width}:${size.height}:flags=bicubic`,
    ...mirror,
  ];
  if (decode.backend === 'software') return [DROP_DISPLAY_MATRIX, ...cpu];
  const deep = (video.bitDepth ?? 8) > 8;
  const download = hwDownloadFilters(decode.backend, decode.surfaceFormat, deep);
  if (!turnsOnDevice(decode.backend)) return [DROP_DISPLAY_MATRIX, ...download, ...cpu];
  const scale = hwScaleFilter(decode.backend, size.width, size.height);
  return [
    ...hwUprightFilters(decode.backend, video.rotation),
    ...(scale ? [scale] : []),
    ...(options.onDevice ? [] : [...download, ...mirror]),
  ];
}

/**
 * Whether the whole graph stays on the device and the encoder takes its frames (zero copy): a row that turns and
 * scales there, an encoder of that row that takes device frames, 8-bit 4:2:0 BT.709 limited-range frames (media's
 * keepsColourOnDevice: any other source is converted by the CPU format step), and nothing
 * the CPU must do (no tone-map, no mirror, no crop or pad: NVENC ignores a crop left on CUDA frames, measured).
 */
export function staysOnDevice(
  route: VideoRoute,
  video: Upright & Colour,
  toneMap: readonly string[],
  place: readonly string[],
): boolean {
  const { decode } = route;
  return (
    decode.backend !== 'software' &&
    // The segment's colour (BT.709 limited range, 8-bit 4:2:0) already: nothing for the CPU to convert.
    keepsColourOnDevice(video.colour, decode.surfaceFormat) &&
    turnsOnDevice(decode.backend) &&
    encoderTakesDeviceFrames(decode.backend, route.encoder) &&
    toneMap.length === 0 &&
    !video.mirrored &&
    place.length === 0
  );
}

/** One segment run on a route; `video` is the probe's stream. */
export function segmentArgs(
  visual: PlannedVisual,
  source: string,
  video: VideoStreamInfo,
  route: VideoRoute,
  toneMap: readonly string[],
  hasAudio: boolean,
  out: { readonly video: string; readonly audio: string },
  options: SegmentCanvas,
): string[] {
  const frames = visual.visible.end - visual.visible.start;
  const fps = options.rate.num / options.rate.den;
  const seconds = frames / fps;
  // The exact curve, ramp or not (speed-curve.ts): the mean speed is only preview's.
  const curve = visualCurve(visual, options.rate);
  // Read a little past the end so the fps conform never runs dry; -frames:v cuts exactly.
  const sourceSeconds = (sourceFramesAt(curve, frames + TAIL_FRAMES) / fps + 1).toFixed(6);
  const rotateSideways =
    !options.geometry &&
    visual.fit === 'contain' &&
    options.width < options.height &&
    video.displayWidth > video.displayHeight;
  const effectiveVideo: VideoStreamInfo = rotateSideways
    ? {
        ...video,
        rotation: ((video.rotation + 90) % 360) as VideoStreamInfo['rotation'],
        displayWidth: video.displayHeight,
        displayHeight: video.displayWidth,
      }
    : video;
  const effectiveVisual: PlannedVisual = rotateSideways ? { ...visual, fit: 'cover' } : visual;
  const size =
    options.geometry?.scaled ??
    fitSize(
      { width: effectiveVideo.displayWidth, height: effectiveVideo.displayHeight },
      options,
      effectiveVisual.fit,
    );
  const speed = speedFilter(curve, frames + TAIL_FRAMES, options.rate);
  const rate = `${options.rate.num}/${options.rate.den}`;
  const place = placeOf(effectiveVisual, options, size);
  const onDevice = staysOnDevice(route, effectiveVideo, toneMap, place);
  // One held frame past the end: compositions read segments half a frame in
  // (data-media-start), and the producer caps extraction at the file's length
  // minus that offset, which without the tail would lose the clip's last frame.
  const hold = `tpad=stop_mode=clone:stop=${visual.holdFrame ? frames + TAIL_FRAMES - 1 : TAIL_FRAMES}`;
  const chain = [
    ...uprightFilters(effectiveVideo, route.decode, size, { onDevice }),
    ...toneMap,
    ...place,
    'setsar=1',
    ...(visual.holdFrame ? ['trim=end_frame=1', 'setpts=PTS-STARTPTS'] : [speed]),
    `fps=${rate}:round=near`,
    hold,
    // Device frames carry their own format into the encoder; a CPU format filter would pull them down.
    ...(onDevice ? [] : ['format=yuv420p']),
  ].join(',');
  const tempo = curve.ramp ? [tempoFragment(tempoPieces(curve, frames, options.rate, 48_000), 'a')] : [];
  const gop = Math.round(options.rate.num / options.rate.den);
  return [
    ...decodeArgs(route.decode),
    '-ss',
    decimal(visual.sourceIn),
    '-t',
    sourceSeconds,
    '-i',
    source,
    '-map',
    '0:v:0',
    '-vf',
    chain,
    '-frames:v',
    String(frames + TAIL_FRAMES),
    // The encoder's row's flags (media): no software escape on a hardware encoder, so a refused session fails
    // into the logged OpenH264 retry (IX3-F5, M5); closed GOP, no B-frames, BT.709.
    ...videoEncodeFlags(route.encoder, SEGMENT_BPS, gop, {
      purpose: 'conform',
      ...(onDevice ? { deviceFrames: true } : {}),
    }),
    '-an',
    out.video,
    ...(hasAudio && !visual.holdFrame
      ? [
          '-map',
          '0:a:0',
          '-af',
          ['asetpts=PTS-STARTPTS', 'aresample=48000', ...tempo].join(','),
          '-ac',
          '2',
          '-c:a',
          'pcm_s16le',
          '-t',
          seconds.toFixed(6),
          out.audio,
        ]
      : []),
  ];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Filter-graph builders over a row: what media's normalise graph, frame reads and decode routes use, and what
 * render's conform, finish, grade and QA pass take instead of naming `scale_vt` or `transpose_cuda` themselves.
 */
import type { ColourInfo } from '../probe/types';
import { hwVideoBackend } from './table';
import type { HardwareBackend, HwDecode } from './types';

/** The display matrix travels on hardware frames; a graph that turns the picture itself drops it first. */
export const DROP_DISPLAY_MATRIX = 'sidedata=mode=delete:type=DISPLAYMATRIX';

/** Clockwise degrees (probe negates ffprobe's counter-clockwise angle) to a transpose direction. */
export const TURN_DIRECTION = { 0: undefined, 90: 'clock', 180: 'reversal', 270: 'cclock' } as const;

export type Rotation = keyof typeof TURN_DIRECTION;

/** The row's decoder; a row without one (an encoder-only slot) is a bug in the caller. */
export function hwDecoder(backend: HardwareBackend): HwDecode {
  const decode = hwVideoBackend(backend).decode;
  if (!decode) throw new Error(`media: the ${backend} row has no decoder`);
  return decode;
}

/** Input options that decode on the device and keep the frames there (FFmpeg's autorotate can't reach them). */
export function hwDecodeArgs(backend: HardwareBackend): string[] {
  const decode = hwDecoder(backend);
  return ['-noautorotate', '-hwaccel', decode.hwaccel, '-hwaccel_output_format', decode.outputFormat];
}

/** Whether the device turns and scales (else both run on the CPU after the download). */
export function turnsOnDevice(backend: HardwareBackend): boolean {
  const decode = hwDecoder(backend);
  return decode.transpose !== undefined && decode.scale !== undefined;
}

/** The display matrix dropped and the picture turned upright on the device (nothing to turn: just the drop). */
export function hwUprightFilters(backend: HardwareBackend, rotation: Rotation): string[] {
  const { transpose } = hwDecoder(backend);
  const dir = TURN_DIRECTION[rotation];
  return [DROP_DISPLAY_MATRIX, ...(dir && transpose ? [`${transpose}=dir=${dir}`] : [])];
}

/** A scale to `width`×`height` on the device, or undefined where it scales on the CPU. */
export function hwScaleFilter(backend: HardwareBackend, width: number, height: number): string | undefined {
  return hwDecoder(backend).scale?.(width, height);
}

/** Frames down to the CPU: `surface` from the plan; `deep` for 10-bit or HDR frames a CPU filter reads. */
export function hwDownloadFilters(backend: HardwareBackend, surface: string, deep = false): string[] {
  return ['hwdownload', `format=${hwDecoder(backend).downloadFormat(surface, deep)}`];
}

/** Whether `encoder` takes `backend`'s decoded frames straight from the device (zero copy). */
export function encoderTakesDeviceFrames(backend: HardwareBackend, encoder: string): boolean {
  const encode = hwVideoBackend(backend).encode;
  return encode?.takesDeviceFrames === true && Object.values(encode.encoders).includes(encoder);
}

/**
 * Whether decoded frames can go to an encoder on the device with their colour as it is: 8-bit 4:2:0 (`nv12`) with a
 * BT.709 matrix in limited range, which is what every SDR output is tagged. Any other source (untagged, BT.601, full
 * range, 10-bit) goes through the CPU format step, which converts it, as every source does on a Mac. On the device
 * nothing converts and the BT.709 tags would misname the codes (measured: an untagged BT.601 source came out of
 * NVENC 15 codes off in green).
 */
export function keepsColourOnDevice(colour: ColourInfo, surfaceFormat: string): boolean {
  return colour.space === 'bt709' && (colour.range ?? 'tv') === 'tv' && surfaceFormat === 'nv12';
}

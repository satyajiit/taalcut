// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The CPU half of a frame set read through the decode service (IX2-G3): the service writes each set's frames
 * as packed NV12, upright and scaled as FFmpeg's VideoToolbox route scales them (`scale_vt`), and one CPU-only
 * FFmpeg turns them into the set's format exactly as that route turns its downloaded frames: the same
 * NV12 bytes, tagged with the colour the decoder gives them (range, matrix, primaries, transfer), through
 * the same output conversion (`frameFileArgs`). It decodes no video, so it needs no hardware session.
 *
 * Each output converts on one thread. FFmpeg 9.0.2's sliced conversion of matrix-tagged NV12 (to gray or RGB)
 * isn't repeatable at some sizes and thread counts (256×144 on 18 cores gave a different frame every run); on
 * one thread it repeats, and gives the bytes the threaded conversion gives whenever that repeats.
 */
import { fileInput } from '../input';
import type { NormalisationPlan } from '../normalise/types';
import { frameFileArgs } from './frame-set-request';
import type { FrameFileFormat } from './frame-files';

export interface Nv12File {
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

export interface Nv12Conversion {
  readonly input: Nv12File;
  readonly format: FrameFileFormat;
  readonly jpegQuality?: number;
  readonly output: string;
}

/** Values FFmpeg takes for a colour option: its own names, never `unknown` or one with spaces or quotes. */
const COLOUR_NAME = /^[a-z0-9][a-z0-9_-]*$/;

function tag(flag: string, value: string | undefined): string[] {
  return value && value !== 'unknown' && value !== 'unspecified' && COLOUR_NAME.test(value)
    ? [flag, value]
    : [];
}

/** The colour tags FFmpeg's decoder puts on the frames it downloads (the plan's probe of the stream). */
export function colourTags(plan: NormalisationPlan, range: 'full' | 'video'): string[] {
  const { space, primaries, transfer } = plan.source.colour;
  return [
    ...['-color_range', range === 'full' ? 'pc' : 'tv'],
    ...tag('-colorspace', space),
    ...tag('-color_primaries', primaries),
    ...tag('-color_trc', transfer),
  ];
}

/** One FFmpeg run for every set: each NV12 file an input, each converted to its own output. */
export function nv12ConvertArgs(conversions: readonly Nv12Conversion[], colour: readonly string[]): string[] {
  const inputs = conversions.flatMap(({ input }) => [
    ...['-protocol_whitelist', 'file', '-f', 'rawvideo', '-pixel_format', 'nv12'],
    ...['-video_size', `${input.width}x${input.height}`, '-framerate', '1', ...colour],
    ...['-i', fileInput(input.path)],
  ]);
  const outputs = conversions.flatMap((conversion, i) => [
    ...['-map', `${i}:v:0`, '-fps_mode', 'passthrough', '-filter_threads', '1'],
    ...frameFileArgs(conversion.format, conversion.jpegQuality),
    conversion.output,
  ]);
  return ['-y', ...inputs, ...outputs];
}

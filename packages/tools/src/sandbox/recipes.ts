// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recipes: the plan's "analysis scripts" as named, typed argument builders.
 * The agent passes parameters, never code or argv; each recipe builds one
 * request that still goes through the same validation as any other run.
 * `cropDetect` from the SPEC stays out on purpose: our LGPL FFmpeg has no `cropdetect`, and a new recipe
 * changes this tool's schema and description, which the gate-demo cassette
 * (apps/gate-demo/fixtures/gate-demo.cassette.json) matches by a hash of the whole request body, so it would
 * miss until re-recorded with real keys. The breakdown finds a screen recording's reel itself (desktop's
 * crop-detect.ts).
 */
import type { SandboxRunRequest } from '@taalcut/core';
import { z } from 'zod';

export const SANDBOX_RECIPES = ['frames', 'sceneScores', 'signalStats', 'loudness', 'ocr', 'probe'] as const;
export type SandboxRecipe = (typeof SANDBOX_RECIPES)[number];

/** A media argument: a file in the experiment or a granted input. */
const media = z
  .string()
  .regex(/^(?:scratch:[^\0]{1,512}|input:(?:\d|1[0-5]))$/)
  .describe("'scratch:<relative path>' or 'input:<n>' (n indexes the call's inputs)");
const seconds = z.number().min(0).max(3600);
const folder = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}(?:\/[A-Za-z0-9_-]{1,40}){0,3}$/)
  .describe('A folder in the experiment, created if missing');
const range = { start: seconds.optional(), duration: seconds.optional() };

export const recipeParamsSchemas = {
  frames: z
    .object({
      input: media,
      /** Exact times (seconds): one image each. */
      times: z.array(seconds).min(1).max(32).optional(),
      /** Or a steady sample rate over the range. */
      fps: z.number().positive().max(10).optional(),
      ...range,
      maxDimension: z.int().min(16).max(1280).default(512),
      format: z.enum(['jpeg', 'png']).default('jpeg'),
      outDir: folder.default('frames'),
    })
    .refine((params) => (params.times === undefined) !== (params.fps === undefined), {
      message: 'Give either times or fps',
    }),
  sceneScores: z.object({
    input: media,
    threshold: z.number().min(0).max(100).default(5),
    maxDimension: z.int().min(16).max(1280).default(256),
    ...range,
  }),
  signalStats: z.object({
    input: media,
    fps: z.number().positive().max(30).default(4),
    keys: z
      .array(z.enum(['YAVG', 'YMIN', 'YMAX', 'SATAVG', 'HUEAVG']))
      .min(1)
      .max(5)
      .default(['YAVG']),
    ...range,
  }),
  loudness: z.object({ input: media, ...range }),
  ocr: z.object({
    input: z.string().regex(/^scratch:[^\0]{1,512}$/),
    languages: z
      .array(z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/))
      .min(1)
      .max(8)
      .optional(),
    fast: z.boolean().default(false),
  }),
  probe: z.object({ input: media }),
} satisfies Record<SandboxRecipe, z.ZodType>;

export type RecipeParams<R extends SandboxRecipe> = z.output<(typeof recipeParamsSchemas)[R]>;

export const sandboxRecipeSchema = z.discriminatedUnion('recipe', [
  z.object({ recipe: z.literal('frames'), params: recipeParamsSchemas.frames }),
  z.object({ recipe: z.literal('sceneScores'), params: recipeParamsSchemas.sceneScores }),
  z.object({ recipe: z.literal('signalStats'), params: recipeParamsSchemas.signalStats }),
  z.object({ recipe: z.literal('loudness'), params: recipeParamsSchemas.loudness }),
  z.object({ recipe: z.literal('ocr'), params: recipeParamsSchemas.ocr }),
  z.object({ recipe: z.literal('probe'), params: recipeParamsSchemas.probe }),
]);
export type SandboxRecipeCall = z.output<typeof sandboxRecipeSchema>;

const seek = (params: { start?: number; duration?: number }) => [
  ...(params.start !== undefined ? ['-ss', String(params.start)] : []),
  ...(params.duration !== undefined ? ['-t', String(params.duration)] : []),
];
const decode = (input: string, params: { start?: number; duration?: number }) => [
  '-hwaccel',
  'videotoolbox',
  ...seek(params),
  '-i',
  input,
];
const box = (size: number) => `scale=${size}:${size}:force_original_aspect_ratio=decrease`;

function frames(params: RecipeParams<'frames'>): string[] {
  const extension = params.format === 'jpeg' ? 'jpg' : 'png';
  const codec = params.format === 'jpeg' ? ['-c:v', 'mjpeg', '-q:v', '3'] : ['-c:v', 'png'];
  if (params.times) {
    const outputs = params.times.flatMap((time, i) => [
      '-map',
      '0:v:0',
      '-ss',
      String(time),
      '-frames:v',
      '1',
      '-vf',
      box(params.maxDimension),
      ...codec,
      '-update',
      '1',
      '-f',
      'image2',
      `scratch:${params.outDir}/t${String(i).padStart(2, '0')}.${extension}`,
    ]);
    return ['-y', '-hwaccel', 'videotoolbox', '-i', params.input, ...outputs];
  }
  return [
    '-y',
    ...decode(params.input, params),
    '-an',
    '-vf',
    `fps=${params.fps},${box(params.maxDimension)}`,
    ...codec,
    '-f',
    'image2',
    `scratch:${params.outDir}/frame_%04d.${extension}`,
  ];
}

/** Builds the request for a recipe; params are validated by its schema first. */
export function recipeRequest(call: SandboxRecipeCall): SandboxRunRequest {
  switch (call.recipe) {
    case 'frames':
      return { program: 'ffmpeg', args: frames(call.params) };
    case 'sceneScores': {
      const { params } = call;
      const graph =
        `scale=${params.maxDimension}:-2,scdet=threshold=${params.threshold}:sc_pass=0,` +
        'metadata=mode=select:key=lavfi.scd.time,metadata=mode=print:file=-';
      return {
        program: 'ffmpeg',
        args: [...decode(params.input, params), '-an', '-vf', graph, '-f', 'null', '-'],
      };
    }
    case 'signalStats': {
      const { params } = call;
      const prints = params.keys.map((key) => `metadata=mode=print:key=lavfi.signalstats.${key}:file=-`);
      const graph = [`fps=${params.fps}`, 'signalstats', ...prints].join(',');
      return {
        program: 'ffmpeg',
        args: [...decode(params.input, params), '-an', '-vf', graph, '-f', 'null', '-'],
      };
    }
    case 'loudness':
      return {
        program: 'ffmpeg',
        args: [
          ...seek(call.params),
          '-i',
          call.params.input,
          '-vn',
          '-af',
          'ebur128=framelog=verbose',
          '-f',
          'null',
          '-',
        ],
      };
    case 'ocr': {
      const { params } = call;
      const languages = params.languages ? ['--languages', params.languages.join(',')] : [];
      return {
        program: 'macHelper',
        args: ['ocr', '--input', params.input, ...languages, ...(params.fast ? ['--fast'] : [])],
      };
    }
    case 'probe':
      return {
        program: 'ffprobe',
        args: ['-v', 'error', '-of', 'json', '-show_format', '-show_streams', call.params.input],
      };
  }
}

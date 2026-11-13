// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: any clip of the library, seen. `library.frameAt` returns one asset at one second as a picture (frames.ts:
 * GPU decode first, HDR mapped, upright), for a model that sees images and where the person's frames may go to it
 * (pictures.ts); the artifact is there either way, to describe or draw over. `library.subjects` returns where people
 * are over a stretch of a clip, from FRM1's subject tracks (core's SubjectSource, the same tracks placement, QA and
 * reframing read): the subject's box and kind, faces, whole heads and whole people, as shares of the upright frame,
 * sampled evenly. It makes the track when there is none yet (a job on the jobs queue). Together they let the AI choose
 * a shot and position it (timeline.setReframe, timeline.slipClip) by what is in the frame. Both live in render, which
 * reads media; their names are the library's, where the model looks for its clips.
 */
import {
  artifactRefSchema,
  defineTool,
  err,
  FrameRate,
  NO_TOOL_RETRY,
  NotFoundError,
  NotImplementedError,
  ok,
  RationalTime,
  ulidSchema,
  ValidationError,
  type AnyTool,
  type ArtifactRef,
  type AssetId,
  type SubjectSample,
} from '@taalcut/core';
import { z } from 'zod';
import type { EyesDeps } from './deps';
import { stillAt } from './frames';
import { footagePicturesSchema, footageVerdict } from './pictures';

/** A still image has one frame (describeFrame's rule): it is read at 0 whatever second is asked. */
const STILL_IMAGE = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i;
/** library.subjects: the longest stretch one call reads, and the most samples it returns. */
export const SUBJECTS_SPAN_MAX_SECONDS = 60;
export const SUBJECTS_SAMPLES_MAX = 48;
const MS = FrameRate.of(1000);
const READ = { filesystem: { read: ['library', 'app-data'] as const }, network: 'none' } as const;

const assetId = ulidSchema('Asset');
const shareBox = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
type ShareBox = z.output<typeof shareBox>;

const r3 = (value: number) => Math.round(value * 1000) / 1000;
const boxOf = (box: ShareBox): ShareBox => ({
  x: r3(box.x),
  y: r3(box.y),
  width: r3(box.width),
  height: r3(box.height),
});

export function frameAtTool(deps: Pick<EyesDeps, 'assets' | 'media' | 'pictures'>): AnyTool {
  return defineTool({
    name: 'library.frameAt',
    version: '1.0.0',
    description:
      'One frame of a library clip (or photo) at a second of it, as an image artifact, upright, at most ' +
      'maxDimension on its long side. It comes back as a picture to a model that sees images where the person’s ' +
      'video may go to it (pictures says which). For choosing a shot or a moment of it before it goes on the timeline.',
    summary: 'One frame of a library clip at a second of it, as a picture.',
    tags: ['library', 'frame', 'image', 'look', 'clip', 'shot', 'preview'],
    input: z.object({
      assetId,
      seconds: z
        .number()
        .min(0)
        .max(6 * 3600)
        .describe('Seconds into the clip (a photo is read at 0)'),
      maxDimension: z.int().min(128).max(1280).default(512),
    }),
    output: z.object({
      assetId,
      seconds: z.number(),
      image: artifactRefSchema,
      width: z.int().positive(),
      height: z.int().positive(),
      pictures: footagePicturesSchema,
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    permission: READ,
    images: (output) => (output.pictures.footage === 'shown' ? [output.image as ArtifactRef] : []),
    summarize: (output) => `Clip ${output.assetId} at ${output.seconds} s, ${output.width}x${output.height}`,
    run: async (input, ctx) => {
      const original = await deps.assets.original(input.assetId as AssetId);
      if (!original.ok) return original;
      if (!original.value)
        return err(NotFoundError({ entity: 'asset', id: input.assetId }, { detail: 'The clip is offline' }));
      const media = await deps.media().catch(() => null);
      if (!media)
        return err(
          NotImplementedError({ feature: 'library.frameAt' }, { detail: 'FFmpeg is not available here' }),
        );
      const seconds = STILL_IMAGE.test(original.value.path) ? 0 : input.seconds;
      const still = await stillAt(media, original.value.path, seconds, input.maxDimension, ctx.signal);
      if (!still.ok) return still;
      const image = await ctx.artifacts.put({
        mediaType: 'image/jpeg',
        data: still.value.data,
        summary: `Library clip ${input.assetId} at ${seconds} s, ${still.value.width}x${still.value.height}.`,
      });
      if (!image.ok) return image;
      return ok({
        assetId: input.assetId,
        seconds,
        image: image.value,
        width: still.value.width,
        height: still.value.height,
        pictures: await footageVerdict(deps.pictures, ctx.signal),
      });
    },
  }) as AnyTool;
}

const sampleSchema = z.object({
  /** Seconds into the clip. */
  t: z.number(),
  subject: z.object({ kind: z.string(), box: shareBox.nullable() }),
  faces: z.array(shareBox),
  /** Whole heads, hair included, also seen from the side or behind (detect samples only). */
  heads: z.array(shareBox),
  people: z.array(shareBox),
});

/** `count` samples spread evenly, detect samples first (only they carry heads and people). */
function evenly(samples: readonly SubjectSample[], count: number): SubjectSample[] {
  const detected = samples.filter((sample) => sample.source === 'detect');
  const pool = detected.length > 0 ? detected : samples;
  if (pool.length <= count) return [...pool];
  return Array.from({ length: count }, (_, index) => pool[Math.floor((index * pool.length) / count)]!);
}

function sampleOut(sample: SubjectSample): z.input<typeof sampleSchema> {
  return {
    t: Math.round(RationalTime.toSeconds(sample.t) * 100) / 100,
    subject: { kind: sample.subject.kind, box: sample.subject.box ? boxOf(sample.subject.box) : null },
    faces: sample.faces.map((face) => boxOf(face.box)),
    heads: (sample.heads ?? []).map((head) => boxOf(head.box)),
    people: (sample.people ?? []).map((person) => boxOf(person.box)),
  };
}

export function subjectsTool(deps: Pick<EyesDeps, 'subjects'>): AnyTool {
  return defineTool({
    name: 'library.subjects',
    version: '1.0.0',
    description:
      'Where people are over a stretch of a library clip, from its subject track: at evenly spread moments, the ' +
      'subject’s box and kind, every face, whole head and whole person, as shares of the upright frame (x, y from ' +
      `the top left). At most ${SUBJECTS_SPAN_MAX_SECONDS} s and ${SUBJECTS_SAMPLES_MAX} samples a call. It makes ` +
      'the track first when there is none yet (make: false only reads). For choosing a shot by who is in it and ' +
      'where, keeping a face in or out, and positioning it (timeline.setReframe, timeline.slipClip).',
    summary: 'Where people and faces are over a stretch of a library clip, from its subject track.',
    tags: ['library', 'subjects', 'faces', 'people', 'framing', 'position', 'track', 'shot'],
    input: z.object({
      assetId,
      from: z.number().min(0).describe('Seconds into the clip'),
      to: z
        .number()
        .positive()
        .describe(`Seconds into the clip; at most ${SUBJECTS_SPAN_MAX_SECONDS} s after from`),
      samples: z.int().min(1).max(SUBJECTS_SAMPLES_MAX).default(12),
      make: z
        .boolean()
        .default(true)
        .describe('Track the stretch when no track covers it (a job, some seconds)'),
    }),
    output: z.object({
      assetId,
      from: z.number(),
      to: z.number(),
      /** The upright frame the boxes are shares of, in pixels; null for a track made before FRM1 or none. */
      frame: z.object({ width: z.int(), height: z.int() }).nullable(),
      track: z.enum(['stored', 'made', 'none']),
      samples: z.array(sampleSchema),
      note: z.string().optional(),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 180_000,
    retry: NO_TOOL_RETRY,
    permission: READ,
    summarize: (output) =>
      `${output.samples.length} samples of clip ${output.assetId} (${output.track}), ` +
      `faces in ${output.samples.filter((sample) => sample.faces.length > 0).length}`,
    run: async (input, ctx) => {
      if (input.to <= input.from || input.to - input.from > SUBJECTS_SPAN_MAX_SECONDS)
        return err(
          ValidationError(
            { field: 'to' },
            { detail: `Give from < to, at most ${SUBJECTS_SPAN_MAX_SECONDS} s apart` },
          ),
        );
      const range = {
        assetId: input.assetId as AssetId,
        start: RationalTime.fromSeconds(input.from, MS),
        end: RationalTime.fromSeconds(input.to, MS),
      };
      const base = { assetId: input.assetId, from: input.from, to: input.to };
      let span = await deps.subjects.over(range, ctx.signal);
      if (!span.ok) return span;
      let track: 'stored' | 'made' = 'stored';
      if (!span.value && input.make) {
        const made = await deps.subjects.ensure([range], ctx.signal);
        if (!made.ok)
          return ok({
            ...base,
            frame: null,
            track: 'none' as const,
            samples: [],
            note: `No track could be made (${made.error.code}).`,
          });
        span = await deps.subjects.over(range, ctx.signal);
        if (!span.ok) return span;
        track = 'made';
      }
      if (!span.value)
        return ok({
          ...base,
          frame: null,
          track: 'none' as const,
          samples: [],
          note: 'No track covers this stretch yet: make: true tracks it.',
        });
      return ok({
        ...base,
        frame: span.value.frame,
        track,
        samples: evenly(span.value.samples, input.samples).map(sampleOut),
      });
    },
  }) as AnyTool;
}

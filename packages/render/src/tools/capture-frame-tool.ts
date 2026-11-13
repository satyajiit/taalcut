// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timeline.captureFrame` (SPEC section 10): the frame the timeline shows at
 * frame k, from the preview (proxies, fast) or from a render's file (what
 * the user will see), with what is on screen and where the text sits. The
 * render process does the work (RenderWorker.captureFrame, through main);
 * the JPEG goes into an artifact so the image never floods the context.
 *
 * AGT2: the frame comes back to a model that sees images (ToolSpec `images`) when the person's frames may go to it:
 * on this Mac, or under their standing upload consent (eyes/pictures.ts). Otherwise the words say what is on screen.
 *
 * TODO(timeline): merge into the timeline lane's tool module; it lives here
 * because it needs the capture session.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  artifactRefSchema,
  defineTool,
  defineToolModule,
  ok,
  RationalTime,
  type CaptureFrameInput,
  type RenderWorker,
  type ToolModule,
  ulidSchema,
  type ArtifactRef,
} from '@taalcut/core';
import { footagePicturesSchema, footageVerdict, type FootagePictures } from '../eyes/pictures';
import { overlayPresetIdSchema } from '../presets/presets.v1';

export interface CaptureFrameToolDeps {
  readonly worker: RenderWorker;
  /** AGT2: whether the frame goes to the run's model as a picture. Absent: never (the words only). */
  readonly pictures?: FootagePictures;
}

const boxSchema = z.object({ x: z.int(), y: z.int(), width: z.int(), height: z.int() });

export const captureFrameToolInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  timelineRevision: z.int().positive().optional().describe('Default: the latest revision'),
  frame: z.int().nonnegative().describe('Frame index at the timeline rate, 0 = first frame'),
  source: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('preview') }),
      z.object({ kind: z.literal('render'), renderId: ulidSchema('Render') }),
    ])
    .describe("'preview' is fast (proxies); 'render' decodes a render's file, what the user will see"),
  maxDimension: z.int().min(64).max(1920).default(768),
  overlayPresetId: overlayPresetIdSchema
    .optional()
    .describe("Draw this portrait preset's platform UI and safe rect"),
});

export function timelineToolModule(deps: CaptureFrameToolDeps): ToolModule {
  const captureFrame = defineTool({
    name: 'timeline.captureFrame',
    // 1.1.0 (AGT2): the frame comes back as a picture where the person's frames may go to the model.
    version: '1.1.0',
    description:
      'Captures one frame of the timeline as a JPEG artifact, from the preview or from a render, optionally with ' +
      "a platform's UI and safe rect drawn on it. Also returns the clips, captions and texts on screen and the " +
      'box of every caption and text, and whether each sits inside the safe rect. The frame comes back as a ' +
      'picture to a model that sees images when the person’s video may go to it (pictures says which).',
    summary: 'Captures one frame of the timeline as an image, with the text boxes on it.',
    tags: ['frame', 'screenshot', 'image', 'safe-zone', 'review'],
    input: captureFrameToolInputSchema,
    output: z.object({
      frame: z.int().nonnegative(),
      seconds: z.number().nonnegative(),
      image: artifactRefSchema,
      width: z.int().positive(),
      height: z.int().positive(),
      visible: z.object({
        clips: z.array(z.string()),
        captions: z.array(z.string()),
        texts: z.array(z.string()),
      }),
      textBoxes: z.array(
        z.object({
          kind: z.enum(['caption', 'text']),
          id: z.string(),
          box: boxSchema,
          lines: z.int().nonnegative(),
          inSafeZone: z.boolean(),
        }),
      ),
      pictures: footagePicturesSchema,
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 30_000,
    // render.capture_failed is retryable: one more try.
    retry: { maxAttempts: 2, initialDelayMs: 500 },
    permission: { filesystem: { read: ['library', 'project', 'app-data'] }, network: 'none' },
    idempotencyKey: (input) =>
      createHash('sha256')
        .update(
          JSON.stringify([
            input.timelineId,
            input.timelineRevision ?? null,
            input.frame,
            input.source,
            input.maxDimension,
            input.overlayPresetId ?? null,
          ]),
        )
        .digest('hex'),
    images: (output) => (output.pictures.footage === 'shown' ? [output.image as ArtifactRef] : []),
    summarize: (output) =>
      `Frame ${output.frame} (${output.seconds.toFixed(2)} s): ${output.visible.clips.length} clips, ` +
      `${output.textBoxes.length} text boxes, ${output.textBoxes.filter((box) => !box.inSafeZone).length} outside the safe rect`,
    run: async (input, ctx) => {
      const captured = await deps.worker.captureFrame(input as CaptureFrameInput, { signal: ctx.signal });
      if (!captured.ok) return captured;
      const frame = captured.value;
      const image = await ctx.artifacts.put({
        mediaType: frame.mimeType,
        data: Buffer.from(frame.dataBase64, 'base64'),
        summary: `Frame ${frame.frame} of timeline ${input.timelineId} (${input.source.kind}), ${frame.width}x${frame.height}.`,
      });
      if (!image.ok) return image;
      const pictures = await footageVerdict(deps.pictures, ctx.signal);
      return ok({
        frame: frame.frame,
        seconds: RationalTime.toSeconds(frame.at),
        image: image.value,
        width: frame.width,
        height: frame.height,
        visible: frame.visible,
        textBoxes: frame.textBoxes,
        pictures,
      });
    },
  });
  return defineToolModule({ id: 'timeline', tools: [captureFrame] });
}

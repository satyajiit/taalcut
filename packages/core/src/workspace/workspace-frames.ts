// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: the render worker's `workspaceFrames`, for the Designer in the agent process. Render draws a composition's
 * files (blobs in the project's workspace, `workspaceBlobPath`) with its variables at the given seconds, over the
 * timeline's footage at the moment it would play or over grey, offline in the export's own capture session, and
 * runs the frame checks (bounds, type floor, contrast, the same frame from shuffled seeks). The stills come back as
 * JPEGs for the tool to store and show a vision model. At most 12 stills; render gives a call 60 s. HFW1-TPL: also
 * over a given picture (the reel's frame), and each still says where the composition's content sits.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { graphicParamValuesSchema } from '../templates/graphic-params';
import { graphicScaleSchema } from '../timeline/graphic-proposal';
import { graphicPlacementSchema } from '../timeline/graphics';
import { compositionGateCheckSchema, COMPOSITION_DURATION_LIMITS } from './composition';
import { WORKSPACE_LIMITS, workspaceFileSchema, workspacePathSchema } from './workspace-files';

export const WORKSPACE_FRAMES_MAX = 12;
/** HFW1-TPL: the largest picture a composition is drawn over (`over: image`), decoded: 4 MiB. */
export const WORKSPACE_OVER_IMAGE_BYTES = 4 * 1024 * 1024;
/** Its base64 length at most. */
const OVER_IMAGE_BASE64 = Math.ceil(WORKSPACE_OVER_IMAGE_BYTES / 3) * 4;
/** What a picture's bytes start with, as base64: PNG's signature and JPEG's start-of-image. */
const IMAGE_MAGIC = { 'image/png': 'iVBORw0KGgo', 'image/jpeg': '/9j/' } as const;

/**
 * HFW1-TPL: a picture to draw the composition over (the reel's own frame, for the template's vision judge), PNG or
 * JPEG, covering the canvas. Worker only: a tool or a command takes an artifact ref and reads it into this, so the
 * bytes reach neither the run log nor the audit log, as `timeline.captureFrame`'s JPEG goes into an artifact.
 */
export const workspaceOverImageSchema = z
  .object({
    kind: z.literal('image'),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    dataBase64: z
      .string()
      .min(8)
      .max(OVER_IMAGE_BASE64)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .refine((image) => image.dataBase64.startsWith(IMAGE_MAGIC[image.mimeType]), {
    message: 'The picture is not the type it says',
    path: ['dataBase64'],
  });
export type WorkspaceOverImage = z.output<typeof workspaceOverImageSchema>;

/** What the composition is drawn over. */
export const workspaceFramesOverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('grey') }),
  z.object({
    kind: z.literal('footage'),
    timelineId: idSchema<'Timeline'>(),
    timelineRevision: z.int().positive().optional(),
    /** Seconds from the video's start where the composition would start. */
    start: z.number().min(0).max(3600),
    /** Graphics of the timeline left out of the stills (the one being redesigned, so its old look isn't under it). */
    leaveOut: z.array(idSchema<'TimelineItem'>()).max(48).optional(),
  }),
  workspaceOverImageSchema,
]);

export const workspaceFramesInputSchema = z.object({
  projectId: idSchema<'Project'>(),
  /** The composition to draw, by content: its root file and its files at a workspace revision. */
  entry: workspacePathSchema,
  files: z.array(workspaceFileSchema).min(1).max(WORKSPACE_LIMITS.files),
  /** Values for its variables; absent ones take their defaults. */
  params: graphicParamValuesSchema.optional(),
  /** Seconds into the composition, one still each, in this order. */
  seconds: z.array(z.number().min(0).max(COMPOSITION_DURATION_LIMITS.max)).min(1).max(WORKSPACE_FRAMES_MAX),
  over: workspaceFramesOverSchema,
  /** Where it sits on the frame and its size, as a graphic item's; absent: as the composition lays itself out. */
  placement: graphicPlacementSchema.optional(),
  scale: graphicScaleSchema.optional(),
  maxDimension: z.int().min(64).max(1920).default(768),
});
export type WorkspaceFramesInput = z.input<typeof workspaceFramesInputSchema>;

export const workspaceFrameSchema = z.object({
  seconds: z.number().min(0).max(COMPOSITION_DURATION_LIMITS.max),
  mimeType: z.literal('image/jpeg'),
  /** At most 2 MiB of image. */
  dataBase64: z.string().max(2_796_204),
  width: z.int().positive(),
  height: z.int().positive(),
  /**
   * HFW1-TPL: where the composition's drawn content sits on the canvas at that second, normalised (0–1, origin top
   * left) and not clamped, so one leaving the frame shows past 0 or 1; null when nothing of it shows then. For the
   * make's frame checks (the safe rect, the people's faces). Absent from a worker that doesn't measure it.
   */
  box: z
    .object({
      x: z.number().min(-4).max(4),
      y: z.number().min(-4).max(4),
      width: z.number().min(0).max(8),
      height: z.number().min(0).max(8),
    })
    .nullable()
    .optional(),
  /**
   * HFW1-TPL: how many lines the composition's words sit on at that second (its text's distinct line tops); 0 when
   * no words show. For checking a template's design against the reel's line count. Absent from a worker that
   * doesn't measure it.
   */
  lines: z.int().min(0).max(100).optional(),
  /**
   * HFW1-TPL: its words' type as drawn at that second, px on the 1080 × 1920 canvas: the largest words' font size,
   * and the gaps between all its words and its drawn content's edges (its padding, as it reads). Absent without words,
   * or from a worker that doesn't measure it. For a conversation's bubbles to share one size and padding.
   */
  type: z
    .object({
      fontPx: z.number().min(0).max(2000),
      padding: z.object({
        top: z.number().min(-4000).max(4000),
        right: z.number().min(-4000).max(4000),
        bottom: z.number().min(-4000).max(4000),
        left: z.number().min(-4000).max(4000),
      }),
    })
    .optional(),
});
export type WorkspaceFrame = z.output<typeof workspaceFrameSchema>;

export const workspaceFramesOutputSchema = z.object({
  frames: z.array(workspaceFrameSchema).max(WORKSPACE_FRAMES_MAX),
  /** The frame checks, with fix hints in `detail` for the designing model. */
  checks: z.array(compositionGateCheckSchema).max(32),
  ms: z.int().nonnegative(),
});
export type WorkspaceFramesOutput = z.output<typeof workspaceFramesOutputSchema>;

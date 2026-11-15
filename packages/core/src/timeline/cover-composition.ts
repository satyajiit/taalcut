// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: a cover the AI designed as a HyperFrames composition over the video's real frames. The composition is the
 * same kind of file a video graphic is (HTML and CSS in the project's workspace, gated by render), sized to the
 * cover's canvas. Its pictures are by reference: each `<img data-picture="name">` in it names one of `pictures`,
 * a frame of this timeline or a library shot at a time, and render reads that picture from the original when it
 * draws the cover, so no frame is ever copied into the workspace. Its words are its variables' values, as a
 * designed graphic's are, so the cover panel edits them without touching the files.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { graphicParamSchema, graphicParamValuesSchema } from '../templates/graphic-params';
import { sha256Schema } from '../templates/template-parts';
import {
  checkTotalBytes,
  checkUniquePaths,
  WORKSPACE_LIMITS,
  workspaceFileSchema,
  workspacePathSchema,
} from '../workspace/workspace-files';

/**
 * What a cover's picture is made of, as the model understood the request (stated on the save, never read out of
 * the request's words by code): `footage` is the video's own frames or the person's library shots, and is what a
 * request that names no medium gets; `generated` is art an image model made because the person asked for it;
 * `drawn` is a graphic with no photograph, because the person asked for one.
 */
export const COVER_MEDIUMS = ['footage', 'generated', 'drawn'] as const;
export type CoverMedium = (typeof COVER_MEDIUMS)[number];

/** The pictures one cover composition may use. */
export const COVER_PICTURES_MAX = 4;
/** The designs one cover offers to choose from. */
export const COVER_DESIGNS_MAX = 3;
/** A picture's name in the composition: `<img data-picture="hero">`. */
export const COVER_PICTURE_NAME = /^[a-z][a-z0-9-]{0,23}$/;

/** Where a cover's picture comes from. Frame indexes use the video's rate, as `CoverSettings.source` does. */
export const coverPictureSourceSchema = z.discriminatedUnion('kind', [
  /** A frame of this timeline, with the video's own effects. */
  z.object({ kind: z.literal('frame'), frame: z.int().nonnegative() }),
  /** A library asset: a still, or a shot at `seconds` into its file. */
  z.object({
    kind: z.literal('asset'),
    assetId: ulidSchema('Asset'),
    seconds: z.number().min(0).max(86_400).default(0),
  }),
]);
export type CoverPictureSource = z.output<typeof coverPictureSourceSchema>;

export const coverPictureSchema = z.object({
  name: z.string().regex(COVER_PICTURE_NAME),
  source: coverPictureSourceSchema,
});
export type CoverPicture = z.output<typeof coverPictureSchema>;

/** One designed cover: the composition's files as they were gated, its words, its pictures and its still's second. */
export const coverCompositionSchema = z
  .object({
    /** The file with the composition's root. */
    entry: workspacePathSchema,
    /** Its files by content (blobs in the project's workspace). */
    files: z.array(workspaceFileSchema).min(1).max(WORKSPACE_LIMITS.files),
    /** sha256 (hex) over its files (`compositionHash`): exactly what was gated and drawn. */
    hash: sha256Schema,
    /** Its variables, so the cover panel lists the words it can change without reading the files. */
    variables: z.array(graphicParamSchema).max(WORKSPACE_LIMITS.variables),
    /** Values for its variables, by name; absent ones take the variable's default. */
    params: graphicParamValuesSchema.default({}),
    /** Seconds into the composition the still is drawn at. */
    at: z.number().min(0).max(600),
    pictures: z.array(coverPictureSchema).max(COVER_PICTURES_MAX).default([]),
    /** What the design is going for, in the designing model's words: untrusted, shown as plain text. */
    idea: z.string().trim().min(1).max(160).optional(),
  })
  .superRefine((composition, ctx) => {
    checkUniquePaths(composition.files, ctx, 'files');
    checkTotalBytes(composition.files, ctx, 'files');
    if (!composition.files.some((file) => file.path === composition.entry))
      ctx.addIssue({ code: 'custom', path: ['entry'], message: 'The entry is not one of its files' });
    const names = new Set<string>();
    composition.pictures.forEach((picture, index) => {
      if (names.has(picture.name))
        ctx.addIssue({ code: 'custom', path: ['pictures', index, 'name'], message: 'Repeated picture' });
      names.add(picture.name);
    });
  });
export type CoverComposition = z.output<typeof coverCompositionSchema>;

/**
 * The designs a cover offers (at most three), as a designed graphic's options are: the one whose `hash` is the
 * cover's `composition` is in use. `set` names the run that made them, so a later run starts a set over.
 */
export const coverOptionsSchema = z.object({
  set: z.string().min(1).max(64),
  designs: z.array(coverCompositionSchema).min(1).max(COVER_DESIGNS_MAX),
});
export type CoverOptions = z.output<typeof coverOptionsSchema>;

/** A cover's `source` (cover.ts), as a composition cover's lead picture gives it. */
export type CoverLeadSource =
  | { kind: 'frame'; frame: number }
  | { kind: 'asset'; assetId: Extract<CoverPictureSource, { kind: 'asset' }>['assetId'] }
  | { kind: 'solid' };

/**
 * The picture a composition cover leads with, as `CoverSettings.source`: its first picture, or `solid` when it
 * draws none. Kept on the cover so a reader that knows nothing of compositions still says what the cover shows.
 */
export function coverLeadSource(pictures: readonly CoverPicture[]): CoverLeadSource {
  const lead = pictures[0]?.source;
  if (!lead) return { kind: 'solid' };
  return lead.kind === 'frame'
    ? { kind: 'frame', frame: lead.frame }
    : { kind: 'asset', assetId: lead.assetId };
}

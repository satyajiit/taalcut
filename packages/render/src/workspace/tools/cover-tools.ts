// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: `workspace.placeCover` makes a composition the video's cover. The composition is a workspace file like a
 * graphic's, on the cover's own canvas (`workspace.new` with `cover`); its pictures are by reference
 * (`<img data-picture="hero">` and `pictures: [{name: "hero", frame}]`), read from the originals when the cover
 * is drawn. The tool gates the entry, draws the cover exactly as the cover panel and `render.exportCover` will
 * (the render worker's `coverImage`), and saves it only when it drew: a composition that cannot be drawn, whose
 * words leave the canvas, or that is not what its stated medium says is refused with what to change. Nothing
 * here draws a stand-in.
 *
 * Designs placed in one run are offered together, at most three (core `coverOptions`): another entry joins the
 * set and must be another idea (DSG2's differ), the same entry again replaces its design. The newest is in use.
 */
import {
  COVER_DESIGNS_MAX,
  COVER_MEDIUMS,
  COVER_PICTURE_NAME,
  COVER_PICTURES_MAX,
  coverCompositionSchema,
  coverLeadSource,
  coverSettingsSchema,
  err,
  graphicParamValuesSchema,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  THUMBNAIL_ASPECTS,
  ulidSchema,
  ValidationError,
  VIDEO_SIZES,
  workspacePathSchema,
  type AsyncResult,
  type CoverComposition,
  type CoverSettings,
  type ProjectId,
} from '@taalcut/core';
import { z } from 'zod';
import { COVER_REFUSING_CHECKS } from '../../cover/cover-checks';
import type { WorkspaceToolDeps } from './deps';
import { gateEntry, refusalText } from './gate-run';
import { sameDesignProblem } from './options-differ';
import { entryLabel, keyOf, LOCAL, workspaceTool } from './tool-parts';
import { textOf } from './workspace-io';

export const WORKSPACE_COVER_TOOL = 'workspace.placeCover';

const pictureInput = z.object({
  name: z.string().regex(COVER_PICTURE_NAME).describe('As in <img data-picture="…">'),
  frame: z
    .int()
    .nonnegative()
    .optional()
    .describe('A frame of this timeline (timeline.captureFrame’s frame)'),
  assetId: ulidSchema('Asset').optional().describe('Or a library shot'),
  seconds: z.number().min(0).max(86_400).optional().describe('…at this second of its file'),
});

const input = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  entry: workspacePathSchema,
  aspect: z.enum(THUMBNAIL_ASPECTS),
  medium: z
    .enum(COVER_MEDIUMS)
    .describe('What the picture is made of: footage unless the person asked for generated or drawn art'),
  pictures: z.array(pictureInput).max(COVER_PICTURES_MAX).default([]),
  params: graphicParamValuesSchema.optional(),
  at: z.number().min(0).max(600).optional().describe('Second of the composition the still is taken at'),
  idea: z.string().trim().min(1).max(160).describe('The one idea of this design, in a line'),
});

const output = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  aspect: z.enum(THUMBNAIL_ASPECTS),
  width: z.int().positive(),
  height: z.int().positive(),
  /** How many designs the cover panel now offers for this cover. */
  designs: z.int().min(1).max(COVER_DESIGNS_MAX),
  /** Measured on the drawn cover: what to fix before handing off. */
  fix: z.array(z.string()),
  note: z.string(),
});

const refuse = (field: string, detail: string) =>
  err(ValidationError({ field }, { detail: detail.slice(0, 900) }));

/** The designs this run offers for the cover with `next` among them, or why it cannot join. */
async function offered(
  deps: WorkspaceToolDeps,
  projectId: ProjectId,
  before: CoverSettings | undefined,
  set: string,
  next: CoverComposition,
  html: string,
): AsyncResult<CoverComposition[]> {
  const held = before?.options?.set === set ? before.options.designs : [];
  const others = held.filter((design) => design.entry !== next.entry);
  if (others.length >= COVER_DESIGNS_MAX)
    return refuse(
      'entry',
      `This cover has its ${COVER_DESIGNS_MAX} designs already (${others.map((d) => d.entry).join(', ')}): ` +
        'revise one of them (the same entry again replaces it), or hand off.',
    );
  const texts: { entry: string; html: string }[] = [];
  for (const design of others) {
    const file = design.files.find((item) => item.path === design.entry);
    const text = file ? await textOf(deps.store, projectId, file) : undefined;
    if (text?.ok) texts.push({ entry: design.entry, html: text.value });
  }
  const alike = sameDesignProblem([...texts, { entry: next.entry, html }]);
  if (alike) return refuse('entry', alike);
  return ok([...others, next]);
}

export function workspaceCoverTool(deps: WorkspaceToolDeps) {
  return workspaceTool({
    name: WORKSPACE_COVER_TOOL,
    description:
      'Makes a composition the video’s cover and saves it. The composition is on the cover’s canvas ' +
      '(workspace.new with cover) and passes workspace.lint; each <img data-picture="name"> in it is a picture ' +
      'named in pictures: a frame of this timeline, or a library shot at a second, read from the original at full ' +
      'quality. medium says what the picture is made of. params sets its variables (its words). The cover is ' +
      'drawn before it is saved; one that cannot be drawn, runs words off the canvas, or is not its medium is ' +
      'refused with what to change. Another entry in the same run is offered beside it (three at most, each ' +
      'another idea); the same entry again replaces it. Then render.exportCover and look at the JPEG. Undoable.',
    summary: 'Saves a designed composition as the video’s cover.',
    tags: ['workspace', 'cover', 'thumbnail', 'place', 'composition', 'design'],
    input,
    output,
    command: 'timeline.setCover',
    sideEffect: 'write',
    timeoutMs: 120_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf(WORKSPACE_COVER_TOOL),
    describeCall: (call) => `${entryLabel(call.entry)} · ${call.aspect}`,
    run: async (call, ctx) => {
      const timeline = await deps.timelines.get(call.timelineId);
      if (!timeline.ok) return timeline;
      if (timeline.value.projectId !== call.projectId)
        return err(NotFoundError({ entity: 'timeline', id: call.timelineId }));
      if (!deps.coverImage) return refuse('entry', 'Covers cannot be drawn here, so none was saved.');
      const bad = call.pictures.find(
        (picture) => (picture.frame === undefined) === (picture.assetId === undefined),
      );
      if (bad)
        return refuse(
          'pictures',
          `Picture "${bad.name}" needs exactly one of frame (a frame of this timeline) or assetId (a library shot).`,
        );
      const gated = await gateEntry(deps, call.projectId, call.entry);
      if (!gated.ok) return gated;
      const { result } = gated.value;
      if (!result.gate.passed || result.durationSeconds === undefined)
        return refuse('entry', refusalText(result));
      const composition = coverCompositionSchema.safeParse({
        entry: call.entry,
        files: gated.value.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
        hash: gated.value.hash,
        variables: result.variables,
        params: call.params ?? {},
        at: Math.min(call.at ?? result.durationSeconds / 2, result.durationSeconds),
        pictures: call.pictures.map((picture) => ({
          name: picture.name,
          source:
            picture.assetId !== undefined
              ? { kind: 'asset', assetId: picture.assetId, seconds: picture.seconds ?? 0 }
              : { kind: 'frame', frame: picture.frame },
        })),
        idea: call.idea,
      });
      if (!composition.success) return refuse('pictures', z.prettifyError(composition.error));
      const before = (timeline.value.covers ?? []).find((cover) => cover.aspect === call.aspect);
      const designs = await offered(
        deps,
        call.projectId,
        before,
        ctx.runId ?? ctx.callId,
        composition.data,
        gated.value.text,
      );
      if (!designs.ok) return designs;
      const cover = coverSettingsSchema.safeParse({
        aspect: call.aspect,
        source: coverLeadSource(composition.data.pictures),
        medium: call.medium,
        composition: composition.data,
        options: { set: ctx.runId ?? ctx.callId, designs: designs.value },
        ...(before?.channel ? { channel: before.channel } : {}),
      });
      if (!cover.success) return refuse('cover', z.prettifyError(cover.error));
      const target = { projectId: call.projectId, timelineId: call.timelineId, revision: call.revision };
      const drawn = await deps.coverImage(
        { ...target, aspect: call.aspect, cover: cover.data },
        { signal: ctx.signal },
      );
      if (!drawn.ok) return drawn;
      const failed = (drawn.value.checks ?? []).filter((check) => check.status === 'fail');
      const refusing = failed.filter((check) => COVER_REFUSING_CHECKS.has(check.id));
      if (refusing.length > 0)
        return refuse(
          'entry',
          `The cover was drawn and not saved: ${refusing.map((check) => check.detail ?? check.id).join(' | ')}`,
        );
      const done = await ctx.dispatch({ ...target, cover: cover.data });
      if (!done.ok) return done;
      const receipt = done.value as { revision: number };
      const fix = failed.map((check) => `${check.id}: ${check.detail ?? ''}`);
      const size = VIDEO_SIZES[call.aspect];
      return ok({
        ...target,
        revision: receipt.revision,
        aspect: call.aspect,
        width: size.width,
        height: size.height,
        designs: designs.value.length,
        fix,
        note:
          (fix.length > 0
            ? 'Saved, with something to fix: change it and place this entry again. '
            : 'Saved. ') +
          `Now render.exportCover with aspect "${call.aspect}" and revision ${receipt.revision}, and look at the ` +
          'JPEG before you say it is done.',
      });
    },
  });
}

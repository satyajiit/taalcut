// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: a graphic the AI designed as a HyperFrames composition, and the workspace revisions it comes from.
 *
 * The Designer writes a sub-composition in its project's workspace (HTML, CSS and one script that builds one paused
 * GSAP timeline); render's gate lints it with HyperFrames' own linter, checks it against Taalcut's allowlists and
 * lowers the script to motion data (render SPEC "HFW1"). What passed is kept as a composition: its files by content
 * (`hash` over them), its variables (the words and colours a made video sets), its length, who made it from what,
 * and the gate's report. A timeline keeps copies of the ones its graphics draw with, a template the ones its
 * overlays draw with. There is no built-in design behind one: a graphic that has no composition that passed is left
 * out, never drawn with a kit look.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { COMMAND_SOURCES } from '../commands/definition';
import { graphicParamSchema } from '../templates/graphic-params';
import { GRAPHIC_CHECK_STATUSES, graphicProvenanceSchema } from '../templates/graphic-provenance';
import { sha256Schema } from '../templates/template-parts';
import type { GraphicCompositionRef } from './composition-ref';
import {
  checkTotalBytes,
  checkUniquePaths,
  WORKSPACE_LIMITS,
  workspaceFileSchema,
  workspacePathSchema,
} from './workspace-files';

export * from './composition-ref';

/** One of the gate's checks (render's ids: `hfLint`, `markup`, `css`, `urls`, `limits`, `lowering`, `bounds`, …). */
export const compositionGateCheckSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/),
  status: z.enum(GRAPHIC_CHECK_STATUSES),
  /** For developers and the designing model: what failed, where, and how to fix it. */
  detail: z.string().max(500).optional(),
});
export type CompositionGateCheck = z.output<typeof compositionGateCheckSchema>;

/** The gate's report on a composition's files (it passed only when HyperFrames' lint had no error and no check failed). */
export const compositionGateSchema = z.object({
  /** The gate's version: a newer gate checks a composition again. */
  version: z.string().min(1).max(32),
  passed: z.boolean(),
  checkedAt: z.int().nonnegative(),
  /** HyperFrames' own lint (`lintHyperframeHtml`, a sub-composition): any error fails it. */
  hfLint: z.object({ errors: z.int().min(0).max(10_000), warnings: z.int().min(0).max(10_000) }),
  checks: z.array(compositionGateCheckSchema).max(32),
  /** The script's tweens, lowered to Taalcut motion data. */
  loweredTweens: z.int().min(0).max(300),
});
export type CompositionGate = z.output<typeof compositionGateSchema>;

/** The shortest and longest a composition lasts, in seconds (a graphic's own limits). */
export const COMPOSITION_DURATION_LIMITS = { min: 0.5, max: 600 } as const;

/** One designed graphic: its files, its variables, its length, where it came from and the gate's report. */
export const graphicCompositionSchema = z
  .object({
    id: idSchema<'GraphicComposition'>(),
    /** From 1; each new design of the same graphic (`graphics.setComposition`) is the next, under the same id. */
    version: z.int().min(1),
    /** sha256 (hex) over its files, sorted by path (`compositionHash`). */
    hash: sha256Schema,
    /** What it is, in the designing model's words ("Chat bubble"): untrusted, shown as plain text. */
    name: z.string().trim().min(1).max(60),
    /** The file with its root element (`data-composition-id`). */
    entry: workspacePathSchema,
    files: z.array(workspaceFileSchema).min(1).max(WORKSPACE_LIMITS.files),
    /** Its variables (`data-composition-variables`): the words and colours a use sets. */
    variables: z.array(graphicParamSchema).max(WORKSPACE_LIMITS.variables),
    durationSeconds: z.number().min(COMPOSITION_DURATION_LIMITS.min).max(COMPOSITION_DURATION_LIMITS.max),
    provenance: graphicProvenanceSchema,
    gate: compositionGateSchema,
  })
  .superRefine((composition, ctx) => {
    checkUniquePaths(composition.files, ctx, 'files');
    checkTotalBytes(composition.files, ctx, 'files');
    if (!composition.files.some((file) => file.path === composition.entry))
      ctx.addIssue({ code: 'custom', path: ['entry'], message: 'The entry is not one of its files' });
    const names = new Set<string>();
    composition.variables.forEach((variable, index) => {
      if (names.has(variable.name))
        ctx.addIssue({ code: 'custom', path: ['variables', index, 'name'], message: 'Repeated variable' });
      names.add(variable.name);
    });
  });
export type GraphicComposition = z.output<typeof graphicCompositionSchema>;

/** The copy a ref names, among a timeline's (or a template's) compositions; undefined when none is held. */
export function compositionFor(
  ref: Pick<GraphicCompositionRef, 'id' | 'hash'>,
  compositions: readonly GraphicComposition[] | undefined,
): GraphicComposition | undefined {
  return compositions?.find((copy) => copy.id === ref.id && copy.hash === ref.hash);
}

/** Copies unique by id and hash, and by id and version (a timeline's `graphicCompositions`). */
export function checkCompositionCopies(
  compositions: readonly GraphicComposition[],
  ctx: z.RefinementCtx,
  at: readonly (string | number)[],
): void {
  const contents = new Set<string>();
  const versions = new Set<string>();
  compositions.forEach((copy, index) => {
    const content = `${copy.id}@${copy.hash}`;
    const version = `${copy.id}#${copy.version}`;
    if (contents.has(content) || versions.has(version))
      ctx.addIssue({ code: 'custom', path: [...at, index], message: 'Repeated composition' });
    contents.add(content);
    versions.add(version);
  });
}

/**
 * One revision of a project's workspace: every file it holds then. `workspace.writeFiles` makes the next one over
 * `base`; `workspace.restore` makes an earlier one the workspace's head again. The library keeps them (a migration)
 * and the blobs they name.
 */
export const workspaceRevisionSchema = z
  .object({
    projectId: idSchema<'Project'>(),
    /** From 1; revision 0 is the empty workspace, which has no record. */
    revision: z.int().min(1),
    /** The revision it was written over (0: the empty workspace). */
    base: z.int().min(0),
    files: z.array(workspaceFileSchema).max(WORKSPACE_LIMITS.workspaceFiles),
    createdAt: z.int().nonnegative(),
    /** Who wrote it: the command's source (the agent, a person in the app, an MCP client). */
    origin: z.enum(COMMAND_SOURCES),
  })
  .superRefine((revision, ctx) => {
    checkUniquePaths(revision.files, ctx, 'files');
    checkTotalBytes(revision.files, ctx, 'files');
    if (revision.base >= revision.revision)
      ctx.addIssue({ code: 'custom', path: ['base'], message: 'Written over a later revision' });
  });
export type WorkspaceRevision = z.output<typeof workspaceRevisionSchema>;

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Looking at a composition (HFW1 "dsn"): `workspace.lint` gates it (HyperFrames' lint, Taalcut's allowlists, the
 * lowering of its script, the assets it loads) and says what to fix; `workspace.render` draws stills of it over grey
 * and `workspace.renderOver` over the footage where it would play or a picture (an artifact: a reel's frame, a
 * captured one), which shows the person's video to the run's model and so declares an upload (the first-use consent
 * card in a run whose model is in the cloud and sees images). Both go through the render worker's `workspaceFrames`, with where its content sits in each still and the frame checks (bounds,
 * type floor, contrast, seek determinism, network). The stills are stored as artifacts and come back as images to a
 * model that sees them (ToolSpec `images`); one that doesn't reads the checks' words and the boxes. A run gets at
 * most RENDERS_PER_RUN renders.
 */
import {
  artifactRefSchema,
  callClock,
  err,
  NO_TOOL_RETRY,
  NotImplementedError,
  ok,
  ulidSchema,
  ValidationError,
  WORKSPACE_FRAMES_MAX,
  graphicParamValuesSchema,
  workspacePathSchema,
  COMPOSITION_DURATION_LIMITS,
  WORKSPACE_OVER_IMAGE_BYTES,
  type ArtifactId,
  type ArtifactRef,
  type ArtifactStore,
  type ToolContext,
  type WorkspaceFrame,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import { z } from 'zod';
import type { WorkspaceToolDeps } from './deps';
import { findingSchema, findingsOf, gateEntry } from './gate-run';
import { lintFix } from './lint-fix';
import { entryLabel, keyOf, LOCAL, READ_RETRY, workspaceTool } from './tool-parts';

const fixLine = z.object({ line: z.int().positive(), now: z.string(), write: z.string().nullable() });
const lintFixSchema = fixLine.extend({ write: z.string().nullable().optional(), then: fixLine.optional(), why: z.string() });

/** The most renders one run makes (plan "Risks": cost and time per design). */
export const RENDERS_PER_RUN = 25;

const projectId = ulidSchema('Project');
const checkSchema = z.object({
  id: z.string(),
  status: z.string(),
  detail: z.string().optional(),
});

/** What the tools share between a render and a place: the newest still of each composition, by its hash. */
export interface WorkspaceLooks {
  /** `${projectId}:${hash}` → the artifact id of a still from its newest render. */
  readonly posters: Map<string, string>;
  /** Renders made, per run. */
  readonly renders: Map<string, number>;
}

export const posterKey = (projectId: string, hash: string) => `${projectId}:${hash}`;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Where the content sits in a still, in shares of the canvas (3 places), or null when nothing of it shows. */
function boxOf(frame: WorkspaceFrame) {
  if (frame.box === undefined) return {};
  if (frame.box === null) return { box: null };
  const { x, y, width, height } = frame.box;
  return { box: { x: round3(x), y: round3(y), width: round3(width), height: round3(height) } };
}

/** An artifact as the picture to draw over: a PNG or a JPEG of at most WORKSPACE_OVER_IMAGE_BYTES. */
async function overImage(artifacts: ArtifactStore, id: string) {
  const stored = await artifacts.get(id as ArtifactId);
  if (!stored.ok) return stored;
  const { mediaType } = stored.value.ref;
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg')
    return err(ValidationError({ field: 'image' }, { detail: 'Draw over a PNG or a JPEG' }));
  if (stored.value.data.byteLength > WORKSPACE_OVER_IMAGE_BYTES)
    return err(ValidationError({ field: 'image' }, { detail: 'That picture is too large to draw over' }));
  const dataBase64 = Buffer.from(stored.value.data).toString('base64');
  return ok({ kind: 'image' as const, mimeType: mediaType as 'image/png' | 'image/jpeg', dataBase64 });
}

/** The still to show for a composition: the one nearest its middle. */
function posterOf(frames: readonly { seconds: number; image: { id: string } }[], duration: number | undefined) {
  const middle = (duration ?? 0) / 2;
  return [...frames].sort((a, b) => Math.abs(a.seconds - middle) - Math.abs(b.seconds - middle))[0]?.image;
}

export function workspaceCheckTools(deps: WorkspaceToolDeps, looks: WorkspaceLooks) {
  const lint = workspaceTool({
    name: 'workspace.lint',
    description:
      "Gates a composition the way Taalcut will before it's placed: HyperFrames' own lint as a sub-composition, " +
      "Taalcut's markup and CSS allowlists, the lowering of its one script to motion, its assets and its limits. " +
      'Returns passed, every finding (errors first) with a fix hint, its variables and its length, and, where it can ' +
      'be said, fix: the exact line of the first error (line, now), what to write instead (write; null deletes it), ' +
      'a second line that follows (then) and why.',
    summary: 'Checks a composition and says what to fix.',
    tags: ['workspace', 'lint', 'check', 'gate', 'validate', 'hyperframes'],
    input: z.object({ projectId, entry: workspacePathSchema.describe('The composition file, e.g. bubble/index.html') }),
    output: z.object({
      entry: z.string(),
      passed: z.boolean(),
      checks: z.array(checkSchema),
      findings: z.array(findingSchema),
      variables: z.array(z.object({ name: z.string(), type: z.string() })),
      durationSeconds: z.number().optional(),
      tweens: z.int().nonnegative(),
      fix: lintFixSchema.optional(),
    }),
    sideEffect: 'read',
    timeoutMs: 30_000,
    retry: READ_RETRY,
    permission: LOCAL,
    describeCall: (input, output) =>
      `${entryLabel(input.entry)} · ${output.findings.filter((finding) => finding.severity === 'error').length}`,
    run: async (input) => {
      const gated = await gateEntry(deps, input.projectId, input.entry);
      if (!gated.ok) return gated;
      const { result } = gated.value;
      const fix = result.gate.passed ? undefined : lintFix(gated.value.text, result.findings.find((finding) => finding.severity === 'error'));
      return ok({
        entry: input.entry,
        passed: result.gate.passed,
        checks: result.gate.checks.map((check) => ({ ...check })),
        findings: findingsOf(result),
        variables: result.variables.map((variable) => ({ name: variable.name, type: variable.type })),
        ...(result.durationSeconds !== undefined ? { durationSeconds: result.durationSeconds } : {}),
        tweens: result.gate.loweredTweens,
        ...(fix ? { fix } : {}),
      });
    },
  });

  const frameSchema = z.object({
    seconds: z.number(),
    image: artifactRefSchema,
    width: z.int().positive(),
    height: z.int().positive(),
    /** Where the content sits, in shares of the canvas (past 0 or 1 when it leaves the frame); null: nothing shows. */
    box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(),
  });
  const stillsInput = {
    projectId,
    entry: workspacePathSchema,
    seconds: z.array(z.number().min(0).max(COMPOSITION_DURATION_LIMITS.max)).min(1).max(WORKSPACE_FRAMES_MAX),
    params: graphicParamValuesSchema.optional().describe('Values for its variables; default their defaults'),
    maxDimension: z.int().min(256).max(1280).default(768),
  };
  const stillsOutput = z.object({
    entry: z.string(),
    passed: z.boolean(),
    findings: z.array(findingSchema),
    frames: z.array(frameSchema),
    checks: z.array(checkSchema),
    rendersLeft: z.int().nonnegative(),
  });
  type StillsInput = z.output<z.ZodObject<typeof stillsInput>>;
  type Backdrop = WorkspaceFramesInput['over'];
  const FILES = { filesystem: { read: ['library', 'project', 'app-data'] as const }, network: 'none' } as const;
  const CHECKS =
    'It gates it first. Returns the stills as images, where the content sits in each (box, shares of the canvas; ' +
    'null when nothing shows), and the frame checks (bounds, type size, contrast of words on your own backdrop, the ' +
    `same frame from any seek, no network) with what to fix. At most ${RENDERS_PER_RUN} renders a run, both tools together.`;

  /** One render: the run's cap, the gate, the stills over the backdrop (stored as artifacts) and the checks. */
  async function drawStills(name: string, input: StillsInput, over: Backdrop, label: string, ctx: ToolContext) {
    if (!deps.frames) return err(NotImplementedError({ feature: name }, { detail: 'Stills cannot be drawn here' }));
    const run = ctx.runId ?? 'none';
    const used = looks.renders.get(run) ?? 0;
    if (used >= RENDERS_PER_RUN)
      return err(
        ValidationError(
          { field: 'renders' },
          { detail: `This run made ${RENDERS_PER_RUN} renders: place the best design, or stop and say why` },
        ),
      );
    const gated = await gateEntry(deps, input.projectId, input.entry);
    if (!gated.ok) return gated;
    const { result, files, hash } = gated.value;
    if (!result.gate.passed)
      return ok({ entry: input.entry, passed: false, findings: findingsOf(result), frames: [], checks: [], rendersLeft: RENDERS_PER_RUN - used });
    looks.renders.set(run, used + 1);
    const request: WorkspaceFramesInput = {
      projectId: input.projectId,
      entry: input.entry,
      files: files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
      seconds: input.seconds,
      over,
      ...(input.params ? { params: input.params } : {}),
      maxDimension: input.maxDimension,
    };
    const drawn = await deps.frames(request, { signal: ctx.signal });
    if (!drawn.ok) return drawn;
    const frames: z.input<typeof frameSchema>[] = [];
    for (const frame of drawn.value.frames) {
      const stored = await ctx.artifacts.put({
        mediaType: frame.mimeType,
        data: Buffer.from(frame.dataBase64, 'base64'),
        summary: `${input.entry} at ${frame.seconds} s over ${label}, ${frame.width}x${frame.height}.`,
      });
      if (!stored.ok) return stored;
      frames.push({ seconds: frame.seconds, image: stored.value, width: frame.width, height: frame.height, ...boxOf(frame) });
    }
    const poster = posterOf(frames, result.durationSeconds);
    if (poster) looks.posters.set(posterKey(input.projectId, hash), poster.id);
    return ok({
      entry: input.entry,
      passed: true,
      findings: findingsOf(result),
      frames,
      checks: drawn.value.checks.map((check) => ({ ...check })),
      rendersLeft: RENDERS_PER_RUN - used - 1,
    });
  }

  const shared = {
    timeoutMs: 90_000,
    retry: NO_TOOL_RETRY,
    images: (output: z.output<typeof stillsOutput>) => output.frames.map((frame) => frame.image as ArtifactRef),
    summarize: (output: z.output<typeof stillsOutput>) =>
      `${output.frames.length} stills of ${output.entry}; ${output.checks.filter((check) => check.status === 'fail').length} frame checks failed`,
  };

  const render = workspaceTool({
    name: 'workspace.render',
    description:
      `Draws stills of a composition over grey at the seconds you give (1 to ${WORKSPACE_FRAMES_MAX}, seconds into the ` +
      'composition): nothing of the person’s leaves this Mac. Over the footage where it plays, or over a picture, is ' +
      `workspace.renderOver. ${CHECKS}`,
    summary: 'Draws stills of a composition over grey, as images, with the frame checks.',
    tags: ['workspace', 'render', 'frames', 'stills', 'preview', 'look', 'grey'],
    input: z.object(stillsInput),
    output: stillsOutput,
    sideEffect: 'read',
    permission: FILES,
    idempotencyKey: keyOf('workspace.render'),
    ...shared,
    describeCall: (input, output) => `${entryLabel(input.entry)} · ${output.frames.length}`,
    run: (input, ctx) => drawStills('workspace.render', input, { kind: 'grey' }, 'grey', ctx),
  });

  /**
   * Over the person's footage or a picture: the stills show their video to the run's model, so where that model is
   * in the cloud and sees images, the first one asks with the upload consent card (a standing consent covers the
   * rest, each logged). A picture may be a frame captured from their video: it counts the same.
   */
  const renderOver = workspaceTool({
    name: 'workspace.renderOver',
    description:
      `Draws stills of a composition at the seconds you give (1 to ${WORKSPACE_FRAMES_MAX}, seconds into the ` +
      'composition) over the footage where it would play (over footage, with timelineId and at: the second of the ' +
      'video it starts at; leaveOut the graphics being redesigned) or over a picture (over image, with imageId: an ' +
      'image artifact such as a reference frame). The first may ask the person before their video is shown to a ' +
      `cloud model. ${CHECKS}`,
    summary: 'Draws stills of a composition over the footage or a picture, as images, with the frame checks.',
    tags: ['workspace', 'render', 'frames', 'stills', 'preview', 'look', 'image', 'footage'],
    input: z.object({
      ...stillsInput,
      over: z.enum(['footage', 'image']).default('footage'),
      imageId: ulidSchema('Artifact').optional().describe('Over image: the picture to draw over'),
      timelineId: ulidSchema('Timeline').optional(),
      at: z.number().min(0).max(3600).optional().describe('Footage: the second of the video it starts at'),
      leaveOut: z.array(ulidSchema('TimelineItem')).max(48).optional(),
    }),
    output: stillsOutput,
    sideEffect: 'external',
    permission: {
      ...FILES,
      network: 'internet',
      cloudModules: ['agent'],
      uploads: { what: 'user-media', consent: 'first-use' },
    },
    idempotencyKey: keyOf('workspace.renderOver'),
    ...shared,
    describeCall: (input, output) =>
      `${entryLabel(input.entry)} · ${output.frames.length}${input.at !== undefined ? ` · ${callClock(input.at)}` : ''}`,
    run: async (input, ctx) => {
      if (input.over === 'footage') {
        if (!input.timelineId || input.at === undefined)
          return err(ValidationError({ field: 'at' }, { detail: 'Over footage needs timelineId and at' }));
        const footage: Backdrop = {
          kind: 'footage',
          timelineId: input.timelineId,
          start: input.at,
          ...(input.leaveOut ? { leaveOut: input.leaveOut } : {}),
        };
        return drawStills('workspace.renderOver', input, footage, 'footage', ctx);
      }
      if (!input.imageId) return err(ValidationError({ field: 'imageId' }, { detail: 'Over image needs imageId' }));
      const image = await overImage(ctx.artifacts, input.imageId);
      if (!image.ok) return image;
      return drawStills('workspace.renderOver', input, image.value, 'image', ctx);
    },
  });

  return { lint, render, renderOver };
}

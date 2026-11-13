// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The casting tools (P2-M2, M4): `timeline.cast` (picks, alternates and confidence per slot, changes nothing) and
 * `timeline.assemble` (casts again, deterministically, and creates one timeline per variant in one step). Each
 * new timeline's music is the reel's own when the template keeps its reel with sound (REF1).
 *
 * FIX-LIBRARIAN: the cast lists the few unsure slots worth a rerank with what indexing saw in each candidate
 * (rerank-material.ts), and assembly answers each new timeline's revision, so the Librarian reranks and hands off
 * without searching for anything.
 */
import {
  defineTool,
  err,
  newId,
  NO_TOOL_RETRY,
  ok,
  rationalTimeSchema,
  TIMELINE_COMMANDS,
  type AnyTool,
  type ArtifactRef,
  type AsyncResult,
  type ProjectId,
  type Result,
  type SubjectSource,
  type Template,
  type Timeline,
  type TimelineId,
  type TimelineStore,
  type TimelineSummary,
} from '@taalcut/core';
import type { z } from 'zod';
import { assemble } from '../assembly/assemble';
import { personInPoints } from '../assembly/person-in-points';
import { castAspects, ensureForAssembly, type CastRefiner, type SubjectDeps } from '../assembly/subjects';
import { runPlacement } from '../assembly/placement/run-placement';
import { withCompositionFiles, type CompositionFiles } from '../assembly/composition-files';
import { candidateKey } from '../model/cast';
import { checkEdited } from '../model/validate';
import type { CastingEngine, CastRequest, CastResult } from '../casting/engine';
import type { TimelineService } from '../service/service';
import type { TemplateReader } from '../service/templates';
import { sha256 } from './hash';
import { GRAPHICS_WAIT_MAX_MS, type GraphicsReady, type GraphicsWait } from './graphics-wait';
import { rerankMaterial, type RerankSlot, type ShotDescriptions } from './rerank-material';
import {
  assembleToolInputSchema,
  assembleToolOutputSchema,
  castToolInputSchema,
  castToolOutputSchema,
  type AssembleToolInput,
  type CastToolInput,
} from './schemas';

export interface CastToolDeps extends SubjectDeps {
  readonly engine: CastingEngine;
  readonly templates: TemplateReader;
  readonly clock: { now(): number };
  readonly timelineStore?: Pick<TimelineStore, 'listByProject'>;
  readonly service?: Pick<TimelineService, 'listByProject'>;
  /** What indexing said each shot shows, for the cast's rerank list. Absent: the list is empty. */
  readonly shotDescriptions?: ShotDescriptions;
  /** FRM1-OVL: who is in each clip, so the overlays never cover a head. Absent: placed with nobody known. */
  readonly subjects?: SubjectSource;
  /**
   * HFW1: the workspace store, to put a template's composition files into the project before its timelines are
   * created. Absent: composition graphics are left out (render could draw nothing for them).
   */
  readonly workspace?: CompositionFiles;
  /**
   * FIX-GFXWAIT: waits for a template's graphics still being designed, so a make reads the version that holds them.
   * Absent: nothing waits (a template's graphics are whatever its head holds).
   */
  readonly graphicsReady?: GraphicsReady;
}

interface Found {
  readonly template: Template;
  readonly cast: CastResult;
  /** FIX-GFXWAIT: how the wait for the template's graphics went; absent when nothing was being designed. */
  readonly graphics?: GraphicsWait;
}

/** FIX-GFXWAIT: a cast of the template's head waits for its graphics; one of a named version reads that version. */
async function awaitGraphics(
  deps: CastToolDeps,
  input: CastToolInput,
  signal: AbortSignal,
  progress?: (fraction: number) => void,
): Promise<GraphicsWait | null> {
  if (!deps.graphicsReady || input.template.version !== undefined) return null;
  progress?.(0);
  const waited = await deps.graphicsReady(input.template.id, signal);
  if (waited)
    console.warn(
      `[timeline] graphics for ${input.template.id}: ${waited.status}, ${waited.designed} of ${waited.total} ` +
        `designed after ${Math.round(waited.waitedMs / 1000)} s`,
    );
  return waited;
}

async function castFor(
  deps: CastToolDeps,
  input: CastToolInput,
  signal: AbortSignal,
  progress?: (fraction: number) => void,
): AsyncResult<Found> {
  const graphics = await awaitGraphics(deps, input, signal, progress);
  const template = await deps.templates.read(input.template);
  if (!template.ok) return template;
  const request: CastRequest = {
    projectId: input.projectId,
    template: template.value,
    mode: input.mode,
    variants: input.variants,
    seed: input.seed,
    locked: input.locked.map((lock) => ({
      ...lock,
      sourceStart: rationalTimeSchema.parse(lock.sourceStart),
    })),
    exclude: input.exclude,
    ...(input.pool ? { pool: input.pool } : {}),
    ...(input.rerank ? { rerank: input.rerank } : {}),
  };
  const cast = await deps.engine.cast(request, signal);
  if (!cast.ok) return cast;
  return ok({ template: template.value, cast: cast.value, ...(graphics ? { graphics } : {}) });
}

/** What `timeline.cast` answers: per variant and slot the pick, its alternates and confidence; the rest is the artifact. */
function castAnswer(
  result: CastResult,
  artifact: ArtifactRef,
  rerank: readonly RerankSlot[],
  graphics?: GraphicsWait,
): z.input<typeof castToolOutputSchema> {
  return {
    castId: result.castId,
    configVersion: result.configVersion,
    variants: result.variants.map((variant) => ({
      sequenceConfidence: variant.sequenceConfidence,
      slots: variant.slots.map((slot) => ({
        slotId: slot.slotId,
        shotId: slot.pick?.shotId ?? null,
        assetId: slot.pick?.assetId ?? null,
        confidence: slot.confidence,
        needsRerank: slot.needsRerank,
        note: slot.note,
        alternates: slot.alternates.map((alternate) => alternate.shotId),
      })),
    })),
    ...(result.variantsShort ? { variantsShort: result.variantsShort } : {}),
    rerank: [...rerank],
    artifact,
    ...(graphics ? { graphics } : {}),
  };
}

function castTool(deps: CastToolDeps): AnyTool {
  const tool = defineTool({
    name: 'timeline.cast',
    version: '1.2.0',
    description:
      'Casts the user\'s library into a template: per slot a pick, three alternates and a confidence, for 1–10 variants that differ in at least 30% of picks and in the hook. Mode "story" orders the brief\'s shots by capture time instead. Changes nothing; the full result is an artifact. `rerank` lists up to three unsure slots with what each candidate shows: to rerank, pass their order to timeline.assemble as `rerank`.',
    summary: 'Casts library shots into a template: picks, alternates and confidence per slot, per variant.',
    tags: ['casting', 'variants', 'shots'],
    input: castToolInputSchema,
    output: castToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    // FIX-GFXWAIT: a minute to cast, after the wait for the template's graphics.
    timeoutMs: 60_000 + GRAPHICS_WAIT_MAX_MS,
    retry: NO_TOOL_RETRY,
    run: async (input, ctx) => {
      const found = await castFor(deps, input, ctx.signal, (fraction) => ctx.reportProgress(fraction));
      if (!found.ok) return found;
      const { cast: result, template, graphics } = found.value;
      const artifact = await ctx.artifacts.put({
        mediaType: 'application/json',
        data: JSON.stringify(result),
        summary: `Cast ${result.castId}: ${result.variants.length} variant(s) of ${template.slots.length} slots.`,
      });
      if (!artifact.ok) return artifact;
      const rerank = await rerankMaterial(result, template, deps.shotDescriptions, {
        count: deps.engine.config.rerank.count,
        signal: ctx.signal,
      });
      return ok(castAnswer(result, artifact.value, rerank, graphics));
    },
  });
  return tool as AnyTool;
}

/** One assembled timeline per variant of the cast, named and id'd as the input asks. */
function assembleVariants(
  input: AssembleToolInput,
  found: Found,
  now: number,
  keptAudio: boolean,
  aspects: ReadonlyMap<string, number>,
  existing: readonly TimelineSummary[] = [],
): Result<Timeline[]> {
  const { template, cast: result } = found;
  const existingIds = new Set<string>(existing.map((item) => item.id));
  const existingNames = new Set<string>(existing.map((item) => item.name));
  const offset = existing.length;
  const timelines: Timeline[] = [];
  for (const [index, variant] of result.variants.entries()) {
    const requestedId = input.timelineIds?.[index];
    const timelineId = (
      requestedId && !existingIds.has(requestedId) ? requestedId : newId<'Timeline'>()
    ) as TimelineId;
    existingIds.add(timelineId);
    const variantIndex = Math.min(9, input.names?.[index] ? index : offset + index);
    let variantNumber = offset + index + 1;
    while (!input.names?.[index] && existingNames.has(`Variant ${variantNumber}`)) variantNumber += 1;
    const name = input.names?.[index] ?? `Variant ${variantNumber}`;
    existingNames.add(name);
    const cast = {
      castId: result.castId,
      mode: input.mode,
      variantIndex,
      variantCount: result.variants.length,
      configVersion: result.configVersion,
    };
    const assembled = assemble(
      {
        projectId: input.projectId,
        template,
        variant,
        cast,
        ...(input.texts ? { texts: input.texts } : {}),
        // BRK1-MAKE: the canvas the cast was made for (the clips' orientation when it isn't the template's).
        canvas: { width: result.canvas.width, height: result.canvas.height },
        aspects,
        keptAudio,
        timelineId,
        name,
        now,
      },
      { item: () => newId<'TimelineItem'>() },
    );
    if (!assembled.ok) return err(assembled.error);
    timelines.push(assembled.value);
  }
  return ok(timelines);
}

/**
 * FRM1-OVL: each new timeline's overlays placed with the people in its clips (placement/run-placement.ts); a
 * slot may be recast from the variant's own alternates when an overlay has no room.
 */
async function placedVariants(
  deps: CastToolDeps,
  timelines: readonly Timeline[],
  found: Found,
  signal: AbortSignal,
): Promise<Result<Timeline[]>> {
  if (!deps.subjects) return ok([...timelines]);
  const out: Timeline[] = [];
  for (const [index, timeline] of timelines.entries()) {
    const variant = found.cast.variants[index];
    const media = new Map(
      (variant?.media ?? []).map((ref) => [
        candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null }),
        ref,
      ]),
    );
    const run = await runPlacement(timeline, found.template, {
      subjects: deps.subjects,
      media: async () => media,
      tau: deps.engine.config.confidence.tau,
      signal,
    });
    const checked = checkEdited(run.timeline);
    if (!checked.ok) return checked;
    out.push(checked.value);
  }
  return ok(out);
}

/** Whether the reel's music can be the default; a store that can't say leaves platform sound, as before REF1. */
async function keepsAudio(templates: TemplateReader, template: Template): Promise<boolean> {
  const kept = templates.keptAudio ? await templates.keptAudio(template.id) : ok(false);
  return kept.ok && kept.value;
}

const lowConfidence = (result: CastResult): number =>
  result.variants.reduce((sum, variant) => sum + variant.slots.filter((slot) => slot.needsRerank).length, 0);

/** FIX-TRIM: assembly's step that chooses each pick's in-point again with the person in its shot. */
function withPerson(deps: CastToolDeps, template: Template, signal: AbortSignal): CastRefiner | undefined {
  const { subjects, engine } = deps;
  if (!subjects || !engine.profiles) return undefined;
  const profiles = engine.profiles.bind(engine);
  return async (cast, budgetMs) => {
    const done = await personInPoints(
      { subjects, profiles },
      template,
      cast,
      engine.config,
      budgetMs,
      Date.now,
      signal,
    );
    const { report } = done;
    if (report.moved > 0 || !report.tracks.done)
      console.warn(
        `[timeline] in-points with the person: ${report.moved} of ${report.clips} clips moved in ${report.ms} ms` +
          (report.tracks.done ? '' : ` (tracks: ${report.tracks.reason})`),
      );
    return done.cast;
  };
}

function assembleTool(deps: CastToolDeps): AnyTool {
  const tool = defineTool({
    name: 'timeline.assemble',
    version: '1.1.0',
    description:
      "Casts again (deterministic for the same library) and assembles one timeline per variant: every cut on the template's beat, transitions from the template, the overlays with `texts` where given. Creates them in one undoable step. Returns the timeline ids, their revisions and how many slots are under the confidence line.",
    summary: 'Casts and assembles one timeline per variant, in one undoable step.',
    tags: ['assembly', 'variants'],
    input: assembleToolInputSchema,
    output: assembleToolOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: TIMELINE_COMMANDS.create,
    // FIX-GFXWAIT: two minutes to assemble, after the wait for the template's graphics (none when the cast waited).
    timeoutMs: 120_000 + GRAPHICS_WAIT_MAX_MS,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => `timeline.assemble:${sha256(input)}`,
    run: async (input, ctx) => {
      const cast = await castFor(deps, input, ctx.signal, (fraction) => ctx.reportProgress(fraction));
      if (!cast.ok) return cast;
      let found = cast;
      // FRM1-SUB: every pick's subject track before the first draft, then what placement's retime and recast read;
      // and the clips' aspects for reframing. FIX-TRIM: between the two, each pick's in-point with the person.
      if (deps.subjects) {
        const made = await ensureForAssembly(
          deps.subjects,
          cast.value.template,
          cast.value.cast,
          deps.subjectBudgetMs,
          Date.now,
          withPerson(deps, cast.value.template, ctx.signal),
        );
        found = ok({ ...cast.value, cast: made.cast });
        // Only a shortfall is worth a line: placement then reads fewer tracks until the queue catches up.
        for (const [what, report] of [
          ['subject tracks', made.picks],
          ['fallback subject tracks', made.fallbacks],
        ] as const)
          if (!report.done)
            console.warn(
              `[timeline] ${what}: not all of ${report.ranges} ranges after ${report.ms} ms (${report.reason})`,
            );
      }
      const listed = await (deps.timelineStore ?? deps.service)?.listByProject(input.projectId as ProjectId);
      const existing = listed?.ok ? listed.value : [];
      const timelines = assembleVariants(
        input,
        found.value,
        deps.clock.now(),
        await keepsAudio(deps.templates, found.value.template),
        await castAspects(deps.frameSizes, found.value.cast),
        existing,
      );
      if (!timelines.ok) return timelines;
      const placedFirst = await placedVariants(deps, timelines.value, found.value, ctx.signal);
      if (!placedFirst.ok) return placedFirst;
      const filled = await withCompositionFiles(deps.workspace, input.projectId, placedFirst.value);
      for (const warning of filled.warnings) console.warn(`[timeline] ${warning}`);
      const placed = ok(filled.timelines);
      const created = await ctx.dispatch({ projectId: input.projectId, timelines: placed.value });
      if (!created.ok) return created;
      const result = found.value.cast;
      return ok({
        castId: result.castId,
        timelineIds: placed.value.map((timeline) => timeline.id),
        revisions: placed.value.map((timeline) => timeline.revision),
        lowConfidence: lowConfidence(result),
        ...(result.variantsShort ? { variantsShort: result.variantsShort } : {}),
        // FIX-GFXWAIT: the graphics it waited for, and the overlays left without a design (graphics.design makes them).
        ...(found.value.graphics ? { graphics: found.value.graphics } : {}),
      });
    },
  });
  return tool as AnyTool;
}

export function castTools(deps: CastToolDeps): AnyTool[] {
  return [castTool(deps), assembleTool(deps)];
}

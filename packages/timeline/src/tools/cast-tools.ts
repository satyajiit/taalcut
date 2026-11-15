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
  keepsReelFootage,
  NO_TOOL_RETRY,
  ok,
  rationalTimeSchema,
  TIMELINE_COMMANDS,
  type AnyTool,
  type AsyncResult,
  type ProjectId,
  type Result,
  type SubjectSource,
  type Template,
  type Timeline,
  type TimelineStore,
} from '@taalcut/core';
import { personInPoints } from '../assembly/person-in-points';
import { castAspects, ensureForAssembly, type CastRefiner, type SubjectDeps } from '../assembly/subjects';
import { runPlacement } from '../assembly/placement/run-placement';
import { withCompositionFiles, type CompositionFiles } from '../assembly/composition-files';
import { checkEdited } from '../model/validate';
import type { CastingEngine, CastRequest, CastResult } from '../casting/engine';
import type { TimelineService } from '../service/service';
import type { TemplateReader } from '../service/templates';
import { assembleVariants } from './assemble-variants';
import { castAnswer, placedParts } from './cast-answer';
import { sha256 } from './hash';
import { GRAPHICS_WAIT_MAX_MS, type GraphicsReady, type GraphicsWait } from './graphics-wait';
import { landMoments, momentsOf } from './landed-moments';
import { assemblyMoments, withCastMoments } from './moment-answers';
import { rerankMaterial, type ShotDescriptions } from './rerank-material';
import { reelFor, type ReelDeps } from './reel-source';
import { partProfiles } from './shot-moments';
import {
  assembleToolInputSchema,
  assembleToolOutputSchema,
  castToolInputSchema,
  castToolOutputSchema,
  type CastToolInput,
} from './schemas';

export interface CastToolDeps extends SubjectDeps, ReelDeps {
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
    // MOM1: the part of a shot the model states for a slot; casting chooses the window inside it.
    ...(input.parts ? { parts: input.parts } : {}),
  };
  const cast = await deps.engine.cast(request, signal);
  if (!cast.ok) return cast;
  // MATCH1: each stated moment's in-point, where that shot fills that slot.
  const landed = landMoments(cast.value, template.value, momentsOf(template.value, input.parts));
  return ok({ template: template.value, cast: landed, ...(graphics ? { graphics } : {}) });
}

function castTool(deps: CastToolDeps): AnyTool {
  const tool = defineTool({
    name: 'timeline.cast',
    // 1.3.0 (MOM1): `parts`, the rerank candidates' moments, and playsShotFrom on the slots they are for.
    // 1.4.0 (MOM2): handling stretches marked in the rerank lists; a part stated inside one answers `handling`
    // (the Librarian's prompt says what that is: its window has no room for the words here too).
    // 1.5.0 (KEEP1): a slot that keeps the reel's own footage is noted `reelKept`, with no pick, and the answer
    // says what that is (`reelKept`, only then: a cast without one pays no words for it, here or in the prompt).
    // 1.6.0 (MATCH1): the answer lists the slots whose template states a moment that must land on their start or
    // end (`lands`, with how to find the instant and state it: only when there is one). The instant is stated as
    // that slot's part (its `to` for the slot's end, its `from` for its start), the clip is placed on it, and the
    // slot says what became of it (`moment`). The inputs and the description are 1.5.0's: the window has no room.
    version: '1.6.0',
    description:
      "Casts the user's library into a template: per slot a pick, three alternates and a confidence, for 1–10 variants that differ in at least 30% of picks and in the hook. Mode \"story\" orders the brief's shots by capture time instead. Changes nothing; the full result is an artifact. `rerank` lists up to three unsure slots with what each candidate shows, its moments (what it shows from when to when, in seconds of its file) after its description: to rerank, pass their order to timeline.assemble as `rerank`. A shot shows different things over its length: `parts` names the stretch of a shot a slot should play ({slotId, shotId, from, to} in those seconds), the one whose moment fits what the slot asks for; the clip's window is chosen inside it. A slot listed in `rerank`, or with a part, says where its pick plays its shot from (playsShotFrom) and what became of the part.",
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
        ...(deps.engine.profiles ? { profiles: deps.engine.profiles.bind(deps.engine) } : {}),
      });
      const { config } = deps.engine;
      // MOM2: the stated parts' shots, for a part set aside as a handling stretch.
      const stated = await partProfiles(deps.engine.profiles?.bind(deps.engine), input.parts, ctx.signal);
      const said = castAnswer(
        result,
        template,
        config,
        input.parts,
        artifact.value,
        rerank,
        graphics,
        stated,
      );
      return ok(withCastMoments(said, result, template, input.parts));
    },
  });
  return tool as AnyTool;
}

/**
 * TXT1: each new timeline's text as the reel had it and its clips' subject tracks asked for, not waited for
 * (placement/run-placement.ts): the tools that say what is under a text read them.
 */
function placedVariants(
  deps: CastToolDeps,
  timelines: readonly Timeline[],
  found: Found,
): Result<Timeline[]> {
  if (!deps.subjects) return ok([...timelines]);
  const out: Timeline[] = [];
  for (const timeline of timelines) {
    const checked = checkEdited(runPlacement(timeline, found.template, { subjects: deps.subjects }));
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
function withPerson(
  deps: CastToolDeps,
  template: Template,
  parts: CastRequest['parts'],
  signal: AbortSignal,
): CastRefiner | undefined {
  const { subjects, engine } = deps;
  if (!subjects || !engine.profiles) return undefined;
  const profiles = engine.profiles.bind(engine);
  // MOM1: the slots with what each states embedded, and the parts the model stated, which the step keeps.
  const slotSpecs = engine.slotSpecs?.bind(engine);
  return async (cast, budgetMs) => {
    const done = await personInPoints(
      { subjects, profiles, ...(slotSpecs ? { slotSpecs } : {}), ...(parts ? { parts } : {}) },
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
    // 1.2.0 (MOM1): `parts`, and what became of each.
    // 1.3.0 (MOM2): a part stated inside a handling stretch is reported `handling`.
    // 1.4.0 (KEEP1): slots that keep the reel's own footage are filled from the template's reel (`reelSlots`).
    // 1.5.0 (MATCH1): a part stated for a slot whose template says a moment lands on its edge puts that instant on
    // the edge, and the answer says what became of each (`moments`) and which slots still ask for one (`lands`);
    // a kept reel clip beside a dissolve or a fade starts clear of the blended frames, with the transition drawn
    // again (`reelBlends`). The inputs and the description are 1.4.0's.
    version: '1.5.0',
    description:
      "Casts again (deterministic for the same library) and assembles one timeline per variant: every cut on the template's beat, transitions from the template, the overlays with `texts` where given. Creates them in one undoable step. `parts` names the stretch of a shot a slot plays ({slotId, shotId, from, to} in seconds of the shot's file, as its moments give them): the clip's window is chosen inside it, made just long enough when the stretch is shorter than the slot. Returns the timeline ids, their revisions, how many slots are under the confidence line and, for each stated part, where its clip plays from and whether the part was kept.",
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
      // FRM1-SUB: every pick's subject track before the first draft, and the clips' aspects for reframing.
      // FIX-TRIM: then each pick's in-point with the person.
      if (deps.subjects) {
        const refine = withPerson(deps, cast.value.template, input.parts, ctx.signal);
        const stated = momentsOf(cast.value.template, input.parts);
        const made = await ensureForAssembly(
          deps.subjects,
          cast.value.template,
          cast.value.cast,
          deps.subjectBudgetMs,
          Date.now,
          // MATCH1: a stated moment's in-point stands after the step with the person.
          refine && (async (given, ms) => landMoments(await refine(given, ms), cast.value.template, stated)),
        );
        found = ok({ ...cast.value, cast: made.cast });
        // Only a shortfall is worth a line: fewer tracks are read until the queue catches up.
        if (!made.picks.done)
          console.warn(
            `[timeline] subject tracks: not all of ${made.picks.ranges} ranges after ${made.picks.ms} ms (${made.picks.reason})`,
          );
      }
      const listed = await (deps.timelineStore ?? deps.service)?.listByProject(input.projectId as ProjectId);
      const existing = listed?.ok ? listed.value : [];
      // KEEP1: the template's reel, for the slots that keep its footage (none: nothing is read).
      const reel = await reelFor(deps, found.value.template, input.projectId as ProjectId, ctx.runId ?? null);
      if (!reel.ok) return reel;
      const timelines = assembleVariants(
        input,
        found.value,
        deps.clock.now(),
        await keepsAudio(deps.templates, found.value.template),
        await castAspects(deps.frameSizes, found.value.cast),
        existing,
        reel.value,
      );
      if (!timelines.ok) return timelines;
      const placedFirst = placedVariants(deps, timelines.value, found.value);
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
        ...(reel.value
          ? { reelSlots: found.value.template.slots.filter(keepsReelFootage).map((slot) => slot.id) }
          : {}),
        // MOM1: what became of each part the model stated. MOM2: `handling` for one set aside as a handling stretch.
        ...(input.parts && input.parts.length > 0
          ? {
              parts: placedParts(placed.value, input.parts, {
                profiles: await partProfiles(
                  deps.engine.profiles?.bind(deps.engine),
                  input.parts,
                  ctx.signal,
                ),
                config: deps.engine.config.inPoint.handling,
              }),
            }
          : {}),
        ...assemblyMoments(placed.value, found.value.template, input.parts, reel.value !== undefined),
      });
    },
  });
  return tool as AnyTool;
}

export function castTools(deps: CastToolDeps): AnyTool[] {
  return [castTool(deps), assembleTool(deps)];
}

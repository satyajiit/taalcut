// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Librarian (P2-M3, M12) and Editor (P2-M4) skills: data the agent runs
 * (agent SPEC 11–12). Each verify is the deterministic second method over the
 * stored timelines; each card is the step's live card.
 */
import {
  defineSkill,
  defineSkillModule,
  err,
  FORMAT_IDS,
  ok,
  type AsyncResult,
  type SkillModule,
  type SkillVerdict,
  type Timeline,
  type TimelineId,
  ulidSchema,
  ValidationError,
} from '@taalcut/core';
import { z } from 'zod';
import { CASTING_CONFIG, type CastingConfig } from '../casting/config';
import { candidateKey } from '../model/cast';

import type { TimelineService } from '../service/service';
import type { TemplateReader } from '../service/templates';
import { droppedUserPicks, type DroppedPick } from './kept-picks';
import { lowConfidenceSlots, rerankedSlots } from './librarian-settle';
import { editorSkill, type EditorSkillDeps } from './editor-skill';
import { MAKER_SKILL_ID, makerSkill, type MakerSkillDeps } from './maker-skill';
import { LIBRARIAN_PROMPT } from './prompts';

export { editorInputSchema, editorOutputSchema } from './editor-skill';

export interface TimelineSkillDeps {
  /** `listByProject` finds the earlier timelines whose user choices a re-cast must keep. */
  readonly service: Pick<TimelineService, 'read' | 'listByProject'>;
  readonly templates: TemplateReader;
  readonly config?: CastingConfig;
  /** EDT1: the generation families (music, sfx, voice) the composition offers the Editor; absent, none. */
  readonly editorFamilies?: EditorSkillDeps['families'];
  readonly editorCapabilities?: EditorSkillDeps['capabilities'];
  /** EDT1-OPS: the clips' numbering the tools share (`clipNumberingOf` the store), for the Editor's check. */
  readonly numbering?: EditorSkillDeps['numbering'];
  /** AGT2: the Maker, over the tools registered here (maker-skill.ts). Absent: no Maker, and flows keep the Editor. */
  readonly maker?: Omit<MakerSkillDeps, 'service'>;
}

const projectId = ulidSchema('Project');
const timelineId = ulidSchema('Timeline');

export const librarianInputSchema = z
  .object({
    projectId,
    templateId: ulidSchema('Template').optional(),
    brief: z
      .object({
        text: z.string().trim().min(1).max(4000),
        formatId: z.enum(FORMAT_IDS).optional(),
        targetSeconds: z.int().min(6).max(120).optional(),
      })
      .optional(),
    variants: z.int().min(1).max(10).optional(),
  })
  .refine((input) => (input.templateId === undefined) !== (input.brief === undefined), {
    message: 'Exactly one of templateId and brief',
  });

export const librarianOutputSchema = z.object({
  /** The template cast: the one given, or the one templates.planFromFormat made for a brief. The Editor's input. */
  templateId: ulidSchema('Template').describe(
    'The template you cast (given, or from templates.planFromFormat)',
  ),
  timelineIds: z.array(timelineId).min(1).max(10),
  /** Each timeline's revision, in the same order. */
  revisions: z.array(z.int().min(1)).min(1).max(10),
  lowConfidenceSlots: z.int().nonnegative(),
  reranked: z.int().nonnegative(),
});

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

/**
 * A handed-off timeline that can't be read. 0.1.0's installed run: the 4B handed off the cast's id, and
 * "timeline.not_found" alone sent it round again; the note says where a timeline's id comes from.
 */
const unreadable = (code: string): string =>
  code === 'timeline.not_found'
    ? `Can't read a timeline: ${code}. No timeline has that id, and a cast's id is not one: timeline.assemble makes the timelines and returns their timelineIds and revisions. Hand off those.`
    : `Can't read a timeline: ${code}.`;

async function readAll(deps: TimelineSkillDeps, ids: readonly TimelineId[]): AsyncResult<Timeline[]> {
  const out: Timeline[] = [];
  for (const id of ids) {
    const timeline = await deps.service.read(id);
    if (!timeline.ok) return timeline;
    out.push(timeline.value);
  }
  return ok(out);
}

/**
 * The Librarian's second method: the cast as stored, checked against the handoff and the casting rules,
 * and against the user's choices in the earlier timelines (`dropped`, from droppedUserPicks).
 */
export function checkCast(
  timelines: readonly Timeline[],
  output: z.output<typeof librarianOutputSchema>,
  config: CastingConfig,
  dropped: readonly DroppedPick[] = [],
): SkillVerdict {
  if (output.revisions.length !== timelines.length) return retry('Give one revision per timeline, in order.');
  for (const [index, timeline] of timelines.entries()) {
    if (timeline.template && timeline.template.id !== output.templateId)
      return retry(
        `Timeline ${timeline.id} was cast from template ${timeline.template.id}; hand off that templateId.`,
      );
    if (timeline.revision !== output.revisions[index])
      return retry(
        `Timeline ${timeline.id} is at revision ${timeline.revision}; hand off the current revisions.`,
      );
    if (!timeline.cast) return { verdict: 'fail', reason: `Timeline ${timeline.id} has no cast.` };
    const unfilled = timeline.cast.slots.filter((slot) => !slot.pick && slot.note !== 'noCandidates');
    if (unfilled.length > 0)
      return retry(`${unfilled.length} slot(s) have no pick and no reason; cast again.`);
  }
  const low = lowConfidenceSlots(timelines);
  if (low !== output.lowConfidenceSlots)
    return retry(`${low} slot(s) are under the confidence line, not ${output.lowConfidenceSlots}.`);
  // AGT2: the slots the assembly reordered by the handed-off rerank are marked so in the stored cast; a handoff
  // that says otherwise (a rerank claimed, or one done and not counted) is sent back with the stored count.
  const reranked = rerankedSlots(timelines);
  if (reranked !== output.reranked)
    return retry(
      `${reranked} slot(s) were reranked in the stored cast, not ${output.reranked}: hand off that, or assemble again with your rerank.`,
    );
  const picks = timelines.map(
    (timeline) => timeline.cast?.slots.map((slot) => (slot.pick ? candidateKey(slot.pick) : null)) ?? [],
  );
  for (let a = 0; a < picks.length; a++)
    for (let b = a + 1; b < picks.length; b++) {
      const x = picks[a] as (string | null)[];
      const y = picks[b] as (string | null)[];
      const differences = x.filter((key, slot) => key !== y[slot]).length;
      const hookLocked = timelines[a]?.cast?.slots[0]?.note === 'userPick';
      if (differences < Math.ceil(config.variants.minDifference * x.length) || (!hookLocked && x[0] === y[0]))
        return retry(
          `Variants ${a + 1} and ${b + 1} are too alike: assemble them in one timeline.assemble call.`,
        );
    }
  if (dropped.length > 0) {
    const slots = dropped.map((pick) => `${pick.slotId} (timeline ${pick.timelineId})`).join(', ');
    return retry(
      `The user chose the shot in slot(s) ${slots}; this cast replaced it. Read those timelines with timeline.get and pass every locked or userPick clip in locked, then assemble again.`,
    );
  }
  return { verdict: 'pass' };
}

/**
 * The Librarian's tools beyond the timeline family; LRN1-STY adds the two that make a video like a set. No vision:
 * the rerank reads what indexing stored (timeline.cast's rerank), since nothing gives the model a frame to send.
 */
const LIBRARIAN_TOOL_NAMES = [
  'library.search',
  'library.findSimilar',
  'library.getAsset',
  'templates.planFromFormat',
  'templates.styleProfile',
  'templates.useStyleProfile',
];

/** Optional context, breakdown and memory tools the Librarian receives when registered in the composition. */
export const LIBRARIAN_EXTRA_TOOLS = [
  'templates.get',
  'templates.search',
  'templates.list',
  'library.frameAt',
  'library.subjects',
  'memory.recall',
  'memory.remember',
] as const;

/**
 * BRK1-MAKE: the tools that choose or plan another template. A Librarian given one (the paste flow, "Make a video
 * with this") casts that one: on the owner's paste a misread fit made it plan a generic 22-slot video instead.
 */
export const OTHER_TEMPLATE_TOOLS = ['timeline.fitTemplates', 'templates.planFromFormat'] as const;

export function timelineSkillModule(deps: TimelineSkillDeps): SkillModule {
  const config = deps.config ?? CASTING_CONFIG;
  const cardId = (ctx: { flowId: string | null; runId: string }, skill: string) =>
    `step:${ctx.flowId ?? ctx.runId}:${skill}`;

  const librarian = defineSkill({
    id: 'timeline.librarian',
    // 1.6.0 (AGT2): the check holds reranked to the slots the stored cast says were reranked.
    version: '1.6.0',
    labelKey: 'skills.timeline.librarian',
    description:
      "Casts the user's shots into a template (or a brief's format plan), reranks unsure slots, and assembles 1–10 variants.",
    prompt: LIBRARIAN_PROMPT,
    tools: {
      families: ['timeline'],
      names: [
        ...LIBRARIAN_TOOL_NAMES,
        ...(deps.maker?.extendedTools === false
          ? []
          : LIBRARIAN_EXTRA_TOOLS.filter((name) => deps.maker?.registered(name) ?? false)),
      ],
    },
    withheldTools: (input) => (input.templateId ? OTHER_TEMPLATE_TOOLS : []),
    input: librarianInputSchema,
    output: librarianOutputSchema,
    questions: ['variants'],
    // FIX-LIBRARIAN: its longest path (a brief planned or fitted, the question, earlier timelines read, the cast, the
    // assembly, a style set used, the handoff, one check retried) is 10 or 11 turns; 12 leaves one or two for finding
    // a tool. The loop's 10 ended the owner's step after it had assembled.
    limits: { expectedTurns: 6, maxTurns: 12 },
    refs: (output) =>
      output.timelineIds.map((id, index) => ({
        entity: 'timeline',
        id,
        version: output.revisions[index] ?? 1,
      })),
    async verify(output) {
      const timelines = await readAll(deps, output.timelineIds);
      if (!timelines.ok) return ok(retry(unreadable(timelines.error.code)));
      const projectId = timelines.value[0]?.projectId;
      const dropped = projectId ? await droppedUserPicks(deps.service, projectId, timelines.value) : ok([]);
      if (!dropped.ok) return ok(retry(`Can't read the project's earlier timelines: ${dropped.error.code}.`));
      return ok(checkCast(timelines.value, output, config, dropped.value));
    },
    async card(output, ctx) {
      const timelines = await readAll(deps, output.timelineIds);
      if (!timelines.ok) return timelines;
      const [first] = timelines.value;
      if (!first) return err(ValidationError({ field: 'timelineIds' }));
      return ok({
        type: 'castBoard',
        id: cardId(ctx, 'timeline.librarian'),
        version: 1,
        runId: ctx.runId,
        projectId: first.projectId,
        castId: first.cast?.castId ?? null,
        timelineIds: output.timelineIds,
        lowConfidence: output.lowConfidenceSlots,
      });
    },
  });

  const editor = editorSkill(
    {
      service: deps.service,
      ...(deps.editorCapabilities ? { capabilities: deps.editorCapabilities } : {}),
      ...(deps.editorFamilies ? { families: deps.editorFamilies } : {}),
      ...(deps.numbering ? { numbering: deps.numbering } : {}),
      // AGT2: the workspace shell's tools join the Editor where registered, as they do the Maker.
      ...(deps.maker
        ? {
            registered: deps.maker.registered,
            ...(deps.maker.extendedTools !== undefined ? { extendedTools: deps.maker.extendedTools } : {}),
          }
        : {}),
    },
    (ctx) => cardId(ctx, 'timeline.editor'),
  );

  const maker = deps.maker
    ? [makerSkill({ service: deps.service, ...deps.maker }, (ctx) => cardId(ctx, MAKER_SKILL_ID))]
    : [];

  return defineSkillModule({ id: 'timeline', skills: [librarian, editor, ...maker] });
}

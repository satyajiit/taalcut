// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: one make case through the model's own loop (render's runDesignerLoop: the tools as an agent step runs
 * them, words alone nudged, the last turn offering only video.done), ended by an accepted video.done. Scored on the
 * timeline it left, with render's slot checks (draft.ts), whether or not it drafted it: slots that match the reel,
 * needs met, faces kept out where the reel hides them, the reel's graphics present and in place, the drafts it took
 * (rounds), whether video.done passed and with how many reasons. Malformed calls are those the loop couldn't run.
 */
import type { QaCheckResult } from '@taalcut/core';
import { runDesignerLoop, SLOT_MATCH, type DesignerCallRecord, type DesignerModel } from '@taalcut/render';
import { MAKER_PROMPT, MAKER_TOOL_NAMES } from '@taalcut/timeline';
import { memoryArtifacts } from '../design/world';
import type { MakeCase } from './cases';
import { LAST_NOTE, makeTask, WORDS_NOTE } from './prompt';
import { makeWorld, type MakeWorld } from './world';

export const MAKE_MAX_TURNS = 40;
const MALFORMED = new Set(['tools.invalid_input', 'tools.not_found', 'core.validation']);

export interface MakeScore {
  /** Slots with no slot check missing, of those the library can match (a case's `unmatchable` left out). */
  readonly slotsMatched: number;
  readonly slots: number;
  /** Needs met, of the matchable slots' needs. */
  readonly needsMet: number;
  readonly needs: number;
  /** Slots the reel hides a face in that keep it out, of those. */
  readonly facesHidden: number;
  readonly hidden: number;
  readonly graphicsPresent: number;
  readonly graphicsPlaced: number;
  readonly graphics: number;
}

export interface MakeRun {
  readonly caseId: string;
  readonly before: MakeScore;
  readonly after: MakeScore;
  /** render.draft calls that drafted. */
  readonly rounds: number;
  readonly done: boolean;
  /** Slots video.done let stay with a reason: ones no shot can match (right), and ones a shot could (wrong). */
  readonly waivedRight: number;
  readonly waivedWrong: number;
  readonly turns: number;
  readonly calls: number;
  /** Each call in order: its tool, and a refusal's code and first words (for reading a run). */
  readonly called: readonly string[];
  readonly malformed: readonly { readonly tool: string; readonly code: string; readonly detail?: string }[];
  readonly stopped: string;
  readonly said: string;
  readonly error?: string;
}

const slotOf = (check: QaCheckResult) =>
  check.fixes.flatMap((fix) =>
    fix.kind === 'agent' && typeof fix.params['slot'] === 'number' ? [fix.params['slot']] : [],
  );

/** The slot match of a timeline against its reel. */
export async function scoreTimeline(world: MakeWorld): Promise<MakeScore> {
  const { fact, checks } = await world.measure(world.timeline());
  const missing = checks.filter((check) => check.status === 'warn' || check.status === 'fail');
  const missed = new Set(missing.flatMap(slotOf));
  const unmatchable = new Set(world.unmatchable);
  const matchable = fact.slots.filter((slot) => !unmatchable.has(slot.number));
  const hidden = fact.slots.filter((slot) => slot.face.wanted === 'hidden' && slot.face.samples > 0);
  const graphics = missing.find((check) => check.id === 'slotGraphics');
  const misplaced = new Set(
    graphics?.findings.flatMap((finding) => (finding.target?.kind === 'text' ? [finding.target.id] : [])) ??
      [],
  );
  const present = fact.graphics.filter((graphic) => graphic.itemId !== null);
  return {
    slotsMatched: matchable.filter((slot) => !missed.has(slot.number)).length,
    slots: matchable.length,
    needsMet: matchable.reduce((sum, slot) => sum + slot.needs.filter((need) => need.met).length, 0),
    needs: matchable.reduce((sum, slot) => sum + slot.needs.length, 0),
    facesHidden: hidden.filter((slot) => slot.face.shown / slot.face.samples <= SLOT_MATCH.face.hiddenMax)
      .length,
    hidden: hidden.length,
    graphicsPresent: present.length,
    graphicsPlaced: present.filter((graphic) => !misplaced.has(graphic.itemId!)).length,
    graphics: fact.graphics.length,
  };
}

const malformedOf = (calls: readonly DesignerCallRecord[]) =>
  calls.flatMap((call) =>
    !call.ok && call.code && MALFORMED.has(call.code) && call.name !== 'video.done'
      ? [{ tool: call.name, code: call.code, ...(call.detail ? { detail: call.detail.slice(0, 300) } : {}) }]
      : [],
  );

/** The model, or one made for the case's world (the stand-in reads it). */
export type MakeModel = DesignerModel | ((world: MakeWorld) => DesignerModel);

export async function runMakeCase(made: MakeCase, model: MakeModel): Promise<MakeRun> {
  return runMakeWorld(await makeWorld(made), model);
}

/** AGT2: the case's tools the real Maker (timeline.maker) is given, by its own list. */
export const makerTools = (world: Pick<MakeWorld, 'tools'>) =>
  world.tools.filter((tool) => MAKER_TOOL_NAMES.includes(tool.name));

export async function runMakeWorld(world: MakeWorld, model: MakeModel): Promise<MakeRun> {
  const before = await scoreTimeline(world);
  const loop = await runDesignerLoop({
    model: typeof model === 'function' ? model(world) : model,
    // AGT2: the real Maker's prompt and tool list (timeline.maker), over the case's tools.
    tools: makerTools(world),
    system: MAKER_PROMPT,
    task: [{ type: 'text', text: makeTask(world) }],
    dispatch: world.dispatch,
    artifacts: memoryArtifacts(),
    runId: `eval-make-${world.id}`,
    maxTurns: MAKE_MAX_TURNS,
    words: { turns: 3, note: WORDS_NOTE },
    lastTurn: { tools: ['video.done'], note: LAST_NOTE },
    endsWith: (call) => call.name === 'video.done' && call.ok,
  });
  const done = loop.calls.findLast((call) => call.name === 'video.done' && call.ok);
  const waived = (done?.output as { waived?: readonly number[] } | undefined)?.waived ?? [];
  const unmatchable = new Set(world.unmatchable);
  return {
    caseId: world.id,
    before,
    after: await scoreTimeline(world),
    rounds: loop.calls.filter((call) => call.name === 'render.draft' && call.ok).length,
    done: !!done,
    waivedRight: waived.filter((slot) => unmatchable.has(slot)).length,
    waivedWrong: waived.filter((slot) => !unmatchable.has(slot)).length,
    turns: loop.turns,
    calls: loop.calls.length,
    called: loop.calls.map(
      (call) => `${call.name}${call.ok ? '' : ` ✗ ${call.code ?? ''}: ${(call.detail ?? '').slice(0, 160)}`}`,
    ),
    malformed: malformedOf(loop.calls),
    stopped: loop.stopped,
    said: loop.text.trim().slice(0, 400),
    ...(loop.error ? { error: `${loop.error.code} ${loop.error.detail ?? ''}`.trim() } : {}),
  };
}

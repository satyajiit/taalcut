// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-T5: the Analyst skill's declaration, its second method (verify) and its card, without a model. */
import { describe, expect, it } from 'vitest';
import {
  cardSchema,
  err,
  newId,
  NotFoundError,
  ok,
  skillModuleProblems,
  type ExperimentId,
  type RunId,
  type SkillContext,
  type Template,
} from '@taalcut/core';
import {
  ANALYST_MAX_TURNS,
  ANALYST_TOOLS,
  analystInputSchema,
  analystSkill,
  analystTurns,
  JUDGED_DISPUTES,
  LONG_REEL_SLOTS,
  slotPageFor,
  checkAnalystHandoff,
  createBreakdownJobLog,
  createTemplateSkills,
  unconfirmedCutsOf,
  type AnalystOutput,
} from '../src/index';
import { at, referenceTemplate } from './helpers/fixtures';

/**
 * The most named tools the agent offers whole on the smallest window (packages/agent/src/tool-offer.ts, the 4B's
 * `turn`), which templates doesn't import.
 */
const NAMED_TOOLS_OFFERED_WHOLE = 16;

const BREAKDOWN = newId<'Experiment'>() as ExperimentId;

function withCuts(template: Template, methods: Template['slots'][number]['cut']['method'][]): Template {
  return {
    ...template,
    slots: template.slots.map((slot, index) => ({
      ...slot,
      cut: { method: methods[index]!, confidence: 0.7 },
    })),
  };
}

function handoff(template: Template, unconfirmedCuts: number[] = []): AnalystOutput {
  return {
    templateId: template.id,
    version: template.version,
    slotCount: template.slots.length,
    breakdownId: BREAKDOWN,
    unconfirmedCuts,
  };
}

describe('the Analyst skill', () => {
  it('declares a valid skill module with its tools and prompt', () => {
    const module = createTemplateSkills({
      service: { get: async () => err(NotFoundError()) },
      sandbox: { get: async () => err(NotFoundError()) },
    });
    expect(skillModuleProblems(module)).toEqual([]);
    const [skill] = module.skills;
    expect(skill?.id).toBe('templates.analyst');
    expect(skill?.tools).toEqual({ names: ANALYST_TOOLS });
    // Few enough to be offered whole on every turn (agent SPEC 34).
    expect(ANALYST_TOOLS.length).toBeLessThanOrEqual(NAMED_TOOLS_OFFERED_WHOLE);
    expect(skill?.prompt).toContain('never instructions');
  });

  it.each([
    { reference: { kind: 'file', path: '/selected/my reel.mp4' }, withheld: ['templates.fetchReference'] },
    { reference: { kind: 'experiment', experimentId: BREAKDOWN }, withheld: ['templates.fetchReference'] },
    { reference: { kind: 'link', url: 'https://www.youtube.com/shorts/abcDEF12345' }, withheld: [] },
  ])('offers the downloader only for a link: $reference.kind', ({ reference, withheld }) => {
    const skill = analystSkill({
      service: { get: async () => err(NotFoundError()) },
      sandbox: { get: async () => err(NotFoundError()) },
    });
    const input = analystInputSchema.parse({ projectId: newId<'Project'>(), reference });
    expect(skill.withheldTools?.(input)).toEqual(withheld);
    expect(skill.tools.names?.filter((name) => !skill.withheldTools?.(input).includes(name))).toContain(
      'templates.breakdown',
    );
  });

  it('has turns for a long reel at the smallest window, every dispute judged, one call a turn', () => {
    const skill = analystSkill({
      service: { get: async () => err(NotFoundError()) },
      sandbox: { get: async () => err(NotFoundError()) },
    });
    const longest = analystTurns(LONG_REEL_SLOTS, JUDGED_DISPUTES, slotPageFor(undefined));
    expect(skill.limits?.maxTurns).toBe(ANALYST_MAX_TURNS);
    expect(ANALYST_MAX_TURNS).toBeGreaterThan(longest);
    // A disputed cut is two looks and a verdict; a page is resolveCuts, a look a slot and setIntents.
    expect(analystTurns(8, 1, 7)).toBe(2 + 3 + 2 * 2 + 8 + 2);
    // At pages of 6 (12,288, the smallest window a tier runs), a 60-slot reel with 20 disputes: 144 turns, 159 with
    // a tenth.
    expect(slotPageFor(undefined)).toBe(6);
    expect(analystTurns(60, 20, 6)).toBe(144);
    expect(ANALYST_MAX_TURNS).toBe(159);
  });

  it('passes a complete handoff', () => {
    const template = referenceTemplate();
    expect(checkAnalystHandoff(handoff(template), template, true)).toEqual({ verdict: 'pass' });
  });

  it('wants every cut only one method found declared (±2 frames)', () => {
    const template = withCuts(referenceTemplate(), ['rule', 'scdet', 'both', 'rule']);
    expect(unconfirmedCutsOf(template)).toEqual([30, 90]);
    const missing = checkAnalystHandoff(handoff(template, [30]), template, true);
    expect(missing).toMatchObject({ verdict: 'retry' });
    expect(missing.verdict === 'retry' && missing.reason).toContain('frames 90');
    expect(checkAnalystHandoff(handoff(template, [31, 89]), template, true)).toEqual({ verdict: 'pass' });
  });

  it('fails a template with a slot the agent may still write and has no intent or shot type', () => {
    const base = referenceTemplate();
    const pending = { ...base.slots[2]!.intent, source: 'pending' as const, text: '' };
    const noShot = { ...base.slots[3]!.intent, shotType: null };
    const template: Template = {
      ...base,
      slots: base.slots.map((slot, index) =>
        index === 2 ? { ...slot, intent: pending } : index === 3 ? { ...slot, intent: noShot } : slot,
      ),
    };
    const verdict = checkAnalystHandoff(handoff(template), template, true);
    expect(verdict.verdict === 'fail' && verdict.reason).toContain('Slots 2, 3');
    // FRM1-MOT: no motion is no open slot: the template measures it, and an unsure one is the review's to ask.
    const unmeasured = {
      ...base,
      slots: base.slots.map((slot) => ({ ...slot, intent: { ...slot.intent, motion: null } })),
    };
    expect(checkAnalystHandoff(handoff(unmeasured), unmeasured, true)).toEqual({ verdict: 'pass' });
    // The user approved slot 3 as it is: not the agent's to change.
    const approved = {
      ...template,
      slots: template.slots.map((slot, i) => (i >= 2 ? { ...slot, approved: true } : slot)),
    };
    expect(checkAnalystHandoff(handoff(approved), approved, true)).toEqual({ verdict: 'pass' });
  });

  it('wants the reference gone from scratch and the slot count right', () => {
    const template = referenceTemplate();
    const verdict = checkAnalystHandoff({ ...handoff(template), slotCount: 3 }, template, false);
    expect(verdict.verdict).toBe('retry');
    if (verdict.verdict === 'retry') {
      expect(verdict.reason).toContain('templates.abandonBreakdown');
      expect(verdict.reason).toContain('has 4 slots');
    }
  });

  it('fails a template that did not come from a reference', () => {
    const template: Template = {
      ...referenceTemplate(),
      origin: { kind: 'format', formatId: 'vlog', formatVersion: '1.0.0', brief: null },
    } as Template;
    expect(checkAnalystHandoff(handoff(template), template, true).verdict).toBe('fail');
  });

  it('verify reads the handed-off version and retries when there is none', async () => {
    const template = referenceTemplate();
    const summary = { name: 'x' };
    let present = true;
    const skill = analystSkill({
      service: {
        get: async ({ version }) =>
          version === 1 ? ok({ summary, template } as never) : err(NotFoundError({ entity: 'template' })),
      },
      sandbox: { get: async () => (present ? ok({} as never) : err(NotFoundError())) },
    });
    const ctx: SkillContext = {
      runId: newId<'AgentRun'>() as RunId,
      projectId: null,
      flowId: null,
      stepId: 'analyst',
      signal: new AbortController().signal,
    };
    const wrong = await skill.verify!({ ...handoff(template), version: 2 }, ctx);
    expect(wrong.ok && wrong.value.verdict).toBe('retry');
    // BRK1 gate: a small model handed off before finalising; the retry says what to call, not only what's wrong.
    expect(wrong.ok && wrong.value.verdict === 'retry' && wrong.value.reason).toContain(
      `call templates.finalise with breakdownId ${BREAKDOWN}`,
    );
    const still = await skill.verify!(handoff(template), ctx);
    expect(still.ok && still.value.verdict).toBe('retry');
    present = false;
    const done = await skill.verify!(handoff(template), ctx);
    expect(done.ok && done.value).toEqual({ verdict: 'pass' });

    const card = await skill.card!(handoff(template), ctx);
    expect(card.ok && card.value && cardSchema.safeParse(card.value).success).toBe(true);
    expect(card.ok && card.value).toMatchObject({
      type: 'breakdown',
      stage: 'ready',
      source: { input: 'link', platform: 'reels', duration: at(120) },
      template: { id: template.id, version: 1 },
    });
    expect(skill.refs(handoff(template))).toEqual([{ entity: 'template', id: template.id, version: 1 }]);
  });

  it("shows the breakdown's job on the card, as the tool recorded it when the job was enqueued", async () => {
    const template = referenceTemplate();
    const jobs = createBreakdownJobLog();
    const jobId = newId<'Job'>();
    jobs.record(handoff(template).breakdownId, jobId);
    const skill = analystSkill({
      service: { get: async () => ok({ summary: { name: 'x' }, template } as never) },
      sandbox: { get: async () => err(NotFoundError()) },
      breakdownJobs: jobs,
    });
    const ctx: SkillContext = {
      runId: newId<'AgentRun'>() as RunId,
      projectId: null,
      flowId: null,
      stepId: 'analyst',
      signal: new AbortController().signal,
    };
    const card = await skill.card!(handoff(template), ctx);
    expect(card.ok && card.value).toMatchObject({ type: 'breakdown', jobId });
    expect(cardSchema.safeParse(card.ok ? card.value : null).success).toBe(true);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Librarian and Editor skills: valid metadata, and recorded model turns
 * replayed through the real tools: every call inside the skill's subset, the
 * handoff valid, verify passing (and catching a wrong handoff), the card valid.
 */
import { cardSchema, newId, ok, skillModuleProblems, type AnySkill, type SkillContext } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { EDITOR_REQUEST_PROMPT } from '../src/skills/editor-prompt';
import { MAKER_PROMPT } from '../src/skills/maker-prompt';
import { librarianInputSchema, OTHER_TEMPLATE_TOOLS, timelineSkillModule } from '../src/skills/skills';
import { agentWorld } from './fixtures/agent';
import editorRecording from './fixtures/recorded/editor.json';
import librarianRecording from './fixtures/recorded/librarian.json';

interface Recording {
  readonly turns: readonly { readonly calls: readonly { tool: string; as?: string; input: unknown }[] }[];
}

/** Fills {{name}} and {{call.path.to.value}} from the values seen so far. */
function fill(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const match = /^\{\{([\w.]+)\}\}$/.exec(value);
    if (!match) return value;
    return (match[1] as string)
      .split('.')
      .reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], scope);
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, scope));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, scope)]));
  return value;
}

function allows(skill: AnySkill, tool: string): boolean {
  return (
    (skill.tools.names ?? []).includes(tool) ||
    (skill.tools.families ?? []).includes(tool.split('.')[0] ?? '')
  );
}

async function replay(
  skill: AnySkill,
  recording: Recording,
  world: ReturnType<typeof agentWorld>,
  scope: Record<string, unknown>,
) {
  for (const turn of recording.turns)
    for (const call of turn.calls) {
      const input = fill(call.input, scope);
      if (call.tool === 'handOff') return skill.output.parse(input);
      expect(allows(skill, call.tool), call.tool).toBe(true);
      const result = await world.call(call.tool, input);
      if (!result.ok) throw new Error(`${call.tool}: ${result.error.code}`);
      if (call.as) scope[call.as] = result.value;
    }
  throw new Error('The recording never hands off');
}

function context(world: ReturnType<typeof agentWorld>): SkillContext {
  return {
    runId: newId<'AgentRun'>(),
    projectId: world.projectId,
    flowId: null,
    stepId: 's1',
    signal: new AbortController().signal,
  };
}

describe('timeline skills', () => {
  it('declare valid metadata', () => {
    const { service, templates } = agentWorld();
    const module = timelineSkillModule({ service, templates });
    expect(skillModuleProblems(module)).toEqual([]);
    expect(module.skills.map((skill) => skill.id)).toEqual(['timeline.librarian', 'timeline.editor']);
  });

  it('Librarian: recorded turns cast and assemble, the handoff verifies, the cast board is valid', async () => {
    const world = agentWorld();
    const module = timelineSkillModule({ service: world.service, templates: world.templates });
    const librarian = module.skills[0]!;
    const output = await replay(librarian, librarianRecording, world, {
      projectId: world.projectId,
      templateId: world.template.id,
    });
    expect(await librarian.verify!(output, context(world))).toEqual(ok({ verdict: 'pass' }));
    const card = await librarian.card!(output, context(world));
    expect(card.ok && cardSchema.safeParse(card.value).success).toBe(true);
    expect(card.ok && card.value).toMatchObject({ type: 'castBoard', timelineIds: output.timelineIds });
    expect(librarian.refs(output)).toEqual(
      (output.timelineIds as string[]).map((id) => ({ entity: 'timeline', id, version: 1 })),
    );
    const wrong = await librarian.verify!(
      { ...output, lowConfidenceSlots: (output.lowConfidenceSlots as number) + 1 },
      context(world),
    );
    expect(wrong.ok && wrong.value.verdict).toBe('retry');
    const stale = await librarian.verify!({ ...output, revisions: [2, 1] }, context(world));
    expect(stale.ok && stale.value.verdict).toBe('retry');
    const otherTemplate = await librarian.verify!(
      { ...output, templateId: newId<'Template'>() },
      context(world),
    );
    expect(otherTemplate.ok && otherTemplate.value).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('templateId'),
    });
    // AGT2: a rerank the stored cast doesn't show is sent back with the stored count.
    const claimed = await librarian.verify!(
      { ...output, reranked: (output.reranked as number) + 2 },
      context(world),
    );
    expect(claimed.ok && claimed.value).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining(
        `${output.reranked as number} slot(s) were reranked in the stored cast`,
      ),
    });
  });

  it('Librarian: refuses variants that are too alike, and has no paid tools to estimate', async () => {
    const world = agentWorld();
    const module = timelineSkillModule({ service: world.service, templates: world.templates });
    const librarian = module.skills[0]!;
    const one = await world.call('timeline.assemble', {
      projectId: world.projectId,
      template: { id: world.template.id },
    });
    if (!one.ok) throw new Error(one.error.code);
    const again = await world.call('timeline.assemble', {
      projectId: world.projectId,
      template: { id: world.template.id },
    });
    if (!again.ok) throw new Error(again.error.code);
    const ids = [...(one.value.timelineIds as string[]), ...(again.value.timelineIds as string[])];
    const verdict = await librarian.verify!(
      {
        templateId: world.template.id,
        timelineIds: ids,
        revisions: [1, 1],
        lowConfidenceSlots: 2 * (one.value.lowConfidence as number),
        reranked: 0,
      },
      context(world),
    );
    expect(verdict.ok && verdict.value.verdict).toBe('retry');
    // FIX-LIBRARIAN: the rerank reads stored descriptions, so no frame goes to a vision model and only turns cost.
    expect(librarian.estimate).toBeUndefined();
    expect(allows(librarian, 'vision.describeFrame')).toBe(false);
    expect(librarian.input.safeParse({ projectId: world.projectId }).success).toBe(false);
  });

  it('Editor: recorded turns rewrite the text, the handoff verifies, an off-beat cut is sent back', async () => {
    const world = agentWorld({
      slots: 4,
      perSlot: 4,
      distractors: 10,
      seed: 43,
      overlays: [{ start: 0, frames: 30, text: 'POV: you finally went', slot: 0 }],
    });
    const module = timelineSkillModule({ service: world.service, templates: world.templates });
    const editor = module.skills[1]!;
    const assembled = await world.call('timeline.assemble', {
      projectId: world.projectId,
      template: { id: world.template.id },
    });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const timelineId = (assembled.value.timelineIds as string[])[0]!;
    const output = await replay(editor, editorRecording, world, { projectId: world.projectId, timelineId });
    expect(output).toEqual({ timelineId, revision: 2 });
    expect(await editor.verify!(output, context(world))).toEqual(ok({ verdict: 'pass' }));
    const text = world.store.docs.get(timelineId)!.tracks.find((track) => track.kind === 'text');
    expect(text?.kind === 'text' && text.items[0]).toMatchObject({ text: 'Goa, finally', origin: 'editor' });
    const card = await editor.card!(output, context(world));
    expect(card.ok && cardSchema.safeParse(card.value).success).toBe(true);

    const doc = world.store.docs.get(timelineId)!;
    const video = doc.tracks[0]!;
    if (video.kind !== 'video') throw new Error('no V1');
    const items = video.items.map((item, index) =>
      index === 1 && item.type === 'clip' && item.beatAnchor
        ? { ...item, beatAnchor: { ...item.beatAnchor, beatIndex: item.beatAnchor.beatIndex + 3 } }
        : item,
    );
    world.store.docs.set(timelineId, { ...doc, tracks: [{ ...video, items }, ...doc.tracks.slice(1)] });
    const off = await editor.verify!(output, context(world));
    expect(off.ok && off.value.verdict).toBe('retry');
  });

  it('Librarian: given a template, it has no tool to choose or plan another; given a brief, it has both (BRK1-MAKE)', () => {
    const world = agentWorld();
    const [librarian] = timelineSkillModule({ service: world.service, templates: world.templates }).skills;
    if (!librarian?.withheldTools) throw new Error('the Librarian withholds nothing');
    const given = librarian.input.parse({ projectId: world.projectId, templateId: world.template.id });
    expect(librarian.withheldTools(given)).toEqual(['timeline.fitTemplates', 'templates.planFromFormat']);
    const brief = librarian.input.parse({
      projectId: world.projectId,
      brief: { text: 'A 30 s vlog of my trip' },
    });
    expect(librarian.withheldTools(brief)).toEqual([]);
    for (const tool of OTHER_TEMPLATE_TOOLS) expect(allows(librarian, tool)).toBe(true);
  });

  it('Editor: asked to clean up, it may plan and apply a talking-head cleanup', () => {
    const world = agentWorld();
    const [, editor] = timelineSkillModule({ service: world.service, templates: world.templates }).skills;
    if (!editor) throw new Error('no editor');
    const input = {
      projectId: world.projectId,
      timelineId: newId<'Timeline'>(),
      templateId: world.template.id,
      cleanup: true,
    };
    expect(editor.input.safeParse(input).success).toBe(true);
    expect(allows(editor, 'timeline.planCleanup')).toBe(true);
    expect(allows(editor, 'timeline.applyCleanup')).toBe(true);
    expect(allows(editor, 'timeline.makeVariants')).toBe(false);
  });

  it('accepts long story briefs up to 4000 chars and aligns Maker/Editor doc topics & TTS fallback', () => {
    const longBrief =
      Array.from({ length: 12 }, (_, i) => `clip_${i + 1}_new_home_progress.mp4`).join(', ') +
      ' — our first own house after 10+ years in a rented house, ground floor completed and first floor under construction, warm emotional pacing '.repeat(
        4,
      );
    expect(longBrief.length).toBeGreaterThan(500);
    expect(longBrief.length).toBeLessThanOrEqual(4000);
    expect(
      librarianInputSchema.safeParse({
        projectId: newId<'Project'>(),
        brief: { text: longBrief, targetSeconds: 30 },
      }).success,
    ).toBe(true);
    expect(MAKER_PROMPT).toContain('taalcut/impeccable-craft');
    expect(MAKER_PROMPT).toContain('taalcut/hallmark-thumbnails');
    expect(MAKER_PROMPT).not.toContain('taalcut/impeccable-motion');
    expect(MAKER_PROMPT).not.toContain('taalcut/hallmark-design');
    expect(MAKER_PROMPT).toContain('models.not_configured');
    expect(EDITOR_REQUEST_PROMPT).toContain('models.not_configured');
  });
});

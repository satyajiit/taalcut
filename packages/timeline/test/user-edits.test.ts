// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A re-run keeps what the user changed (agent SPEC 12–13): timeline.get shows
 * which shots and text the user chose, the skills are told to keep them, and
 * the Librarian's verify sends back a re-cast that dropped a user's swap.
 */
import { newId, ok, type SkillContext, type TimelineId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { EDITOR_PROMPT, LIBRARIAN_PROMPT } from '../src/skills/prompts';
import { timelineSkillModule } from '../src/skills/skills';
import { agentWorld } from './fixtures/agent';

const ui = { source: 'ui', actor: 'user' } as const;

interface GotClip {
  slotId: string;
  assetId: string | null;
  shotId: string | null;
  userPick: boolean;
  sourceStart: { value: number; rate: { num: number; den: number } } | null;
}

async function swappedWorld() {
  const world = agentWorld({ slots: 4, perSlot: 5, distractors: 20, seed: 41, overlays: [{ start: 0, frames: 30, text: 'POV: you finally went', slot: 0 }] });
  const assembled = await world.call('timeline.assemble', { projectId: world.projectId, template: { id: world.template.id } });
  if (!assembled.ok) throw new Error(assembled.error.code);
  const timelineId = (assembled.value.timelineIds as TimelineId[])[0]!;
  const doc = world.store.docs.get(timelineId)!;
  const slot = doc.cast!.slots[1]!;
  const alternate = slot.alternates[0]!;
  const target = { projectId: doc.projectId, timelineId };
  // The user swaps slot 2 on the cast board and rewrites the overlay.
  const swapped = await world.bus.dispatch(
    'timeline.swapClip',
    { ...target, clipId: slot.clipId, media: { assetId: alternate.assetId, shotId: alternate.shotId }, from: 'alternate' },
    ui,
  );
  if (!swapped.ok) throw new Error(swapped.error.code);
  const text = doc.tracks.find((track) => track.kind === 'text');
  const itemId = text?.kind === 'text' ? text.items[0]!.id : '';
  const edited = await world.bus.dispatch('timeline.editText', { ...target, itemId, text: 'Goa with Mum' }, ui);
  if (!edited.ok) throw new Error(edited.error.code);
  return { world, timelineId, slotId: slot.slotId, picked: alternate.shotId };
}

function context(projectId: string): SkillContext {
  return { runId: newId<'AgentRun'>(), projectId: projectId as never, flowId: null, stepId: 's1', signal: new AbortController().signal };
}

describe('a re-run keeps the user’s edits', () => {
  it('timeline.get shows the user’s picks (with their in-points) and who wrote each text', async () => {
    const { world, timelineId, slotId, picked } = await swappedWorld();
    const got = await world.call('timeline.get', { timelineId });
    if (!got.ok) throw new Error(got.error.code);
    const clips = got.value.clips as GotClip[];
    const swapped = clips.find((clip) => clip.slotId === slotId)!;
    expect(swapped).toMatchObject({ shotId: picked, userPick: true });
    expect(swapped.sourceStart).toEqual(expect.objectContaining({ value: expect.any(Number) }));
    expect(clips.filter((clip) => clip.userPick)).toHaveLength(1);
    expect(got.value.texts).toEqual([expect.objectContaining({ text: 'Goa with Mum', origin: 'user' })]);
  });

  it('the Librarian’s verify sends back a re-cast that dropped a user’s swap, and passes one that kept it', async () => {
    const { world, timelineId, slotId, picked } = await swappedWorld();
    const librarian = timelineSkillModule({ service: world.service, templates: world.templates }).skills[0]!;
    const handoff = async (input: Record<string, unknown>) => {
      const made = await world.call('timeline.assemble', { projectId: world.projectId, template: { id: world.template.id }, ...input });
      if (!made.ok) throw new Error(made.error.code);
      const ids = made.value.timelineIds as string[];
      return { templateId: world.template.id, timelineIds: ids, revisions: ids.map(() => 1), lowConfidenceSlots: made.value.lowConfidence as number, reranked: 0 };
    };

    const dropped = await librarian.verify!(await handoff({}), context(world.projectId));
    expect(dropped.ok && dropped.value).toMatchObject({ verdict: 'retry', reason: expect.stringContaining(slotId) });

    const got = await world.call('timeline.get', { timelineId });
    if (!got.ok) throw new Error(got.error.code);
    const locked = (got.value.clips as GotClip[])
      .filter((clip) => clip.userPick)
      .map((clip) => ({ slotId: clip.slotId, assetId: clip.assetId, shotId: clip.shotId, sourceStart: clip.sourceStart }));
    expect(locked.map((lock) => lock.shotId)).toEqual([picked]);
    expect(await librarian.verify!(await handoff({ locked }), context(world.projectId))).toEqual(ok({ verdict: 'pass' }));
  });

  it('the prompts tell the Librarian and the Editor to keep the user’s picks and text', () => {
    expect(LIBRARIAN_PROMPT).toMatch(/userPick/);
    expect(LIBRARIAN_PROMPT).toMatch(/locked/);
    expect(EDITOR_PROMPT).toMatch(/'user' exactly unchanged even for QA/);
    expect(EDITOR_PROMPT).not.toMatch(/Rewrite each on-screen text item for/);
  });
});

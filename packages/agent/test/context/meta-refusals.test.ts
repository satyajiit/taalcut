// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: the planning and artifact tools' refusals teach, or repair the call. MLX1's 4B planned a tool as a skill
 * (templates.fetchReference) and was refused with "No skill …"; its 9B asked readArtifact for a breakdown's id and
 * was told only "No artifact with that id".
 */
import { describe, expect, it } from 'vitest';
import { runMetaTool, type MetaDeps } from '../../src/meta-tools';

const deps = (more: Partial<MetaDeps> = {}): MetaDeps => ({
  registry: { search: () => [], catalogue: () => [] },
  currentPlan: undefined,
  skills: {
    get: (id) => (id === 'templates.analyst' ? {} : undefined),
    list: () => [{ id: 'templates.analyst' }],
  },
  isTool: (name) => name === 'templates.fetchReference' || name === 'handOff',
  ...more,
});
const plan = (skill: string) => ({ steps: [{ text: 'Fetch the reel', skill }] });

describe('updatePlan with a tool as a step’s skill', () => {
  it('keeps the step without one in a skill step and says to call the tool', async () => {
    const outcome = await runMetaTool(
      'updatePlan',
      plan('templates.fetchReference'),
      deps({ skill: 'templates.analyst' }),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.text).toContain('templates.fetchReference is a tool, not a skill');
  });

  it('leaves a skill out of a skill step’s own list, with a note (it would run after the flow with no input)', async () => {
    const outcome = await runMetaTool(
      'updatePlan',
      plan('templates.analyst'),
      deps({ skill: 'timeline.librarian' }),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.text).toContain('templates.analyst is left out of your list');
  });

  it('takes a meta tool named as a skill the same way (b1: the 4B planned handOff)', async () => {
    const outcome = await runMetaTool('updatePlan', plan('handOff'), deps({ skill: 'templates.analyst' }));
    expect(outcome.ok && outcome.text).toContain('handOff is a tool, not a skill');
  });

  it('saves a plain step outside one', async () => {
    const outcome = await runMetaTool('updatePlan', plan('templates.fetchReference'), deps());
    expect(outcome).toMatchObject({ ok: true, steps: [{ id: 's1', text: 'Fetch the reel' }] });
    expect(outcome.ok && outcome.steps?.[0]).not.toHaveProperty('skill');
  });

  it('names the skills there are for a name that is neither', async () => {
    const outcome = await runMetaTool('updatePlan', plan('templates.unknown'), deps());
    expect(outcome).toMatchObject({ ok: false, code: 'agent.skill_not_found' });
    expect(!outcome.ok && outcome.detail).toContain("A step's skill is one of: templates.analyst");
  });
});

describe('readArtifact with an id that is not an artifact', () => {
  const artifacts = { get: async () => ({ ok: false as const, error: { code: 'core.not_found' } }) } as never;
  it('lists the run’s artifacts and where other ids go', async () => {
    const outcome = await runMetaTool(
      'readArtifact',
      { id: '01M69YGPPC8256GYX83TYW96FR' },
      deps({
        artifacts,
        storedArtifacts: () => [{ id: '01ART000000000000000000000', summary: 'The draft' }],
      }),
    );
    expect(outcome).toMatchObject({ ok: false, code: 'core.not_found' });
    const detail = !outcome.ok ? outcome.detail : '';
    expect(detail).toContain('The artifacts this run stored: 01ART000000000000000000000 (The draft)');
    expect(detail).toContain('is not an artifact: pass it to the tool that takes it');
  });

  it('says when the run has stored none', async () => {
    const outcome = await runMetaTool(
      'readArtifact',
      { id: 'frame_0.png' },
      deps({ artifacts, storedArtifacts: () => [] }),
    );
    expect(!outcome.ok && outcome.detail).toContain('This run has stored no artifact');
  });
});

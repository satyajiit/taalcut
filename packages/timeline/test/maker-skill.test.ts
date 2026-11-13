// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: the Maker (`timeline.maker`) owns the make loop with every edit tool, the draft, its QA and the frames. It
 * lists only the tools registered here, so it composes before the eyes and match lanes' tools land and takes them
 * by their fixed names after; its check reads the timeline and, where match composes it, video.done's verdict.
 */
import { newId, ok, unwrap, type AnySkill, type SkillVerifyContext } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { profilesFor } from '../src/commands/resolve';
import {
  AI_CONTEXT_TOOLS,
  WORKSPACE_COMPOSITION_TOOLS,
  WORKSPACE_SHELL_TOOLS,
} from '../src/skills/editor-skill';
import { MAKER_SEAM_TOOLS, MAKER_SKILL_ID, MAKER_TOOL_NAMES } from '../src/skills/maker-skill';
import { MAKER_PROMPT } from '../src/skills/maker-prompt';
import { LIBRARIAN_EXTRA_TOOLS, timelineSkillModule } from '../src/skills/skills';
import { buildTimeline } from './fixtures/timeline';
import { agentWorld } from './fixtures/agent';

/** The tools today's composition registers: everything but the eyes and match lanes' tools. */
const TODAY = (name: string) => !(MAKER_SEAM_TOOLS as readonly string[]).includes(name);

function makerOf(
  registered: (name: string) => boolean,
  done?: Parameters<typeof timelineSkillModule>[0]['maker'],
) {
  const world = agentWorld();
  const module = timelineSkillModule({
    service: world.service,
    templates: world.templates,
    maker: { registered, ...done },
  });
  return module.skills.find((skill) => skill.id === MAKER_SKILL_ID) as AnySkill | undefined;
}

const verifyContext = (input: Record<string, unknown>): SkillVerifyContext<Record<string, unknown>> => ({
  runId: newId<'AgentRun'>(),
  projectId: null,
  flowId: null,
  stepId: 'f3',
  signal: new AbortController().signal,
  input,
});

describe('timeline.maker (AGT2)', () => {
  it('is composed only where the composition asks for it', () => {
    const world = agentWorld();
    const without = timelineSkillModule({ service: world.service, templates: world.templates });
    expect(without.skills.map((skill) => skill.id)).toEqual(['timeline.librarian', 'timeline.editor']);
    expect(makerOf(TODAY)?.version).toBe('1.3.0');
  });

  it('lists the workspace shell where it is registered, for the Maker and the Editor alike', () => {
    const shell = WORKSPACE_SHELL_TOOLS as readonly string[];
    const world = agentWorld();
    const editorOf = (registered: (name: string) => boolean) =>
      timelineSkillModule({
        service: world.service,
        templates: world.templates,
        maker: { registered },
      }).skills.find((skill) => skill.id === 'timeline.editor')!;
    for (const name of shell) {
      expect(makerOf(TODAY)!.tools.names).toContain(name);
      expect(editorOf(TODAY).tools.names).toContain(name);
    }
    const noShell = (name: string) => TODAY(name) && !shell.includes(name);
    expect(makerOf(noShell)!.tools.names?.filter((name) => shell.includes(name))).toEqual([]);
    expect(editorOf(noShell).tools.names?.filter((name) => shell.includes(name))).toEqual([]);
    const plain = timelineSkillModule({ service: world.service, templates: world.templates });
    expect(plain.skills.find((skill) => skill.id === 'timeline.editor')!.tools.names).not.toContain(
      'workspace.exec',
    );
    expect(MAKER_PROMPT).toContain('libopenh264');
  });

  it('keeps recipe reading available without extended composition tools', () => {
    const world = agentWorld();
    const skills = timelineSkillModule({
      service: world.service,
      templates: world.templates,
      maker: { registered: () => true, extendedTools: false },
    }).skills;
    for (const skill of skills.filter((s) => ['timeline.editor', 'timeline.maker'].includes(s.id))) {
      expect(skill.tools.names).toContain('workspace.docs');
      expect(skill.tools.names).not.toContain('workspace.write');
    }
  });

  it('names every edit tool, the draft, QA and the frames, and withholds nothing', () => {
    const maker = makerOf(TODAY)!;
    for (const name of [
      'timeline.swapClip',
      'timeline.slipClip',
      'timeline.setReframe',
      'timeline.setSpeed',
      'timeline.setTransition',
      'timeline.insertClip',
      'timeline.deleteClip',
      'graphics.design',
      'music.setDucking',
      'render.draft',
      'render.getQaReport',
      'timeline.captureFrame',
      'templates.get',
    ])
      expect(maker.tools.names).toContain(name);
    expect(maker.tools.families).toBeUndefined();
    expect(maker.withheldTools).toBeUndefined();
  });

  it('lists the other lanes’ tools only once they are registered, by their fixed names', () => {
    const before = makerOf(TODAY)!;
    for (const name of MAKER_SEAM_TOOLS) expect(before.tools.names).not.toContain(name);
    const after = makerOf(() => true)!;
    expect(after.tools.names).toEqual(MAKER_TOOL_NAMES);
    for (const name of ['video.compare', 'library.frameAt', 'library.subjects', 'video.done'])
      expect(after.tools.names).toContain(name);
    expect(after.prompt).toMatch(/video\.compare/);
    expect(after.prompt).toMatch(/video\.done/);
  });

  it('takes a review’s fixes, many of them, and the cast template', () => {
    const maker = makerOf(TODAY)!;
    const ids = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      templateId: newId<'Template'>(),
    };
    const fixes = Array.from({ length: 20 }, () => ({
      kind: 'agent',
      instructionKey: 'qa.fix.slotNeeds',
      params: { slot: 3, tools: 'timeline.swapClip timeline.slipClip' },
    }));
    expect(maker.input.safeParse({ ...ids, fixes }).success).toBe(true);
  });

  it('checks the handed-off revision, the beats, and match’s done-gate where it is composed', async () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] });
    const service = { read: async () => ok(timeline) };
    const passed: { passed: boolean; reason?: string }[] = [
      { passed: false, reason: 'Slot 2 shows no phone.' },
    ];
    const skill = timelineSkillModule({
      service: { ...agentWorld().service, ...service },
      templates: agentWorld().templates,
      maker: { registered: TODAY, done: async () => ok(passed.shift() ?? { passed: true }) },
    }).skills.find((s) => s.id === MAKER_SKILL_ID)!;
    const ctx = verifyContext({ projectId: timeline.projectId, timelineId: timeline.id });
    const stale = await skill.verify!(
      { timelineId: timeline.id, revision: timeline.revision + 1 } as never,
      ctx,
    );
    expect(stale).toEqual(
      ok({ verdict: 'retry', reason: `The timeline is at revision ${timeline.revision}; hand off that.` }),
    );
    const refused = await skill.verify!(
      { timelineId: timeline.id, revision: timeline.revision } as never,
      ctx,
    );
    expect(refused).toEqual(ok({ verdict: 'retry', reason: 'Slot 2 shows no phone.' }));
    const done = await skill.verify!({ timelineId: timeline.id, revision: timeline.revision } as never, ctx);
    expect(done).toEqual(ok({ verdict: 'pass' }));
  });

  it('gives Maker, Editor and Librarian the extended HyperFrames, breakdown, library and memory tools', () => {
    const world = agentWorld();
    const all = timelineSkillModule({
      service: world.service,
      templates: world.templates,
      maker: { registered: () => true },
    }).skills;
    const librarian = all.find((s) => s.id === 'timeline.librarian')!;
    const editor = all.find((s) => s.id === 'timeline.editor')!;
    const maker = all.find((s) => s.id === MAKER_SKILL_ID)!;

    for (const tool of [...WORKSPACE_COMPOSITION_TOOLS, ...AI_CONTEXT_TOOLS]) {
      expect(maker.tools.names).toContain(tool);
      expect(editor.tools.names).toContain(tool);
    }
    for (const tool of LIBRARIAN_EXTRA_TOOLS) {
      expect(librarian.tools.names).toContain(tool);
    }
  });

  it('offers the complete local cover workflow only where its tools are registered', () => {
    const world = agentWorld();
    const coverTools = ['timeline.setCover', 'render.exportCover'];
    const skills = (registered: (name: string) => boolean) =>
      timelineSkillModule({
        service: world.service,
        templates: world.templates,
        maker: { registered },
      }).skills.filter((skill) => ['timeline.editor', MAKER_SKILL_ID].includes(skill.id));
    for (const skill of skills(() => true)) {
      for (const tool of coverTools) expect(skill.tools.names).toContain(tool);
    }
    for (const skill of skills((name) => !coverTools.includes(name))) {
      for (const tool of coverTools) expect(skill.tools.names).not.toContain(tool);
    }
    const editor = skills(() => true).find((skill) => skill.id === 'timeline.editor')!;
    expect(editor.prompt).toContain('taalcut/hallmark-thumbnails');
    expect(editor.prompt).toContain('revision returned by setCover');
    expect(editor.prompt).toContain('Inspect the saved asset with vision.describeFrame');
    expect(editor.prompt).toContain('no silent art substitution');
  });

  it('profilesFor resolves a whole-video asset ref (shotId: null) against an indexed shot profile', async () => {
    const world = agentWorld();
    const sample = world.profiles[0]!;
    const catalog = createMemoryShotCatalog([sample]);
    const map = unwrap(await profilesFor(catalog, [{ assetId: sample.assetId, shotId: null }]));
    expect(map.get(`asset:${sample.assetId}`)?.assetId).toBe(sample.assetId);
  });
});

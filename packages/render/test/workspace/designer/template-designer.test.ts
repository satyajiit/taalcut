// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer behind tpl's DesignOverlay (HFW1 dsn), with a stand-in model end to end: it starts a composition,
 * writes a fixture design, lints it, draws it over the reel's frame (an image artifact), and ends with design.done;
 * the answer is the gated composition with each overlay's words. A design that doesn't pass the gate can't end the
 * job; a model that gives up says why; the loop shows the newest stills to a model that sees and words to one that
 * doesn't.
 */
import { describe, expect, it } from 'vitest';
import { defineTool, NO_TOOL_RETRY, ok } from '@taalcut/core';
import { z } from 'zod';
import {
  condensed,
  runDesignerLoop,
  type DesignerCall,
  type DesignerMessage,
  type DesignerModel,
} from '../../../src/workspace/designer/loop';
import { templateDesigner } from '../../../src/workspace/designer/template-designer';
import { spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from '../tools/support';
import { call, fixture, frames, jobFor, scripted } from './template-support';

describe('the Designer behind the template’s DesignOverlay', () => {
  it('designs, draws over the reel’s frame and ends with a gated composition and each overlay’s words', async () => {
    const world = workspaceWorld(spokenTimeline([[10, 60, 'made-up words']]), { frames });
    const job = jobFor(world.projectId);
    const html = await fixture();
    const params = Object.fromEntries(
      job.brief.overlays.map((overlay) => [overlay.overlayId, { message: overlay.words }]),
    );
    const { model, seen } = scripted(true, [
      () => call('workspace.new', { projectId: world.projectId, name: 'bubble', seconds: 3 }),
      () => call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: html }),
      () => call('workspace.lint', { projectId: world.projectId, entry: 'bubble/index.html' }),
      (task) =>
        call('workspace.renderOver', {
          projectId: world.projectId,
          entry: 'bubble/index.html',
          seconds: [0.45, 1.5],
          over: 'image',
          imageId: /imageId (\w+)/.exec(task)?.[1],
        }),
      () => call('design.done', { entry: 'bubble/index.html', name: 'Incoming bubble', params }),
    ]);
    const design = templateDesigner({
      model,
      workspace: { store: world.workspace.store, timelines: world.store, frames, now: () => 5 },
      dispatch: async (command, payload) => {
        const done = await world.bus.dispatch(command, payload, { source: 'agent', actor: 'agent:designer' });
        return done.ok ? ok(done.value.result) : done;
      },
      artifacts: world.artifacts,
    });
    const answer = await design(job);
    if (!answer.ok) throw new Error(answer.error.code);
    if (!('designed' in answer.value)) throw new Error(answer.value.reason);
    const { composition, params: values } = answer.value.designed;
    expect(composition).toMatchObject({ version: 1, name: 'Incoming bubble', entry: 'bubble/index.html' });
    expect(composition.gate.passed).toBe(true);
    expect(composition.variables.map((variable) => variable.name)).toContain('message');
    expect(composition.provenance.overlays).toEqual(job.brief.overlays.map((overlay) => overlay.overlayId));
    expect(values).toEqual(params);
    // The task showed the reel's frame as a picture; the turn after the render showed its two stills.
    expect(seen[0]?.[0]?.role === 'user' && seen[0][0].content.some((part) => part.type === 'image')).toBe(
      true,
    );
    const afterRender = seen[4]!.find(
      (message) => message.role === 'tool' && message.name === 'workspace.renderOver',
    );
    expect(
      afterRender?.role === 'tool' && afterRender.content.filter((part) => part.type === 'image'),
    ).toHaveLength(2);
  });

  it('refuses ending on a design the gate refuses, and passes on a model’s reason', async () => {
    const world = workspaceWorld(spokenTimeline([[10, 60, 'made-up words']]), { frames });
    const job = jobFor(world.projectId);
    const bad = (await fixture()).replace(
      "tl.addLabel('enter', 0);",
      "tl.addLabel('enter', 0);\n        fetch('/x');",
    );
    const { model, seen } = scripted(false, [
      () => call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: bad }),
      () => call('design.done', { entry: 'bubble/index.html', name: 'Bubble', params: {} }),
      () => call('design.none', { reason: 'The gate refused every try.' }),
    ]);
    const answer = await templateDesigner({
      model,
      workspace: { store: world.workspace.store, timelines: world.store, frames },
      dispatch: async (command, payload) => {
        const done = await world.bus.dispatch(command, payload, { source: 'agent', actor: 'agent:designer' });
        return done.ok ? ok(done.value.result) : done;
      },
      artifacts: world.artifacts,
    })(job);
    expect(answer.ok && answer.value).toEqual({ reason: 'The gate refused every try.' });
    const refused = seen[2]!.find((message) => message.role === 'tool' && message.name === 'design.done');
    expect(refused?.role === 'tool' && refused.isError).toBe(true);
    // A model that doesn't see images got no pictures, the task's included.
    expect(
      seen
        .flat()
        .some((message) => 'content' in message && message.content.some((part) => part.type === 'image')),
    ).toBe(false);
  });
});

describe('the Designer loop’s history', () => {
  it('keeps the task and the newest messages whole, and cuts an older output and a written file', () => {
    const long = 'x'.repeat(5_000);
    const history: DesignerMessage[] = [
      { role: 'user', content: [{ type: 'text', text: long }] },
      {
        role: 'assistant',
        text: '',
        calls: [{ id: 'a', name: 'workspace.write', arguments: { path: 'a/index.html', text: long } }],
        native: {},
      },
      {
        role: 'tool',
        callId: 'a',
        name: 'workspace.write',
        content: [{ type: 'text', text: long }],
        isError: false,
      },
      ...Array.from({ length: 6 }, (_, index): DesignerMessage => ({
        role: 'tool',
        callId: `n${index}`,
        name: 'workspace.lint',
        content: [{ type: 'text', text: long }],
        isError: false,
      })),
    ];
    const seen = condensed(history);
    const text = (message: DesignerMessage | undefined) =>
      message && message.role !== 'assistant' ? (message.content[0] as { text: string }).text : '';
    expect(text(seen[0])).toHaveLength(5_000);
    const call = seen[1];
    expect(call?.role === 'assistant' && String(call.calls[0]?.arguments.text)).toContain('5000 chars');
    expect(call?.role === 'assistant' && 'native' in call).toBe(false);
    expect(text(seen[2]).length).toBeLessThan(1_300);
    expect(text(seen.at(-1))).toHaveLength(5_000);
  });
});

describe('the Designer loop as a skill step', () => {
  const tool = (name: string) =>
    defineTool({
      name,
      version: '1.0.0',
      description: `${name}.`,
      input: z.object({}),
      output: z.object({}),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1_000,
      retry: NO_TOOL_RETRY,
      run: async () => ok({}),
    });

  it('nudges a model that answers in words, three in a row at most, and offers only the finish on the last turn', async () => {
    const seen: { tools: string[]; last: DesignerMessage | undefined; system: string }[] = [];
    const model = (calls: (turn: number) => DesignerCall[]): DesignerModel => ({
      seesImages: false,
      turn: async (request) => {
        seen.push({
          tools: request.tools.map((entry) => entry.name),
          last: request.messages.at(-1),
          system: request.system,
        });
        return ok({
          text: 'I will design it.',
          calls: calls(seen.length),
          model: 'stand-in/designer',
          local: true,
        });
      },
    });
    const base = {
      tools: [tool('workspace.lint'), tool('design.done')],
      system: 'You design.',
      task: [{ type: 'text' as const, text: 'A made-up job.' }],
      dispatch: async () => ok(null),
      artifacts: workspaceWorld(spokenTimeline([[10, 60, 'made-up words']])).artifacts,
      words: { turns: 3, note: 'Call a tool.' },
    };
    const words = await runDesignerLoop({ ...base, model: model(() => []) });
    expect(words).toMatchObject({ stopped: 'answered', turns: 3 });
    expect(seen[1]?.last).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Call a tool.' }] });
    seen.length = 0;
    const last = await runDesignerLoop({
      ...base,
      model: model(() => [{ id: `c${seen.length}`, name: 'workspace.lint', arguments: {} }]),
      maxTurns: 2,
      lastTurn: { tools: ['design.done'], note: '# Last turn' },
    });
    expect(last.stopped).toBe('turns');
    expect(seen.map((entry) => entry.tools)).toEqual([['workspace_lint', 'design_done'], ['design_done']]);
    expect(seen[1]?.system).toContain('# Last turn');
  });

  it('offers its tools by call names a provider takes, and runs and records a call by either name', async () => {
    const offered: string[][] = [];
    const names = ['workspace_lint', 'workspace.lint', 'workspace_nope'];
    const loop = await runDesignerLoop({
      tools: [tool('workspace.lint'), tool('design.done')],
      system: 'You design.',
      task: [{ type: 'text' as const, text: 'A made-up job.' }],
      dispatch: async () => ok(null),
      artifacts: workspaceWorld(spokenTimeline([[10, 60, 'made-up words']])).artifacts,
      maxTurns: 3,
      model: {
        seesImages: false,
        turn: async (request) => {
          offered.push(request.tools.map((entry) => entry.name));
          const name = names[offered.length - 1]!;
          return ok({
            text: '',
            calls: [{ id: `c${offered.length}`, name, arguments: {} }],
            model: 'stand-in/designer',
            local: true,
          });
        },
      },
    });
    // OpenAI's Responses API takes only ^[a-zA-Z0-9_-]+$ (a dot was a 400 on the ChatGPT plan).
    expect(offered.flat().every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);
    expect(loop.calls.map((call) => [call.name, call.ok, call.code ?? null])).toEqual([
      ['workspace.lint', true, null],
      ['workspace.lint', true, null],
      ['workspace_nope', false, 'core.not_found'],
    ]);
    expect(loop.calls[2]?.detail).toContain('workspace_lint, design_done');
  });

  it('ends on a call it is told ends it, as an agent step ends on its accepted handOff', async () => {
    let turns = 0;
    const loop = await runDesignerLoop({
      tools: [tool('workspace.lint'), tool('design.done')],
      system: 'You design.',
      task: [{ type: 'text' as const, text: 'A made-up job.' }],
      dispatch: async () => ok(null),
      artifacts: workspaceWorld(spokenTimeline([[10, 60, 'made-up words']])).artifacts,
      endsWith: (call) => call.ok && call.name === 'design.done',
      model: {
        seesImages: false,
        turn: async () => {
          turns++;
          const name = turns === 1 ? 'workspace_lint' : 'design_done';
          return ok({
            text: '',
            calls: [{ id: `c${turns}`, name, arguments: {} }],
            model: 'stand-in/designer',
            local: true,
          });
        },
      },
    });
    expect(loop).toMatchObject({ stopped: 'ended', turns: 2 });
    expect(turns).toBe(2);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template Designer's finish (HFW1 tpl): design.done refuses while the entry's last render failed a frame check
 * (typeFloor here) or the reel-match check (off the reel's place, too wide), saying what to change, and takes the
 * design once a render passes; a conversation bubble's answer carries its words' type as drawn.
 */
import { describe, expect, it } from 'vitest';
import { ok, type WorkspaceFramesInput } from '@taalcut/core';
import type { DesignerLoopResult } from '../../../src/workspace/designer/loop';
import { templateDesigner } from '../../../src/workspace/designer/template-designer';
import { spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from '../tools/support';
import { call, fixture, frames, jobFor, scripted } from './template-support';

describe('the template Designer’s finish', () => {
  it('refuses design.done while the entry’s last render failed a frame check, and takes it once a render passes', async () => {
    const world = workspaceWorld(spokenTimeline([[10, 60, 'made-up words']]), { frames });
    const job = jobFor(world.projectId);
    const html = await fixture();
    const params = Object.fromEntries(
      job.brief.overlays.map((overlay) => [overlay.overlayId, { message: overlay.words }]),
    );
    let renders = 0;
    // The first drawing's words are under the floor; the second's are not.
    const checked = async (input: WorkspaceFramesInput) => {
      const drawn = await frames(input);
      renders += 1;
      return renders > 1
        ? drawn
        : ok({
            ...drawn.value,
            checks: [
              {
                id: 'typeFloor',
                status: 'fail' as const,
                detail:
                  'cap height 20.0 px under 36 at 0.45 s. Make the words larger (font-size 52 px or more).',
              },
            ],
          });
    };
    const render = () =>
      call('workspace.render', { projectId: world.projectId, entry: 'bubble/index.html', seconds: [0.45] });
    const done = () => call('design.done', { entry: 'bubble/index.html', name: 'Incoming bubble', params });
    const { model } = scripted(false, [
      () => call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: html }),
      render,
      done,
      render,
      done,
    ]);
    const loops: DesignerLoopResult[] = [];
    const answer = await templateDesigner({
      model,
      workspace: { store: world.workspace.store, timelines: world.store, frames: checked },
      dispatch: async (command, payload) => {
        const ran = await world.bus.dispatch(command, payload, { source: 'agent', actor: 'agent:designer' });
        return ran.ok ? ok(ran.value.result) : ran;
      },
      artifacts: world.artifacts,
      onLoop: (_job, loop) => loops.push(loop),
    })(job);
    const finishes = loops[0]!.calls.filter((entry) => entry.name === 'design.done');
    expect(finishes.map((entry) => entry.ok)).toEqual([false, true]);
    expect(finishes[0]).toMatchObject({ code: 'core.validation' });
    expect(finishes[0]!.detail).toContain('The last render of bubble/index.html failed typeFloor');
    expect(finishes[0]!.detail).toContain('Make the words larger (font-size 52 px or more)');
    expect(answer.ok && 'designed' in answer.value).toBe(true);
  });

  it('refuses design.done off the reel’s place with reelMatch’s fix, and carries a bubble’s drawn type', async () => {
    const world = workspaceWorld(spokenTimeline([[10, 60, 'made-up words']]), { frames });
    const job = jobFor(world.projectId);
    const html = await fixture();
    const params = Object.fromEntries(
      job.brief.overlays.map((overlay) => [overlay.overlayId, { message: overlay.words }]),
    );
    const type = { fontPx: 54, padding: { top: 25, right: 47, bottom: 25, left: 47 } };
    let renders = 0;
    // The first drawing hangs 16 % right of the reel's left edge, two-thirds of the frame wide; then where it is.
    const placed = async (input: WorkspaceFramesInput) => {
      const drawn = await frames(input);
      renders += 1;
      const box = renders === 1 ? { x: 0.22, y: 0.373, width: 0.66, height: 0.06 } : undefined;
      return ok({
        ...drawn.value,
        frames: drawn.value.frames.map((frame) => ({ ...frame, ...(box ? { box } : {}), type })),
      });
    };
    const render = () =>
      call('workspace.render', { projectId: world.projectId, entry: 'bubble/index.html', seconds: [1.5] });
    const done = () => call('design.done', { entry: 'bubble/index.html', name: 'Incoming bubble', params });
    const { model } = scripted(false, [
      () => call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: html }),
      render,
      done,
      render,
      done,
    ]);
    const loops: DesignerLoopResult[] = [];
    const answer = await templateDesigner({
      model,
      workspace: { store: world.workspace.store, timelines: world.store, frames: placed },
      dispatch: async (command, payload) => {
        const ran = await world.bus.dispatch(command, payload, { source: 'agent', actor: 'agent:designer' });
        return ran.ok ? ok(ran.value.result) : ran;
      },
      artifacts: world.artifacts,
      onLoop: (_job, loop) => loops.push(loop),
    })(job);
    const calls = loops[0]!.calls;
    const first = calls.find((entry) => entry.name === 'workspace.render')!;
    expect((first.output as { checks: { id: string; status: string }[] }).checks).toContainEqual(
      expect.objectContaining({ id: 'reelMatch', status: 'fail' }),
    );
    const finishes = calls.filter((entry) => entry.name === 'design.done');
    expect(finishes.map((entry) => entry.ok)).toEqual([false, true]);
    expect(finishes[0]!.detail).toContain('failed reelMatch');
    expect(finishes[0]!.detail).toContain(
      "your left edge is 16% right of the reel's: anchor it at left: 65px",
    );
    if (!answer.ok || !('designed' in answer.value)) throw new Error('no design');
    // An incoming message: its type as drawn, for the reply's brief.
    expect(answer.value.designed.type).toEqual(type);
  });
});

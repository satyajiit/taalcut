// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GFXWAIT: timeline.cast and timeline.assemble wait for a template's graphics still being designed, then read
 * its newest version, so the made video draws them; a cast of a named version, or with nothing being designed,
 * never waits. The wait's outcome (and the overlays left without a design) is in both answers.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '@taalcut/core';
import { memoryTemplateReader } from '../src/service/templates';
import type { GraphicsReady, GraphicsWait } from '../src/tools/graphics-wait';
import { agentWorldOver } from './fixtures/agent';
import { world } from './fixtures/casting';

const DEF = { slots: 4, perSlot: 5, distractors: 20, seed: 41 };

/** A design that lands its template's next version when `land` is called, and the reader that sees it. */
function designing(template: Template, outcome: GraphicsWait) {
  const versions: Template[] = [template];
  let land: () => void = () => {};
  const landed = new Promise<void>((resolve) => (land = resolve));
  const asked: string[] = [];
  const graphicsReady: GraphicsReady = async (templateId) => {
    asked.push(templateId);
    if (versions.length > 1) return null;
    await landed;
    return outcome;
  };
  const reader = {
    read: (ref: { id: Template['id']; version?: number }) => memoryTemplateReader(versions).read(ref),
  };
  return {
    graphicsReady,
    reader,
    asked,
    land: () => {
      versions.push({ ...template, version: template.version + 1 });
      land();
    },
  };
}

const DESIGNED: GraphicsWait = { status: 'designed', waitedMs: 1200, designed: 2, total: 2, missing: [] };

describe('a make waits for the template’s graphics being designed (FIX-GFXWAIT)', () => {
  it('assembles from the version the design set, and says how the wait went', async () => {
    const cast = world(DEF);
    const design = designing(cast.template, DESIGNED);
    const { call, projectId, store } = agentWorldOver(cast, {
      templates: design.reader,
      graphicsReady: design.graphicsReady,
    });
    const assembling = call('timeline.assemble', { projectId, template: { id: cast.template.id } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.docs.size).toBe(0);
    design.land();
    const assembled = await assembling;
    if (!assembled.ok) throw new Error(assembled.error.code);
    expect(assembled.value.graphics).toEqual(DESIGNED);
    const [timeline] = [...store.docs.values()];
    expect(timeline?.template).toEqual({ id: cast.template.id, version: cast.template.version + 1 });
  });

  it('names the overlays left without a design in the cast’s answer too', async () => {
    const cast = world(DEF);
    const partly: GraphicsWait = {
      status: 'partly',
      waitedMs: 5,
      designed: 1,
      total: 2,
      missing: [{ overlayId: 'overlay-2', reason: 'no design passed its checks' }],
    };
    const design = designing(cast.template, partly);
    const { call, projectId } = agentWorldOver(cast, {
      templates: design.reader,
      graphicsReady: design.graphicsReady,
    });
    const casting = call('timeline.cast', { projectId, template: { id: cast.template.id }, variants: 1 });
    design.land();
    const answered = await casting;
    if (!answered.ok) throw new Error(answered.error.code);
    expect(answered.value.graphics).toEqual(partly);
  });

  it('never waits for a named version, and answers as before when nothing is being designed', async () => {
    const cast = world(DEF);
    const design = designing(cast.template, DESIGNED);
    const { call, projectId } = agentWorldOver(cast, {
      templates: design.reader,
      graphicsReady: design.graphicsReady,
    });
    const named = await call('timeline.cast', {
      projectId,
      template: { id: cast.template.id, version: cast.template.version },
      variants: 1,
    });
    expect(named.ok).toBe(true);
    expect(design.asked).toEqual([]);
    const idle: GraphicsReady = async () => null;
    const plain = agentWorldOver(world(DEF), { graphicsReady: idle });
    const cast2 = await plain.call('timeline.cast', {
      projectId: plain.projectId,
      template: { id: plain.template.id },
      variants: 1,
    });
    if (!cast2.ok) throw new Error(cast2.error.code);
    expect(cast2.value).not.toHaveProperty('graphics');
  });
});

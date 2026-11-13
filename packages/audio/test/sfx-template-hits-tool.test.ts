// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G1: `sfx.addHits` fromTemplate, the template reel's own effects on the same cuts. Without it a 2.0 input
 * parses and keys exactly as before; with it the key changes. It can't be mixed with sound ids, a kit or roles. The
 * reel's payload comes from the injected `templateHits` (the desktop's: templates' reelSfxPayload) and is
 * dispatched as one `sfx.setHits`, the pack planner untouched; its errors pass through, and a process without
 * templates refuses with `audio.reel_sfx_unavailable`.
 */
import { createHash } from 'node:crypto';
import {
  err,
  FrameRate,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  toolModuleProblems,
  type AsyncResult,
  type CommandToolContext,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ReelSfxUnavailable } from '../src/listen/errors';
import { sfxToolModule, type SfxToolDeps } from '../src/tools/sfx-tools';
import { memoryTimelineStore } from './helpers/bus';
import { makeTestTimeline, steadyBeatMap } from './helpers/timeline';

const tl = makeTestTimeline({
  rate: FrameRate.of(30),
  clips: [{ frames: 60 }, { frames: 60 }, { frames: 60 }],
  beatMap: steadyBeatMap(120, 30),
});
const target = { projectId: tl.projectId, timelineId: tl.id };
const prices = { voicePerCharacter: () => 0, musicPerSecond: () => 0, sfxPerSecond: () => 0.002 };

const reelPayload = {
  ...target,
  revision: tl.revision,
  hits: [
    {
      id: newId<'TimelineItem'>(),
      at: RationalTime.of(1900, { num: 1000, den: 1 }),
      assetId: newId<'Asset'>(),
      sourceStart: RationalTime.of(0, { num: 1000, den: 1 }),
      duration: RationalTime.of(500, { num: 1000, den: 1 }),
      gainDb: -12,
      category: 'whoosh' as const,
      soundId: 'whoosh_fast/crisp',
    },
  ],
};

function addHitsTool(templateHits?: SfxToolDeps['templateHits']) {
  const planned: unknown[] = [];
  const module = sfxToolModule({
    service: {
      addHits: (async (request: unknown) => {
        planned.push(request);
        return ok({ payload: { ...target, revision: 1, hits: [] }, costUsd: 0 });
      }) as never,
      generateHit: async () => err(NotFoundError({ entity: 'x' })),
    },
    timelines: memoryTimelineStore(tl),
    prices,
    ...(templateHits ? { templateHits } : {}),
  });
  const tool = module.tools.find((t) => t.name === 'sfx.addHits');
  if (!tool) throw new Error('no sfx.addHits');
  return { module, tool, planned };
}

function context(dispatched: unknown[], usage: unknown[] = []): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    reportUsage: (spent: unknown) => void usage.push(spent),
    reportProgress: () => undefined,
    dispatch: async (payload: unknown) => {
      dispatched.push(payload);
      return ok({ timelineId: tl.id, revision: tl.revision + 1 });
    },
  } as unknown as CommandToolContext;
}

const keyOf = (input: unknown) =>
  `sfx.addHits:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;

describe('sfx.addHits fromTemplate (EAR1-G1)', () => {
  it('stays 2.0.0 with a one-line summary, and says what fromTemplate does', () => {
    const { module, tool } = addHitsTool();
    expect(toolModuleProblems(module)).toEqual([]);
    expect(tool.version).toBe('2.0.0');
    expect(tool.summary).toMatch(/^[^\n]{10,80}$/);
    expect(tool.description).toMatch(/fromTemplate: the effects the template's reference reel had/);
    const schema = z.toJSONSchema(tool.input, { io: 'input' }) as { properties: Record<string, unknown> };
    expect(schema.properties['fromTemplate']).toEqual({ type: 'boolean' });
  });

  it('keys a 2.0 input without it exactly as before; fromTemplate changes the key', () => {
    const { tool } = addHitsTool();
    const before = tool.input.parse({ ...target, kit: 'calm' });
    expect(before).toEqual({ ...target, density: 'downbeats', kit: 'calm' });
    expect(tool.idempotencyKey?.(before)).toBe(keyOf({ ...target, density: 'downbeats', kit: 'calm' }));
    const reel = tool.input.parse({ ...target, fromTemplate: true });
    expect(reel).toEqual({ ...target, density: 'downbeats', fromTemplate: true });
    expect(tool.idempotencyKey?.(reel)).toBe(keyOf({ ...target, density: 'downbeats', fromTemplate: true }));
    expect(tool.idempotencyKey?.(reel)).not.toBe(tool.idempotencyKey?.(tool.input.parse(target)));
  });

  it('refuses fromTemplate with sound ids, a kit or roles; false mixes with anything', () => {
    const { tool } = addHitsTool();
    for (const extra of [
      { soundIds: ['cut_hit/sub'] },
      { kit: 'calm' },
      { roles: { hit: 'tock' } },
      { kit: 'crisp', soundIds: ['cut_hit/sub'] },
    ]) {
      const parsed = tool.input.safeParse({ ...target, fromTemplate: true, ...extra });
      expect(parsed.success, JSON.stringify(extra)).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(/fromTemplate .*leave out soundIds, kit and roles/);
    }
    expect(tool.input.safeParse({ ...target, fromTemplate: false, kit: 'calm' }).success).toBe(true);
    expect(tool.input.safeParse({ ...target, fromTemplate: true, density: 'everyCut' }).success).toBe(true);
  });

  it('dispatches the reel payload from templateHits as one sfx.setHits, the pack planner untouched', async () => {
    const asked: Timeline[] = [];
    const { tool, planned } = addHitsTool(async (timeline) => {
      asked.push(timeline);
      return ok(reelPayload);
    });
    const dispatched: unknown[] = [];
    const usage: unknown[] = [];
    const done = await tool.run(
      tool.input.parse({ ...target, fromTemplate: true }),
      context(dispatched, usage),
    );
    expect(done).toEqual(ok({ hits: 1 }));
    expect(asked.map((timeline) => timeline.id)).toEqual([tl.id]);
    expect(dispatched).toEqual([reelPayload]);
    expect(planned).toEqual([]);
    expect(usage).toEqual([]);
  });

  it('passes the reel’s errors through, and refuses where no templates are', async () => {
    const why = ReelSfxUnavailable(
      { reason: 'cuts_changed' },
      { detail: 'the video’s cuts are not the template’s' },
    );
    const failing = addHitsTool(async (): AsyncResult<never> => err(why));
    const dispatched: unknown[] = [];
    const input = failing.tool.input.parse({ ...target, fromTemplate: true });
    expect(await failing.tool.run(input, context(dispatched))).toEqual(err(why));

    const bare = addHitsTool();
    const refused = await bare.tool.run(input, context(dispatched));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({
      code: 'audio.reel_sfx_unavailable',
      messageKey: 'errors.audio.reel_sfx_unavailable',
      params: { reason: 'other' },
    });
    expect(dispatched).toEqual([]);
    expect(bare.planned).toEqual([]);
  });

  it('plans from the pack as before without it', async () => {
    const { tool, planned } = addHitsTool(async () => ok(reelPayload));
    const dispatched: unknown[] = [];
    const done = await tool.run(tool.input.parse({ ...target, fromTemplate: false }), context(dispatched));
    expect(done).toEqual(ok({ hits: 0 }));
    expect(planned).toHaveLength(1);
    expect(dispatched).toEqual([{ ...target, revision: 1, hits: [] }]);
  });
});

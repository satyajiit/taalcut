// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: timeline.slipClip as the agent calls it: the clip by its number, the part as one form per field
 * ({"seconds"} or {"avoid"}), and an older caller's part sent beside the clip mended into it.
 */
import { RationalTime, type AnyTool, type ShotProfile, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mediaRef } from '../../src/casting/result';
import { createTimelineService } from '../../src/service/service';
import { mendSlipFields } from '../../src/tools/clip-mend';
import { editorTools } from '../../src/tools/editor-tools';
import { summarizeTimeline } from '../../src/tools/summaries';
import { editorWorld } from '../editor/editor-world';
import { makeProfile, unitVector } from '../fixtures/library';
import { agentToolContext } from '../fixtures/tool-context';
import { clipById } from '../fixtures/timeline';

const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] };

/** The second clip plays `profile` from frame 90 (3 s into a 10 s shot). */
function playing(profile: ShotProfile) {
  return (timeline: Timeline): Timeline => {
    const [video, ...rest] = timeline.tracks;
    if (video?.kind !== 'video') return timeline;
    const items = video.items.map((item, index) =>
      index === 1 && item.type === 'clip'
        ? {
            ...item,
            media: mediaRef(profile),
            sourceStart: RationalTime.of(90, item.sourceStart.rate),
            syncPoint: null,
          }
        : item,
    );
    return { ...timeline, tracks: [{ ...video, items }, ...rest] };
  };
}

async function slipWorld() {
  const profile = makeProfile({ embedding: unitVector(1), frames: 300, peaks: [] });
  const world = await editorWorld(three, [profile], playing(profile));
  const service = createTimelineService({ store: world.store, events: world.events });
  const tool = editorTools({ service }).find(
    (candidate) => candidate.name === 'timeline.slipClip',
  ) as AnyTool;
  async function call(input: Record<string, unknown>) {
    const parsed = tool.input.safeParse({ ...world.target, ...input });
    if (!parsed.success) throw new Error(parsed.error.message);
    return tool.run(parsed.data, agentToolContext(world.bus, tool));
  }
  const inPoint = () => clipById(world.doc(), world.built.ids[1] as string).sourceStart.value;
  return { ...world, tool, call, inPoint };
}

describe('the slip tool', () => {
  it('plays from seconds later or earlier in the shot, the clip by its number', async () => {
    const world = await slipWorld();
    expect((await world.call({ clip: 2, part: { seconds: 1.5 } })).ok).toBe(true);
    expect(world.inPoint()).toBe(135);
    expect((await world.call({ clip: 2, part: { seconds: -1 } })).ok).toBe(true);
    expect(world.inPoint()).toBe(105);
    // FIX-CMT: timeline.get's row says where in its shot the clip plays now, so a slip can be read back.
    expect(summarizeTimeline(world.doc()).clips[1]).toMatchObject({ playsShotFrom: 3.5 });
  });

  it('keeps out of what the person named, saying why when it can’t', async () => {
    const world = await slipWorld();
    expect((await world.call({ clip: 2, part: { avoid: ['start', 'start'] } })).ok).toBe(true);
    expect(world.inPoint()).toBeGreaterThanOrEqual(120);
    const faces = await world.call({ clip: 2, part: { avoid: ['face'] } });
    expect(!faces.ok && faces.error.detail).toMatch(/can’t look for faces/);
  });

  it('takes one form per field: seconds or avoid, never both, never beside the clip', async () => {
    const world = await slipWorld();
    const input = (part: unknown) => world.tool.input.safeParse({ ...world.target, clip: 2, part });
    expect(input({ seconds: 2 }).success).toBe(true);
    expect(input({ avoid: ['end', 'face'] }).success).toBe(true);
    expect(input({ seconds: 2, avoid: ['end'] }).success).toBe(false);
    expect(input({}).success).toBe(false);
    expect(world.tool.input.safeParse({ ...world.target, clip: 2, bySeconds: 2 }).success).toBe(false);
    const schema = JSON.stringify(z.toJSONSchema(world.tool.input, { io: 'input' }));
    expect(schema).toMatch(/"oneOf"/);
    // An older caller's part beside the clip, mended into it.
    expect(mendSlipFields({ clipId: 'x', bySeconds: 2 })).toEqual({ clip: 'x', part: { seconds: 2 } });
    expect(mendSlipFields({ clip: 3, avoid: 'face' })).toEqual({ clip: 3, part: { avoid: ['face'] } });
    expect(mendSlipFields({ clip: 3, part: { seconds: 1 }, seconds: 2 })).toEqual({
      clip: 3,
      part: { seconds: 1 },
      seconds: 2,
    });
  });
});

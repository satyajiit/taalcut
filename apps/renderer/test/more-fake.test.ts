// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MORE1: with `more: 'commands'` the fake runs the three edits the More tab's dialogs end in (a frozen moment, a
 * hold's length, a size copy); without it they are refused, as they always were.
 */
import {
  callRpc,
  RationalTime,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorResultSchema,
  type Clip,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { withAreaOptions } from '../src/backend/fake/options';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[1]!;

function setup(areas: Record<string, unknown> = { more: 'commands' }) {
  const { client } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0, areas },
  });
  const timeline = (id = timelineId) => client.timelines.get({ timelineId: id });
  const run = async (name: string, payload: Record<string, unknown>) => {
    const { revision } = await timeline();
    return callRpc(
      client.commands.dispatch({
        name,
        payload: { projectId, timelineId, revision, ...payload },
        source: 'ui',
      }),
    );
  };
  return { client, run, timeline };
}

const clips = (timeline: Timeline) =>
  timeline.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip');
const total = (timeline: Timeline) =>
  timeline.tracks[0]!.items.reduce(
    (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
    0,
  );
const resultOf = (receipt: unknown) =>
  simpleEditorResultSchema.parse((receipt as { result: unknown }).result);

describe('the More edits in the fake (MORE1)', () => {
  it('reads its option from taalcut.fake, and is off without it', () => {
    const base = { phase2: {}, make: {}, phase3: {} };
    window.localStorage.setItem('taalcut.fake', JSON.stringify({ more: 'commands' }));
    expect(withAreaOptions(base).make.areas?.['more']).toBe('commands');
    window.localStorage.setItem('taalcut.fake', JSON.stringify({ more: 'anything else' }));
    expect(withAreaOptions(base).make.areas?.['more']).toBeUndefined();
  });

  it('refuses all three without the option, as before', async () => {
    const s = setup({});
    const before = await s.timeline();
    const first = clips(before)[0]!;
    const rate = before.canvas.rate;
    for (const [name, payload] of [
      [N.makeSize, { aspect: '1:1' }],
      [
        N.freezeFrame,
        { clipId: first.id, at: RationalTime.of(4, rate), duration: RationalTime.of(60, rate) },
      ],
      [N.setHoldDuration, { clipId: first.id, duration: RationalTime.of(60, rate) }],
    ] as const)
      expect((await s.run(name, payload)).ok).toBe(false);
    expect(await s.timeline()).toEqual(before);
  });

  it('freezes a moment inside a scene: the scene is cut there and a held frame goes in between', async () => {
    const s = setup();
    const before = await s.timeline();
    const rate = before.canvas.rate;
    const first = clips(before)[0]!;
    const sent = await s.run(N.freezeFrame, {
      clipId: first.id,
      at: RationalTime.of(10, rate),
      duration: RationalTime.fromSeconds(2, rate),
    });
    expect(sent.ok).toBe(true);
    const after = await s.timeline();
    const [head, hold, rest] = clips(after);
    expect(clips(after)).toHaveLength(clips(before).length + 2);
    expect(head!.id).toBe(first.id);
    expect(head!.duration.value).toBe(10);
    expect(hold!.holdFrame).toBeDefined();
    expect(hold!.duration).toEqual(RationalTime.fromSeconds(2, rate));
    expect(hold!.audio.muted).toBe(true);
    expect(rest!.duration.value).toBe(first.duration.value - 10);
    expect(total(after)).toBe(total(before) + hold!.duration.value);
    // The receipt names the held moment, which the editor selects next.
    expect(sent.ok && resultOf(sent.value).itemId).toBe(hold!.id);
  });

  it('refuses a moment outside the scene', async () => {
    const s = setup();
    const before = await s.timeline();
    const rate = before.canvas.rate;
    const first = clips(before)[0]!;
    const outside = await s.run(N.freezeFrame, {
      clipId: first.id,
      at: RationalTime.of(first.duration.value + 5, rate),
      duration: RationalTime.of(30, rate),
    });
    expect(outside.ok).toBe(false);
    expect(await s.timeline()).toEqual(before);
  });

  it('changes a held frame’s length, and what follows moves with it', async () => {
    const s = setup();
    const before = await s.timeline();
    const rate = before.canvas.rate;
    const first = clips(before)[0]!;
    // At the scene's very start the held frame goes in before it, with no cut.
    const frozen = await s.run(N.freezeFrame, {
      clipId: first.id,
      at: RationalTime.of(0, rate),
      duration: RationalTime.of(30, rate),
    });
    const holdId = frozen.ok ? resultOf(frozen.value).itemId! : null;
    const held = await s.timeline();
    expect(clips(held)).toHaveLength(clips(before).length + 1);
    expect(clips(held)[0]!.id).toBe(holdId);
    expect(clips(held)[1]!.id).toBe(first.id);
    const changed = await s.run(N.setHoldDuration, { clipId: holdId, duration: RationalTime.of(75, rate) });
    expect(changed.ok).toBe(true);
    const after = await s.timeline();
    expect(clips(after)[0]!.duration.value).toBe(75);
    expect(total(after)).toBe(total(before) + 75);
    // A scene that plays is not a hold.
    expect(
      (await s.run(N.setHoldDuration, { clipId: first.id, duration: RationalTime.of(30, rate) })).ok,
    ).toBe(false);
  });

  it('makes an independent copy at another shape, listed with the project’s videos', async () => {
    const s = setup();
    const before = await s.timeline();
    const sent = await s.run(N.makeSize, { aspect: '1:1' });
    expect(sent.ok).toBe(true);
    const copyId = sent.ok ? resultOf(sent.value).timelineId : timelineId;
    expect(copyId).not.toBe(timelineId);
    const copy = await s.timeline(copyId);
    expect(copy.canvas).toEqual({ width: 1080, height: 1080, rate: before.canvas.rate });
    expect(copy.name).toBe(`${before.name} (1:1)`);
    expect(copy.revision).toBe(1);
    expect(clips(copy)).toHaveLength(clips(before).length);
    // The original stays as it is.
    expect(await s.timeline()).toEqual(before);
    const listed = await s.client.timelines.listByProject({ projectId });
    expect(listed.some((each) => each.id === copyId)).toBe(true);
  });
});

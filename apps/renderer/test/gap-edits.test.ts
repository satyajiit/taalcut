// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B8 with Phase 2's edits: a lock, trim or move on a cut with gaps keeps every gap where it was (the fake's
// make/layout.ts), as the timeline package's sequence does.
import { callRpc, TIMELINE_COMMANDS, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';

const VIDEO = GOLDEN_TIMELINES[1]!;
const projectId = GOLDEN_PROJECT;

function setup() {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0, areas: { gaps: { punch: 'golden' } } },
  });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const timeline = () => controls.make.timelines.get(VIDEO) as Timeline;
  const shape = () =>
    timeline()
      .tracks[0]!.items.filter((item) => item.type !== 'transition')
      .map((item) => (item.type === 'gap' ? `gap:${item.slotId}` : 'clip'));
  const clips = () => timeline().tracks[0]!.items.filter((item) => item.type === 'clip');
  return { dispatch, timeline, shape, clips };
}

describe('Phase 2 edits on a cut with gaps', () => {
  it('a lock keeps the gaps', async () => {
    const { dispatch, shape, clips } = setup();
    const before = shape();
    expect(before.filter((kind) => kind.startsWith('gap:'))).toHaveLength(2);
    const result = await dispatch(TIMELINE_COMMANDS.lockClip, {
      projectId,
      timelineId: VIDEO,
      clipId: clips()[0]!.id,
      locked: true,
    });
    expect(result.ok).toBe(true);
    expect(shape()).toEqual(before);
  });

  it('a trim keeps the gaps in their places', async () => {
    const { dispatch, shape, clips, timeline } = setup();
    const before = shape();
    const result = await dispatch(TIMELINE_COMMANDS.trimClip, {
      projectId,
      timelineId: VIDEO,
      clipId: clips()[0]!.id,
      edge: 'end',
      by: { value: -15, rate: timeline().canvas.rate },
    });
    expect(result.ok ? 'ok' : result.error.code).toBe('ok');
    expect(shape()).toEqual(before);
  });
});

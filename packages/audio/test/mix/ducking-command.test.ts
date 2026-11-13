// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { DEFAULT_DUCKING, MIX_COMMANDS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createDuckingCommand } from '../../src/mix/ducking-command';
import { busWith, memoryTimelineStore, UI } from '../helpers/bus';
import { makeTestTimeline } from '../helpers/timeline';

describe('music.setDucking', () => {
  it('changes the settings, announces after commit, and undoes to the previous settings', async () => {
    const timeline = makeTestTimeline({ clips: [{ frames: 90 }] });
    const store = memoryTimelineStore(timeline);
    const { bus, changed } = busWith(store, (deps) => [createDuckingCommand(deps)]);
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const done = await bus.dispatch(MIX_COMMANDS.setDucking, { ...target, ducking: { marginLu: 10 } }, UI);
    expect(done.ok && done.value.undoable).toBe(true);
    expect(store.current(timeline.id).mix.ducking).toEqual({ ...DEFAULT_DUCKING, marginLu: 10 });
    expect(changed).toEqual([[timeline.id]]);
    await bus.undo(timeline.projectId, UI);
    expect(store.current(timeline.id).mix.ducking).toEqual(DEFAULT_DUCKING);
    await bus.redo(timeline.projectId, UI);
    expect(store.current(timeline.id).mix.ducking.marginLu).toBe(10);
  });

  it('writes nothing when nothing changes and refuses an out-of-range margin', async () => {
    const timeline = makeTestTimeline({ clips: [{ frames: 90 }] });
    const store = memoryTimelineStore(timeline);
    const { bus } = busWith(store, (deps) => [createDuckingCommand(deps)]);
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const same = await bus.dispatch(MIX_COMMANDS.setDucking, { ...target, ducking: { marginLu: 8 } }, UI);
    expect(same.ok && same.value.undoable).toBe(false);
    expect(store.current(timeline.id).revision).toBe(1);
    const wrong = await bus.dispatch(MIX_COMMANDS.setDucking, { ...target, ducking: { marginLu: 30 } }, UI);
    expect(wrong.ok).toBe(false);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `music.setDucking` (SPEC P3.10): edits the timeline's ducking settings (`timeline.mix.ducking`). Undoable: its
 * inverse is itself with the settings as they were (core's MIX_COMMANDS contract).
 */
import { defineCommand, MIX_COMMANDS, mixCommandPayloads, ok, type DuckingSettings } from '@taalcut/core';
import { createTimelineWriter, type TimelineWriteDeps } from '../commands/timeline-writes';

export function createDuckingCommand(deps: TimelineWriteDeps) {
  const writer = createTimelineWriter(deps);
  return defineCommand({
    name: MIX_COMMANDS.setDucking,
    payload: mixCommandPayloads[MIX_COMMANDS.setDucking],
    sideEffect: 'write',
    handle: async (payload, context) => {
      let previous: DuckingSettings | undefined;
      const written = await writer.write(payload, context, (timeline) => {
        previous = timeline.mix.ducking;
        const ducking = { ...timeline.mix.ducking, ...payload.ducking };
        const same = JSON.stringify(ducking) === JSON.stringify(timeline.mix.ducking);
        return ok({
          timeline: { ...timeline, mix: { ...timeline.mix, ducking } },
          changed: same ? [] : ['mix'],
        });
      });
      if (!written.ok || !written.value.inverse || !previous) return written;
      return ok({
        result: written.value.result,
        inverse: {
          name: MIX_COMMANDS.setDucking,
          payload: { projectId: payload.projectId, timelineId: payload.timelineId, ducking: previous },
        },
      });
    },
  });
}

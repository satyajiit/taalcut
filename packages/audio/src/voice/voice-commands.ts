// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `voice.applyVoiceover` and `voice.removeVoiceover` (SPEC P3.10): put a voiceover and its voice track (role
 * 'voice') on a timeline, or take them off. Every source may dispatch them; the inverse is `timeline.restore`
 * with the tracks and the voiceover as they were, so one undo removes a placement. The generated files stay in
 * the library (they cost money); an unreferenced one is purged later like a soft-deleted render.
 */
import { defineCommand, err, ok, VOICE_COMMANDS, voiceCommandPayloads, ValidationError } from '@taalcut/core';
import { keepRecordedNarration } from './kept-recordings';
import { withoutRoleTrack, withRoleTrack } from '../commands/audio-track';
import { createTimelineWriter, type TimelineWriteDeps } from '../commands/timeline-writes';

export function createVoiceCommands(deps: TimelineWriteDeps) {
  const writer = createTimelineWriter(deps);
  const applyVoiceover = defineCommand({
    name: VOICE_COMMANDS.applyVoiceover,
    payload: voiceCommandPayloads[VOICE_COMMANDS.applyVoiceover],
    sideEffect: 'write',
    handle: (payload, context) =>
      writer.write(payload, context, (timeline) => {
        const { track, voiceover } = payload;
        if (track.kind !== 'audio' || track.role !== 'voice')
          return err(
            ValidationError(
              { field: 'track' },
              { detail: "the voiceover's track must be an audio track of role 'voice'" },
            ),
          );
        const merged = keepRecordedNarration(timeline, track);
        if (!merged.ok) return merged;
        return ok({
          timeline: { ...timeline, tracks: withRoleTrack(timeline, merged.value!), voiceover },
          changed: ['tracks', 'voiceover'],
        });
      }),
  });

  const removeVoiceover = defineCommand({
    name: VOICE_COMMANDS.removeVoiceover,
    payload: voiceCommandPayloads[VOICE_COMMANDS.removeVoiceover],
    sideEffect: 'write',
    handle: (payload, context) =>
      writer.write(payload, context, (timeline) => {
        if (!timeline.voiceover) return ok({ timeline, changed: [] });
        const kept = keepRecordedNarration(timeline);
        if (!kept.ok) return kept;
        return ok({
          timeline: {
            ...timeline,
            tracks: kept.value ? withRoleTrack(timeline, kept.value) : withoutRoleTrack(timeline, 'voice'),
            voiceover: null,
          },
          changed: ['tracks', 'voiceover'],
        });
      }),
  });

  return { applyVoiceover, removeVoiceover, all: [applyVoiceover, removeVoiceover] as const };
}

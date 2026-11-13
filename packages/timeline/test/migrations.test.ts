// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Reading stored timelines: version checks, schema validation, and ramps that run past their media. */
import { TIMELINE_SCHEMA_VERSION } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { checkEdited, migrateTimeline, rampProblems } from '../src/model/validate';
import { buildTimeline } from './fixtures/timeline';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

describe('timeline migrations', () => {
  it('reads the current version back unchanged', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }, { frames: 45 }] });
    const read = migrateTimeline(json(timeline), TIMELINE_SCHEMA_VERSION);
    expect(read.ok && read.value).toEqual(timeline);
  });

  it('reads a version 1 document through core\'s upgrade', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }, { frames: 45 }] });
    const { styleId: _style, voiceover: _voice, mix: _mix, ...rest } = timeline;
    const v1 = json({
      ...rest,
      schemaVersion: 1,
      tracks: timeline.tracks.map((track) =>
        track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item) => {
                if (item.type !== 'clip') return item;
                const { stillMotion: _still, reframe: _reframe, ...clip } = item;
                return clip;
              }),
            }
          : track,
      ),
    });
    const read = migrateTimeline(v1, 1);
    expect(read.ok && read.value).toEqual(timeline);
  });

  it('refuses versions it does not know', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }] });
    for (const version of [0, TIMELINE_SCHEMA_VERSION + 1, 1.5]) {
      const read = migrateTimeline(json(timeline), version);
      expect(read.ok ? null : read.error.code).toBe('timeline.unsupported_schema');
    }
  });

  it('refuses a document that breaks the schema, with the path in the detail', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }] });
    const broken = { ...(json(timeline) as Record<string, unknown>), revision: 0 };
    const read = migrateTimeline(broken, TIMELINE_SCHEMA_VERSION);
    expect(read.ok ? null : read.error.code).toBe('core.validation');
    expect(read.ok ? '' : read.error.detail).toContain('revision');
  });

  it('refuses a ramp that runs past its media', () => {
    // 60 frames at 3× need 180 media frames; the asset has 200 from frame 100.
    const { timeline } = buildTimeline({ clips: [{ frames: 60, media: 200, ramp: [[0, 3], [59, 3]] }] });
    expect(rampProblems(timeline)).toEqual(['tracks.0.items.0.speed: the ramp runs past the media']);
    const read = migrateTimeline(json(timeline), TIMELINE_SCHEMA_VERSION);
    expect(read.ok ? null : read.error.code).toBe('core.validation');
    const edited = checkEdited(timeline);
    expect(edited.ok ? null : edited.error.code).toBe('timeline.invalid_move');
    const fits = buildTimeline({ clips: [{ frames: 60, media: 400, ramp: [[0, 3], [59, 3]] }] });
    expect(rampProblems(fits.timeline)).toEqual([]);
    expect(checkEdited(fits.timeline).ok).toBe(true);
  });
});

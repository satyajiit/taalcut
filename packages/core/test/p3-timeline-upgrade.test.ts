// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Stored Timeline v1 documents load as v2 through core's upgrade (P3 Timeline v2). */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIX,
  TIMELINE_SCHEMA_VERSION,
  TIMELINE_UPGRADE_STEPS,
  upgradeTimeline,
  upgradeTimelineJson,
  type Timeline,
} from '@taalcut/core';
import { json, ntscTimeline } from './helpers/documents';

/** The document as a Phase 2 build stored it. */
function asV1(timeline: Timeline): Record<string, unknown> {
  const { styleId: _s, voiceover: _v, mix: _m, ...rest } = timeline;
  return {
    ...rest,
    schemaVersion: 1,
    tracks: timeline.tracks.map((track) => {
      if (track.kind === 'text') return track;
      const items = track.items.map((item) => {
        if (item.type !== 'clip') return item;
        const { stillMotion: _still, reframe: _reframe, ...clip } = item;
        return clip;
      });
      if (track.kind === 'audio') {
        const { role: _role, ...audio } = track;
        return { ...audio, items };
      }
      return { ...track, items };
    }),
  };
}

describe('upgradeTimeline', () => {
  it('has one step per version', () => {
    expect(TIMELINE_UPGRADE_STEPS).toHaveLength(TIMELINE_SCHEMA_VERSION - 1);
  });

  it('reads a v1 document as the same timeline with v2 defaults', () => {
    const current = ntscTimeline();
    const upgraded = upgradeTimeline(json(asV1(current)), 1);
    expect(upgraded.ok && json(upgraded.value)).toEqual(json(current));
    expect(upgraded.ok && upgraded.value.mix).toEqual(DEFAULT_MIX);
  });

  it('keeps what a v1 document already says', () => {
    const v1 = {
      ...asV1(ntscTimeline()),
      styleId: null,
      mix: { ducking: { ...DEFAULT_MIX.ducking, enabled: false } },
    };
    const upgraded = upgradeTimeline(json(v1), 1);
    expect(upgraded.ok && upgraded.value.mix.ducking.enabled).toBe(false);
  });

  it('passes a current document through', () => {
    const current = ntscTimeline();
    expect(upgradeTimelineJson(json(current), TIMELINE_SCHEMA_VERSION)).toEqual({
      ok: true,
      value: json(current),
    });
  });

  it("refuses a version it can't read, without guessing", () => {
    for (const version of [0, 1.5, TIMELINE_SCHEMA_VERSION + 1]) {
      const result = upgradeTimeline(json(ntscTimeline()), version);
      expect(!result.ok && result.error).toMatchObject({
        code: 'core.validation',
        params: { field: 'schemaVersion' },
      });
    }
  });

  it("leaves what isn't a document for the schema to refuse, with the issues in detail", () => {
    expect(upgradeTimelineJson('timeline', 1)).toEqual({ ok: true, value: 'timeline' });
    const tracks = { ...asV1(ntscTimeline()), tracks: [42, { kind: 'video', items: 'none' }] };
    expect(upgradeTimelineJson(tracks, 1).ok).toBe(true);
    const result = upgradeTimeline({ ...asV1(ntscTimeline()), name: '' }, 1);
    expect(!result.ok && result.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'timeline' },
    });
    expect(!result.ok && result.error.detail).toContain('name');
  });
});

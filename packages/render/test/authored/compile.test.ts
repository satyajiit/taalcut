// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, RationalTime, unwrap } from '@taalcut/core';
import { createAuthoredTimeline } from '@taalcut/timeline';
import { compileComposition } from '../../src/compile/composition';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { authoredFixture, authoredSource } from './support';

describe('native authored program compilation', () => {
  const timeline = () =>
    unwrap(
      createAuthoredTimeline({ projectId: newId<'Project'>(), program: authoredFixture(), name: 'Launch' }),
    );
  const options = {
    variant: 'export' as const,
    preset: presetFor('device'),
    burnCaptions: false,
    media: () => undefined,
  };
  it('plans one continuous source program and compiles its layers without flattened footage', () => {
    const project = timeline();
    const plan = unwrap(planTimeline(project));
    expect(plan.programs).toHaveLength(1);
    expect(plan.visuals).toEqual([]);
    expect(plan.gaps).toEqual([]);
    expect(plan.durationFrames).toBe(1800);
    const bundle = unwrap(
      compileComposition(project, {
        ...options,
        authoredWorkspace: { text: () => authoredSource, asset: () => undefined },
      }),
    );
    expect(bundle.files['index.html']).toContain('Launch');
    expect(bundle.files['index.html']).toContain('"sourceStart":0');
    expect(bundle.files['tc.js']).not.toContain("window.__timelines['film']");
  });
  it('fails rather than exporting a black film when its source is unavailable', () => {
    expect(compileComposition(timeline(), options)).toMatchObject({ ok: false });
  });
  it('keeps the source clock when a program is trimmed', () => {
    const project = timeline();
    const track = project.tracks[0]!;
    if (track.kind !== 'video') throw new Error('Expected video');
    const item = track.items[0]!;
    if (item.type !== 'program') throw new Error('Expected program');
    const shortened = {
      ...project,
      tracks: [
        {
          ...track,
          items: [
            {
              ...item,
              sourceStart: RationalTime.of(300, project.canvas.rate),
              duration: RationalTime.of(600, project.canvas.rate),
            },
          ],
        },
      ],
    };
    const bundle = unwrap(
      compileComposition(shortened, {
        ...options,
        authoredWorkspace: { text: () => authoredSource, asset: () => undefined },
      }),
    );
    expect(bundle.files['index.html']).toContain('"sourceStart":5');
    expect(bundle.durationFrames).toBe(600);
  });
});

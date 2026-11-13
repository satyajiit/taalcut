// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: the `eyes` module is well formed for the registry, with schemas a model can read, and only reads. */
import { defineToolModule, toolModuleProblems } from '@taalcut/core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { eyesToolModules, withLibraryEyes, withVideoEyes } from '../../src/eyes/module';
import { eyesDeps, madeUpTemplate, madeUpTimeline } from './world';

describe('the eyes module', () => {
  const template = madeUpTemplate();
  const eyes = eyesToolModules(
    eyesDeps({
      media: null,
      scratch: '/nowhere',
      template,
      timeline: madeUpTimeline(template),
      renders: [],
      reel: null,
    }),
  );
  const library = withLibraryEyes(defineToolModule({ id: 'library', tools: [] }), eyes);

  it('offers video.compare, and library.frameAt and library.subjects in the library module, well formed and read-only', () => {
    expect(eyes.video.tools.map((tool) => tool.name)).toEqual(['video.compare']);
    expect(library.tools.map((tool) => tool.name)).toEqual(['library.frameAt', 'library.subjects']);
    expect(toolModuleProblems(eyes.video)).toEqual([]);
    expect(toolModuleProblems(library)).toEqual([]);
    for (const tool of [...eyes.video.tools, ...library.tools]) {
      expect(tool.sideEffect).toBe('read');
      expect(tool.permission?.network).toBe('none');
      z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'throw' });
      z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'throw' });
    }
  });

  it("joins match's video module, so the registry holds one `video` module with video.done then video.compare", () => {
    const done = defineToolModule({
      id: 'video',
      tools: [...eyes.video.tools].map((tool) => ({ ...tool, name: 'video.done' })),
    });
    const video = withVideoEyes(done, eyes);
    expect(video.id).toBe('video');
    expect(video.tools.map((tool) => tool.name)).toEqual(['video.done', 'video.compare']);
    expect(toolModuleProblems(video)).toEqual([]);
  });
});

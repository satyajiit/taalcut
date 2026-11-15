// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ROUTE: the words that load an edit tool into the Editor's five-tool step on a small window (the agent's
 * search over name, tags, summary and description). TXT1's and LONG1's tools shared the words "text", "clip",
 * "video" and "end" with the older edit tools, which made each of those words count for less, and three asks no
 * longer loaded the tool that does them. Five tools carry a word more for the job people ask of them, each one
 * patch version on. No description or input changed, so the tool definitions a model is sent are the same; only
 * timeline.editText's one-line summary, which the catalogue lists, is reworded.
 * tools/evals test/edit/edit-routing.test.ts holds the asks; this pins the words and the versions.
 */
import { describe, expect, it } from 'vitest';
import type { AnyTool } from '@taalcut/core';
import { editTools } from '../src/tools/edit-tools';
import { editorTools } from '../src/tools/editor-tools';
import { lengthenTools } from '../src/tools/lengthen-tools';

const tools = new Map<string, AnyTool>(
  [...editTools(), ...editorTools(), ...lengthenTools({ service: {}, templates: {} } as never)].map(
    (tool) => [tool.name, tool],
  ),
);
const tool = (name: string) => tools.get(name)!;

describe('the edit tools’ search words (FIX-ROUTE)', () => {
  it('timeline.moveClip 1.0.1 says where a clip goes in the video', () => {
    expect(tool('timeline.moveClip').version).toBe('1.0.1');
    expect(tool('timeline.moveClip').tags).toEqual(expect.arrayContaining(['move', 'end', 'start', 'video']));
  });

  it('timeline.setTransition 1.0.1 says how long a transition lasts', () => {
    expect(tool('timeline.setTransition').version).toBe('1.0.1');
    expect(tool('timeline.setTransition').tags).toEqual(
      expect.arrayContaining(['crossfade', 'longer', 'lasts', 'seconds']),
    );
  });

  it('timeline.editText 1.1.1 says it changes what a video’s text says', () => {
    expect(tool('timeline.editText').version).toBe('1.1.1');
    expect(tool('timeline.editText').tags).toEqual(
      expect.arrayContaining(['change', 'say', 'text', 'video']),
    );
    expect(tool('timeline.editText').summary).toBe(
      'Changes what one or more on-screen texts say, or retimes, moves or removes them, in a single step.',
    );
  });

  it('timeline.musicBars and timeline.lengthenSlot 1.0.1 say a clip can run longer', () => {
    for (const name of ['timeline.musicBars', 'timeline.lengthenSlot']) {
      expect(tool(name).version).toBe('1.0.1');
      expect(tool(name).tags).toEqual(expect.arrayContaining(['longer', 'run']));
    }
  });

  it('the edit tools it left alone are the versions they were', () => {
    expect(tool('timeline.moveText').version).toBe('1.1.0');
    for (const name of [
      'timeline.trimClip',
      'timeline.lockClip',
      'timeline.deleteClip',
      'timeline.removeTransition',
    ])
      expect(tool(name).version).toBe('1.0.0');
  });
});

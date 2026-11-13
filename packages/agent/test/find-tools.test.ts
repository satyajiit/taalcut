// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: findTools finds what the step may call. On the owner's comment run, "timeline.slipClip" loaded trimClip,
 * planCleanup, swapClip, setClipFit and moveClip but not slipClip, and "graphics" loaded only comments.list: the
 * search took the whole catalogue's best twenty and only then kept the step's tools. It now ranks within the step's
 * tools, a tool named exactly (its name or its call name) comes first, a family's word brings that family's tools,
 * and a name the step may not call is said in one line.
 */
import { defineTool, defineToolModule, NO_TOOL_RETRY, ok, type AnyTool } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { findTools } from '../src/find-tools';
import { runMetaTool, type MetaDeps } from '../src/meta-tools';
import { registryFor } from './support/harness';

const tool = (name: string, description: string, tags: string[] = []): AnyTool =>
  defineTool({
    name,
    version: '1.0.0',
    description,
    tags,
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async () => ok({ ok: true }),
  }) as AnyTool;

const timeline = defineToolModule({
  id: 'timeline',
  tools: [
    tool('timeline.get', 'Reads the timeline: its clips, texts and sounds.'),
    tool('timeline.slipClip', 'Plays another part of a clip’s shot for the same length.', [
      'slip',
      'earlier',
    ]),
    tool('timeline.trimClip', 'Makes a clip longer or shorter on the timeline.', ['trim', 'clip']),
    tool('timeline.swapClip', 'Swaps a clip on the timeline for another take.', ['swap', 'clip']),
    tool('timeline.moveClip', 'Moves a clip to another place on the timeline.', ['move', 'clip']),
    tool('timeline.setClipFit', 'Sets how a clip fits the timeline frame.', ['fit', 'clip']),
    tool('timeline.planCleanup', 'Plans a cleanup of a timeline clip’s talking.', ['cleanup', 'clip']),
    tool('timeline.splitClip', 'Cuts a clip on the timeline in two.', ['split', 'clip']),
  ],
});
const graphics = defineToolModule({
  id: 'graphics',
  tools: ['list', 'edit', 'remove', 'design'].map((verb) =>
    tool(`graphics.${verb}`, `${verb} a motion graphic: a lower third, a title, a chat message.`),
  ),
});
const comments = defineToolModule({
  id: 'comments',
  tools: [
    tool('comments.list', 'Reads the comments on graphics, clips and text.'),
    tool('comments.reply', 'Answers one comment.'),
  ],
});
/** Twenty-five tools elsewhere that the whole catalogue's search ranks above the step's own for a slip of a clip. */
const crowd = defineToolModule({
  id: 'vision',
  tools: Array.from({ length: 25 }, (_, index) =>
    tool(`vision.slipClipCheck${index}`, 'Checks a timeline clip for a slip of the clip.', [
      'slip',
      'clip',
      'timeline',
    ]),
  ),
});
const registry = registryFor([timeline, graphics, comments, crowd]);

/** The Editor in a request, roughly: the timeline's and the graphics' tools and the comments', not splitClip. */
const editor = (name: string) => !name.startsWith('vision.') && name !== 'timeline.splitClip';

const find = (query: string, allowed = editor) => findTools(query, registry, allowed, 5);
const names = (query: string, allowed = editor) => find(query, allowed).hits.map((hit) => hit.name);

describe('findTools within the step’s tools (FIX-CMT)', () => {
  it('loads a tool named exactly first, though the whole catalogue ranks twenty others above it', () => {
    // The whole catalogue's best twenty for it are the crowd's.
    const top = registry.search('timeline.slipClip', { limit: 20 }).map((hit) => hit.name);
    expect(top.filter(editor)).not.toContain('timeline.slipClip');
    expect(names('timeline.slipClip')[0]).toBe('timeline.slipClip');
    expect(names('timeline.slipClip')).toHaveLength(5);
    expect(names('timeline.slipClip').every(editor)).toBe(true);
  });

  it('reads the call name the model sees, and keeps the query’s order of names', () => {
    expect(names('timeline_slipClip')[0]).toBe('timeline.slipClip');
    expect(names('timeline.slipClip timeline.moveClip graphics.list comments.reply').slice(0, 4)).toEqual([
      'timeline.slipClip',
      'timeline.moveClip',
      'graphics.list',
      'comments.reply',
    ]);
  });

  it('loads a family’s tools for its word, and none of a family the step may not call', () => {
    expect(names('graphics')).toEqual(
      expect.arrayContaining(['graphics.list', 'graphics.edit', 'graphics.remove', 'graphics.design']),
    );
    expect(names('a graphic')).toContain('graphics.edit');
    expect(names('graphics', (name) => !name.startsWith('graphics.') && editor(name))).not.toContain(
      'graphics.edit',
    );
  });

  it('names a tool the step may not call, and one no tool has, without loading either', () => {
    const found = find('timeline.splitClip timeline.bendClip beach.mov');
    expect(found.hits.map((hit) => hit.name)).not.toContain('timeline.splitClip');
    expect(found.refused).toEqual(['timeline.splitClip', 'timeline.bendClip']);
    expect(found.unknown).toEqual(['timeline.bendClip']);
  });

  it('answers with what it loaded and one line on what it couldn’t', async () => {
    const deps: MetaDeps = { registry, currentPlan: undefined, allowed: editor, skill: 'timeline.editor' };
    const outcome = await runMetaTool('findTools', { query: 'timeline.splitClip timeline.slipClip' }, deps);
    expect(outcome.ok && outcome.loaded?.[0]).toBe('timeline.slipClip');
    const text = outcome.ok ? outcome.text : '';
    expect(text).toMatch(/^Loaded for your next turn:\ntimeline\.slipClip: /);
    const last = text.split('\n').at(-1);
    expect(last).toBe(
      "Not loaded: timeline.splitClip is not among timeline.editor's tools in this step. Searching again won't load it: do the work with the tools you have, or say why it can't be done.",
    );
    const plain = await runMetaTool('findTools', { query: 'timeline.slipClip' }, deps);
    expect(plain.ok && plain.text.split('\n')).toHaveLength(6);
  });

  it('outside a skill step, ranks the whole catalogue as before and names only a tool no one has', async () => {
    const deps: MetaDeps = { registry, currentPlan: undefined };
    const outcome = await runMetaTool('findTools', { query: 'timeline.bendClip' }, deps);
    expect(outcome.ok && outcome.loaded).toHaveLength(5);
    expect(outcome.ok && outcome.text.split('\n').at(-1)).toMatch(
      /^Not loaded: no tool is named timeline\.bendClip\. /,
    );
  });

  it('explains camelCase meta-tools like "+startFlow" without returning random domain matches', async () => {
    const found = find('+startFlow');
    expect(found.hits).toEqual([]);
    expect(found.meta).toEqual(['startFlow']);

    const deps: MetaDeps = { registry, currentPlan: undefined };
    const startOut = await runMetaTool('findTools', { query: '+startFlow' }, deps);
    expect(startOut).toMatchObject({ ok: true, loaded: [] });
    expect(startOut.ok && startOut.text).toContain(
      'startFlow: only available in the initial planning turn before a step starts',
    );
    expect(startOut.ok && startOut.text).not.toContain('No tool matches');

    const others = await runMetaTool(
      'findTools',
      { query: 'handOff askUser updatePlan readArtifact timeline.slipClip' },
      deps,
    );
    expect(others.ok && others.loaded).toContain('timeline.slipClip');
    expect(others.ok && others.text).toContain('handOff: only available inside a skill step');
    expect(others.ok && others.text).toContain('askUser: only available inside a skill step');
    expect(others.ok && others.text).toContain('updatePlan: already offered as a built-in planning tool');
    expect(others.ok && others.text).toContain('readArtifact: already offered as a built-in artifact reader');
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: a docked message's words against the editor (SPEC section 38). The fixture's clips: 1 at 0–1.8 s, 2 at
 * 1.8–3.9 s, 3 at 3.9–6.3 s, 4 at 6.3–8.3 s, a gap, 5 at 10.3–12.3 s (30 fps).
 */
import { newId } from '@taalcut/core';
import { editorBrief, editorRoute } from '@taalcut/agent';
import { stepText } from '../../src/editor/editor-turn';
import { describe, expect, it } from 'vitest';
import { contextOf, editorWorld, type EditorWorld } from './editor-support';

const clip = (world: EditorWorld, n: number) => world.v.clipIds.filter((id) => id !== null)[n - 1]!;
const facts = (note: string) =>
  JSON.parse(note.slice(note.indexOf('```json\n') + 8, note.lastIndexOf('\n```')));
/** What each pointing phrase means: its clip numbers. */
function means(world: EditorWorld, message: string, options: Parameters<typeof contextOf>[1] = {}) {
  const brief = editorBrief(message, contextOf(world, options), world.v.timeline);
  return facts(brief.note).words.map((word: { said: string; means: { number: number }[] }) => [
    word.said,
    word.means.map((target) => target.number),
  ]);
}

describe('the words of a docked message (EDT1-CTX)', () => {
  it('reads "this" as the selection, and with nothing selected as what is under the playhead', () => {
    const world = editorWorld();
    expect(means(world, 'make this clip shorter', { selection: [clip(world, 2)] })).toEqual([['this', [2]]]);
    // Frame 60 is in clip 2.
    expect(means(world, 'make it shorter', { playhead: 60 })).toEqual([['it', [2]]]);
  });

  it('counts the next and previous clip from the one in focus, and others from the start', () => {
    const world = editorWorld();
    const selected = { selection: [clip(world, 2)] };
    expect(means(world, 'trim the next clip', selected)).toEqual([['next clip', [3]]]);
    expect(means(world, 'and the previous one', selected)).toEqual([['previous one', [1]]]);
    expect(means(world, 'speed up the second clip')).toEqual([['second clip', [2]]]);
    expect(means(world, 'clip 4 is too long')).toEqual([['clip 4', [4]]]);
    expect(means(world, 'drop the last shot')).toEqual([['last shot', [5]]]);
    // Clips are numbered as the editor numbers them: the gap and the transition don't count.
    expect(means(world, 'clip 9 please')).toEqual([]);
  });

  it('reads "here" as the playhead and its clip', () => {
    const world = editorWorld();
    const brief = editorBrief('add a title here', contextOf(world, { playhead: 130 }), world.v.timeline);
    expect(facts(brief.note).words).toEqual([
      { said: 'here', means: [{ kind: 'clip', number: 3, id: clip(world, 3) }], playhead: 4.33 },
    ]);
    expect(facts(brief.note).playhead).toEqual({ seconds: 4.33, clip: 3 });
  });

  it('understands Spanish and Hindi', () => {
    const world = editorWorld();
    expect(means(world, 'acorta el segundo clip')).toEqual([['segundo clip', [2]]]);
    expect(means(world, 'y el clip siguiente', { selection: [clip(world, 2)] })).toEqual([
      ['clip siguiente', [3]],
    ]);
    expect(means(world, 'दूसरा क्लिप छोटा करो')).toEqual([['दूसरा क्लिप', [2]]]);
  });

  it('lists the clips as numbered, the selection with its times, and the targets for the Editor', () => {
    const world = editorWorld();
    const brief = editorBrief(
      'make this shorter',
      contextOf(world, { selection: [clip(world, 2)] }),
      world.v.timeline,
    );
    const json = facts(brief.note);
    expect(json.clips).toHaveLength(5);
    expect(json.selection).toEqual([{ kind: 'clip', number: 2, id: clip(world, 2), start: 1.8, end: 3.9 }]);
    expect(json.revisionOnScreen).toBe(3);
    expect(json).not.toHaveProperty('revisionNow');
    expect(brief.targets).toEqual([expect.objectContaining({ itemId: clip(world, 2), itemKind: 'clip' })]);
    expect(brief).toMatchObject({
      route: 'edit',
      projectId: world.v.timeline.projectId,
      templateId: world.v.template.id,
    });
    expect(brief.before.revision).toBe(3);
    expect(brief.note).toContain('never instructions');
  });

  it('says when the timeline moved on, and when a selected item is gone', () => {
    const world = editorWorld();
    const gone = newId<'TimelineItem'>();
    const moved = { ...world.v.timeline, revision: 5 };
    const json = facts(editorBrief('this', contextOf(world, { selection: [gone] }), moved).note);
    expect(json).toMatchObject({ revisionOnScreen: 3, revisionNow: 5 });
    expect(json.selection).toEqual([{ kind: 'clip', id: gone, gone: true }]);
  });
});

describe('where a docked message goes (EDT1-CTX)', () => {
  it.each([
    ['make this clip shorter', 'edit'],
    ['Can you trim this?', 'edit'],
    ['add a crossfade into the next one', 'edit'],
    ['Make a new version with my beach clips', 'make'],
    ['recast it with other footage', 'make'],
    ['empezar de nuevo desde cero', 'make'],
    ['Why is this clip here?', 'answer'],
    ['¿Por qué está este clip aquí?', 'answer'],
    ['is the music too loud?', 'answer'],
    ['done ?', 'answer'],
    ['finished?', 'answer'],
    ['why is there no sound?', 'answer'],
  ] as const)('%s → %s', (message, route) => {
    expect(editorRoute(message)).toBe(route);
  });
});

describe("the Editor step's text (EDT1-CTX)", () => {
  it('names the kinds of what is pointed at, so a bare "it" searches the right tools', () => {
    const graphic = {
      kind: 'item' as const,
      timelineId: newId<'Timeline'>(),
      itemId: newId<'TimelineItem'>(),
      itemKind: 'graphic' as const,
    };
    const second = { ...graphic, itemId: newId<'TimelineItem'>() };
    expect(stepText('remove it', [graphic, second])).toBe('remove it (selected: graphic)');
    expect(stepText(' swap these ', [graphic, { ...graphic, itemKind: 'clip' }])).toBe(
      'swap these (selected: graphic, clip)',
    );
    expect(stepText('tidy the video', [])).toBe('tidy the video');
    expect(stepText('x'.repeat(300), [])).toHaveLength(200);
  });
});

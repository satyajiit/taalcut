// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the guard on a change away from what the person pointed at (pointing-guard.ts). In a docked run with a
 * selection, a change to a clip neither selected nor pointed at by the words, or a transition on a cut that touches
 * neither, is refused once with both clips by number and what each shows; with nothing selected and the playhead at a
 * cut, a transition on another cut is refused the same way. The repeat, "next" from the selection, the selected
 * clip's own cut and a run that isn't docked go through.
 */
import { newId, ok, RationalTime, type AnyTool, type EditorContext, type RunId, type ToolEditorContext } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineService } from '../../src/service/service';
import { createClipNumbering } from '../../src/tools/clip-refs';
import { editTools } from '../../src/tools/edit-tools';
import { editorTools } from '../../src/tools/editor-tools';
import { readTools } from '../../src/tools/read-tools';
import type { ShotDescriptions } from '../../src/tools/rerank-material';
import { editorWorld } from '../editor/editor-world';
import { agentToolContext } from '../fixtures/tool-context';
import { clipById } from '../fixtures/timeline';

const four = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }, { frames: 30 }] };
const SAID = ['A bike on a bridge', 'A cup of coffee', 'A busy crossing', 'Waves on a beach'];

async function pointingWorld() {
  const world = await editorWorld(four);
  const service = createTimelineService({ store: world.store, events: world.events });
  const numbering = createClipNumbering();
  const ids = world.built.ids as string[];
  const shotOf = (id: string) => {
    const media = clipById(world.doc(), id).media;
    return media.kind === 'video' ? media.shotId : null;
  };
  const shotDescriptions: ShotDescriptions = async (shotIds) =>
    ok(new Map(shotIds.map((shotId) => [shotId as string, SAID[ids.findIndex((id) => shotOf(id) === shotId)] ?? ''])));
  const tools = [
    ...readTools({ service, numbering }),
    ...editTools({ service, numbering, shotDescriptions }),
    ...editorTools({ service, numbering, shotDescriptions }),
  ];
  const rate = () => world.doc().canvas.rate;
  const item = (index: number) => ({ kind: 'item', timelineId: world.target.timelineId, itemId: ids[index], itemKind: 'clip' });
  /** A docked run's editor: the playhead (frames), the selected clips and what the words point at (indexes). */
  const docked = (playhead: number, selected: readonly number[] = [], words: readonly number[] = []): ToolEditorContext => ({
    context: {
      timelineId: world.target.timelineId,
      revision: world.doc().revision,
      playhead: RationalTime.of(playhead, rate()),
      selection: selected.map(item),
    } as unknown as EditorContext,
    targets: words.map(item) as never,
  });
  /** A call in a run that has read the timeline (as the Editor does first), unless it is the read. */
  async function call(name: string, input: Record<string, unknown>, editor?: ToolEditorContext, runId?: RunId) {
    const run = runId ?? newId<'AgentRun'>();
    const tool = tools.find((candidate) => candidate.name === name) as AnyTool;
    const ctx = { ...agentToolContext(world.bus, tool), runId: run, ...(editor ? { editor } : {}) };
    if (name === 'timeline.get') return tool.run(tool.input.parse(input), ctx);
    await call('timeline.get', { timelineId: world.target.timelineId }, editor, run);
    return tool.run(tool.input.parse({ ...world.target, ...input }), ctx);
  }
  const transitions = () => world.doc().tracks[0]!.items.filter((item) => item.type === 'transition').length;
  return { ...world, ids, docked, call, transitions };
}

describe('the guard on a change away from what was pointed at (EDT1-OPS)', () => {
  it('refuse a crossfade on a cut away from the selected clip once, naming both, then let the repeat through', async () => {
    const world = await pointingWorld();
    const run = newId<'AgentRun'>();
    // Eval run 11: the bike (clip 1) selected, "a crossfade into the next one" went on clip 2's end. The brief's
    // targets hold the next clip too ("the next one"): one end of the cut named is not the cut.
    const editor = world.docked(0, [0], [1, 0]);
    const away = await world.call('timeline.setTransition', { clip: 2, edge: 'end', kind: 'dissolve' }, editor, run);
    expect(!away.ok && away.error.detail).toBe(
      'The person selected clip 1; this transition is on the cut between clip 2 and clip 3. "Into the next one" and ' +
        '"after this" are the selected clip\'s own cut: clip "this", edge "end". Only if their words name the other clip, ' +
        'make the same call again.\n\nWhat each clip shows:\n<untrusted source="vision">\nclip 1: A bike on a bridge\n' +
        'clip 2: A cup of coffee\nclip 3: A busy crossing\n</untrusted>',
    );
    expect(world.transitions()).toBe(0);
    expect((await world.call('timeline.setTransition', { clip: 2, edge: 'end', kind: 'dissolve' }, editor, run)).ok).toBe(true);
    expect(world.transitions()).toBe(1);
    // A cut whose two clips the words both name is in line ("between the coffee and the crossing").
    const both = world.docked(0, [0], [1, 2]);
    expect((await world.call('timeline.setTransition', { clip: 2, edge: 'end', kind: 'fade' }, both)).ok).toBe(true);
  });

  it('let the selected clip’s own cut, "this", "next" and a clip the selection covers through', async () => {
    const world = await pointingWorld();
    const editor = world.docked(0, [0]);
    expect((await world.call('timeline.setTransition', { clip: 'this', edge: 'end', kind: 'dissolve' }, editor)).ok).toBe(true);
    expect((await world.call('timeline.setTransition', { clip: 2, edge: 'start', kind: 'flash' }, editor)).ok).toBe(true);
    expect((await world.call('timeline.setSpeed', { clip: 'next', speed: 2 }, editor)).ok).toBe(true);
    expect((await world.call('timeline.setSpeed', { clip: 1, speed: 0.5 }, editor)).ok).toBe(true);
  });

  it('refuse a change to a clip away from the selection once, in both tool sets, then let the repeat through', async () => {
    const world = await pointingWorld();
    const run = newId<'AgentRun'>();
    const editor = world.docked(0, [0]);
    const away = await world.call('timeline.setGrade', { clips: [3], look: 'mono' }, editor, run);
    expect(!away.ok && away.error.detail).toMatch(
      /^The person selected clip 1; this changes clip 3\. "This" and "it" are the selection: clip "this"\. Only if their words name the other clip, make the same call again\./,
    );
    expect((await world.call('timeline.setGrade', { clips: [3], look: 'mono' }, editor, run)).ok).toBe(true);
    // A trim (the edit tools) is refused the same way, once in its own run.
    const trim = await world.call('timeline.trimClip', { clip: 4, edge: 'end', by: { seconds: -0.5 } }, editor, newId<'AgentRun'>());
    expect(!trim.ok && trim.error.detail).toMatch(/^The person selected clip 1; this changes clip 4\./);
  });

  it('refuse a transition on another cut than the one at the playhead once, with nothing selected', async () => {
    const world = await pointingWorld();
    const run = newId<'AgentRun'>();
    // Eval runs 10 and 12: "a dip to black here" at the cut between clips 2 and 3 went on clip 3's end.
    const here = world.docked(60);
    const away = await world.call('timeline.setTransition', { clip: 3, edge: 'end', kind: 'fade' }, here, run);
    expect(!away.ok && away.error.detail).toMatch(
      /^The playhead is at the cut between clip 2 and clip 3; this transition is on the cut between clip 3 and clip 4\. For "here", give clip 2 with edge "end"\./,
    );
    expect((await world.call('timeline.setTransition', { clip: 2, edge: 'end', kind: 'fade' }, here, run)).ok).toBe(true);
    // Away from a cut, nothing selected: no guard on transitions.
    expect((await world.call('timeline.setTransition', { clip: 3, edge: 'end', kind: 'fade' }, world.docked(45))).ok).toBe(true);
  });

  it('leave a run outside the docked chat alone', async () => {
    const world = await pointingWorld();
    expect((await world.call('timeline.setTransition', { clip: 3, edge: 'end', kind: 'dissolve' })).ok).toBe(true);
    expect((await world.call('timeline.setGrade', { clips: [4], look: 'mono' })).ok).toBe(true);
  });

  it('allow splitting and editing the new halves of a selected clip without a pointing refusal', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 120 }] });
    const service = createTimelineService({ store: world.store, events: world.events });
    const numbering = createClipNumbering();
    const tools = [
      ...readTools({ service, numbering }),
      ...editTools({ service, numbering }),
      ...editorTools({ service, numbering }),
    ];
    const run = newId<'AgentRun'>();
    const rate = world.doc().canvas.rate;
    const clip2Id = world.built.ids[1] as string;
    const editor: ToolEditorContext = {
      context: {
        timelineId: world.target.timelineId,
        revision: world.doc().revision,
        playhead: RationalTime.of(30, rate),
        selection: [{ kind: 'item', timelineId: world.target.timelineId, itemId: clip2Id, itemKind: 'clip' }],
      } as unknown as EditorContext,
      targets: [{ kind: 'item', timelineId: world.target.timelineId, itemId: clip2Id, itemKind: 'clip' }] as never,
    };
    const call = async (name: string, input: Record<string, unknown>) => {
      const tool = tools.find((candidate) => candidate.name === name) as AnyTool;
      const ctx = { ...agentToolContext(world.bus, tool), runId: run, editor };
      await tools
        .find((candidate) => candidate.name === 'timeline.get')!
        .run({ timelineId: world.target.timelineId }, ctx);
      return tool.run(tool.input.parse({ ...world.target, ...input }), ctx);
    };
    // Split clip 2 (1.0s..5.0s) into clip 2 (1.0s..2.5s) and clip 3 (2.5s..5.0s), then split clip 3 (2.5s..5.0s) into clip 3 and clip 4.
    expect((await call('timeline.splitClip', { clip: 2, atSeconds: 2.5 })).ok).toBe(true);
    expect((await call('timeline.splitClip', { clip: 3, atSeconds: 3.75 })).ok).toBe(true);
    expect((await call('timeline.setGrade', { clips: [3, 4], look: 'warm' })).ok).toBe(true);
    // Clip 1 (outside the selected clip 2's original span) is still guarded.
    const off = await call('timeline.setGrade', { clips: [1], look: 'mono' });
    expect(!off.ok && off.error.detail).toMatch(/^The person selected clip 2; this changes clip 1\./);
  });
});

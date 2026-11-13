// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: older callers' clip fields mended to the renamed ones (clip-mend.ts `mendClipFields`, core
 * `ToolSpec.mendInput`, which the executor applies before it checks an input). An MCP client, a stored or recorded
 * call and a QA fix still send `clipId`, `clipIds` and an insert's `position.itemId`; each tool family takes them.
 * The command each call dispatches carries the clip's id, never its number, so undo and the changes card stay right
 * after the order changes.
 */
import { RationalTime, type AnyTool } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineService } from '../../src/service/service';
import { mendClipFields, mendMoveFields, mendTrimFields } from '../../src/tools/clip-mend';
import { createClipNumbering } from '../../src/tools/clip-refs';
import { editTools } from '../../src/tools/edit-tools';
import { audioEditToolModule, editorTools } from '../../src/tools/editor-tools';
import { editorWorld } from '../editor/editor-world';
import { agentToolContext } from '../fixtures/tool-context';
import { clipById } from '../fixtures/timeline';

const four = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }, { frames: 30 }] };

async function mendWorld() {
  const world = await editorWorld(four);
  const service = createTimelineService({ store: world.store, events: world.events });
  const numbering = createClipNumbering();
  const tools = [
    ...editTools({ service, numbering }),
    ...editorTools({ service, numbering }),
    ...audioEditToolModule({ timelines: world.store }).tools,
  ];
  const ids = world.built.ids as string[];
  const sent: Record<string, unknown>[] = [];
  /** As the executor runs a call: the tool's mend, the input check, then the tool, which dispatches the command. */
  async function call(name: string, raw: Record<string, unknown>) {
    const tool = tools.find((candidate) => candidate.name === name) as AnyTool;
    const mended = tool.mendInput ? tool.mendInput({ ...world.target, ...raw }) : { ...world.target, ...raw };
    const parsed = tool.input.safeParse(mended);
    if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
    const ctx = agentToolContext(world.bus, tool);
    const dispatch = ctx.dispatch;
    return tool.run(parsed.data, {
      ...ctx,
      dispatch: (payload: unknown) => (sent.push(payload as Record<string, unknown>), dispatch(payload as never)),
    } as never);
  }
  const order = () => world.doc().tracks[0]!.items.map((item) => item.id as string);
  /** The middle of a clip, in seconds from the video's start. */
  const middleOf = (id: string) => {
    const doc = world.doc();
    const rate = doc.canvas.rate;
    let at = 0;
    for (const item of doc.tracks[0]!.items) {
      const frames = 'duration' in item ? RationalTime.toFrames(item.duration, rate) : 0;
      if (item.id === id) return ((at + frames / 2) * rate.den) / rate.num;
      at += frames;
    }
    throw new Error(`no ${id}`);
  };
  return { ...world, ids, sent, call, order, middleOf };
}

describe('older callers’ clip fields (EDT1-OPS)', () => {
  it('mend clipId to clip, clipIds to clips, an insert’s itemId to clip, and keep a field sent by its new name', () => {
    expect(mendClipFields({ clipId: 'a', edge: 'end' })).toEqual({ clip: 'a', edge: 'end' });
    expect(mendClipFields({ clipIds: ['a'], look: 'mono' })).toEqual({ clips: ['a'], look: 'mono' });
    expect(mendClipFields({ of: { kind: 'clips', clipIds: ['a'] } })).toEqual({ of: { kind: 'clips', clips: ['a'] } });
    expect(mendClipFields({ position: { kind: 'after', itemId: 'a' } })).toEqual({ position: { kind: 'after', clip: 'a' } });
    expect(mendClipFields({ position: { kind: 'time', atSeconds: 1 } })).toEqual({ position: { kind: 'time', atSeconds: 1 } });
    expect(mendClipFields({ clip: 2, clipId: 'a' })).toEqual({ clip: 2 });
    expect(mendClipFields('x')).toBe('x');
    // A move's toIndex, from 0, is to, from 1; a to sent too is kept.
    expect(mendMoveFields({ clipId: 'a', toIndex: 0 })).toEqual({ clip: 'a', to: 1 });
    expect(mendMoveFields({ clip: 2, toIndex: 0, to: 'end' })).toEqual({ clip: 2, to: 'end' });
    // A negative or fractional toIndex goes on as words, for the tool to refuse with the numbers.
    expect(mendMoveFields({ clip: 2, toIndex: -1 })).toEqual({ clip: 2, to: '-1' });
    expect(mendMoveFields({ clip: 2, toIndex: 1.5 })).toEqual({ clip: 2, to: '1.5' });
    expect(mendMoveFields({ clip: 2, toIndex: '3' })).toEqual({ clip: 2, to: 4 });
    // An older caller's bySeconds and byBeats become by's forms.
    const by = { value: -1, rate: { num: 30, den: 1 } };
    expect(mendTrimFields({ clip: '4', edge: 'end', bySeconds: -0.5 })).toEqual({ clip: '4', edge: 'end', by: { seconds: -0.5 } });
    expect(mendTrimFields({ clip: '4', edge: 'end', byBeats: -1 })).toEqual({ clip: '4', edge: 'end', by: { beats: -1 } });
    // Two lengths keep one: bySeconds, else byBeats, else by. Eval run 13's 9B sent bySeconds 1 with byBeats 2 for "a
    // second longer"; an older run's sent by -1 at the canvas rate beside bySeconds -0.5.
    expect(mendTrimFields({ clip: '1', edge: 'end', bySeconds: 1, byBeats: 2 })).toEqual({ clip: '1', edge: 'end', by: { seconds: 1 } });
    expect(mendTrimFields({ clip: '4', edge: 'end', by, bySeconds: -0.5 })).toEqual({ clip: '4', edge: 'end', by: { seconds: -0.5 } });
    expect(mendTrimFields({ clip: '4', edge: 'end', by, byBeats: -1 })).toEqual({ clip: '4', edge: 'end', by: { beats: -1 } });
    // A by in its own form, the frames QA's fixes give or {"seconds"}, is kept as sent.
    expect(mendTrimFields({ clipId: 'a', edge: 'end', by })).toEqual({ clip: 'a', edge: 'end', by });
    expect(mendTrimFields({ clip: 2, edge: 'start', by: { seconds: 1 } })).toEqual({ clip: 2, edge: 'start', by: { seconds: 1 } });
  });

  it('take the old fields in every tool family: structure, speed, transitions, colour, sound, insert, trim, move', async () => {
    const world = await mendWorld();
    const [first, second, third, fourth] = world.ids as [string, string, string, string];
    expect((await world.call('timeline.setSpeed', { clipId: first, speed: 2 })).ok).toBe(true);
    expect((await world.call('timeline.setTransition', { clipId: first, kind: 'dissolve' })).ok).toBe(true);
    expect((await world.call('timeline.removeTransition', { clipId: first })).ok).toBe(true);
    expect((await world.call('timeline.setGrade', { clipIds: [second], look: 'mono' })).ok).toBe(true);
    expect(clipById(world.doc(), second).grade?.look).toBe('mono');
    expect((await world.call('audio.setVolume', { of: { kind: 'clips', clipIds: [third] }, muted: true })).ok).toBe(true);
    expect(clipById(world.doc(), third).audio.muted).toBe(true);
    const shot = world.shots[0]!;
    const media = { kind: 'video', assetId: shot.assetId, shotId: shot.shotId };
    expect((await world.call('timeline.insertClip', { media, position: { kind: 'after', itemId: fourth } })).ok).toBe(true);
    expect((await world.call('timeline.duplicateClip', { clipId: second })).ok).toBe(true);
    expect((await world.call('timeline.splitClip', { clipId: third, atSeconds: world.middleOf(third) })).ok).toBe(true);
    expect((await world.call('timeline.deleteClip', { clipId: fourth })).ok).toBe(true);
    expect((await world.call('timeline.moveClip', { clipId: first, toIndex: 2 })).ok).toBe(true);
    // As an MCP client sends timeline_trimClip: the old clipId, and `by` at the canvas rate.
    const mcp = { clipId: second, edge: 'end', by: { value: -5, rate: { num: 30, den: 1 } } };
    expect((await world.call('timeline.trimClip', mcp)).ok).toBe(true);
    // An older caller's toIndex of the clip count (after the last clip) is the end; a negative one is refused.
    const count = world.order().length;
    expect((await world.call('timeline.moveClip', { clipId: world.order()[0], toIndex: count })).ok).toBe(true);
    const negative = await world.call('timeline.moveClip', { clipId: world.order()[0], toIndex: -1 });
    expect(!negative.ok && negative.error.detail).toBe(
      `to is "start", "end" or the number the clip will have, 1 to ${count} (the video has ${count} clips): not "-1".`,
    );
    const both = { clip: 1, edge: 'end', by: { value: -1, rate: { num: 30, den: 1 } }, bySeconds: -0.25 };
    const trimmed = await world.call('timeline.trimClip', both);
    expect(trimmed.ok ? 'ok' : trimmed.error).toBe('ok');
    // Run 13's two lengths, as the 9B sent them: kept as one, so the trim goes through.
    const two = await world.call('timeline.trimClip', { clip: 1, edge: 'end', bySeconds: 0.25, byBeats: 1 });
    expect(two.ok ? 'ok' : two.error).toBe('ok');
    expect(world.sent.every((payload) => !('clip' in payload) && !('clips' in payload))).toBe(true);
  });

  it('dispatch the clip’s id for a number, so undo puts the right clip back after the order changed', async () => {
    const world = await mendWorld();
    const before = world.order();
    expect((await world.call('timeline.setSpeed', { clip: 3, speed: 2 })).ok).toBe(true);
    expect(world.sent.at(-1)).toMatchObject({ clipId: world.ids[2] });
    expect(clipById(world.doc(), world.ids[2]!).speed).not.toBeNull();
    expect((await world.call('timeline.moveClip', { clip: 3, toIndex: 0 })).ok).toBe(true);
    expect(world.sent.at(-1)).toMatchObject({ clipId: world.ids[2] });
    // The order changed: what was clip 3 is clip 1 now. Undo takes back the move, then the speed, on that clip.
    expect(world.order()[0]).toBe(world.ids[2]);
    expect((await world.undo()).ok).toBe(true);
    expect(world.order()).toEqual(before);
    expect((await world.undo()).ok).toBe(true);
    expect(clipById(world.doc(), world.ids[2]!).speed).toBeNull();
    expect(world.ids.map((id) => clipById(world.doc(), id).speed)).toEqual([null, null, null, null]);
    expect(RationalTime.toFrames(clipById(world.doc(), world.ids[2]!).duration, world.doc().canvas.rate)).toBe(30);
  });
});

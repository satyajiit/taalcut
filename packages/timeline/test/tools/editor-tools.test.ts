// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the editor tools as the agent calls them: seconds in, the command on the bus as the agent, the item
 * made answered; and timeline.get's view of what they did (seconds, speed, transitions, sound, colour, markers).
 */
import { toolModuleProblems, type AnyTool } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTimelineService } from '../../src/service/service';
import { editTools } from '../../src/tools/edit-tools';
import { audioEditToolModule, editorTools } from '../../src/tools/editor-tools';
import { readTools } from '../../src/tools/read-tools';
import { editorWorld } from '../editor/editor-world';
import { agentToolContext } from '../fixtures/tool-context';
import { clipById } from '../fixtures/timeline';

const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] };
const all = [...editorTools(), ...audioEditToolModule().tools];

async function toolWorld() {
  const world = await editorWorld(three);
  const service = createTimelineService({ store: world.store, events: world.events });
  const get = readTools({ service }).find((tool) => tool.name === 'timeline.get') as AnyTool;
  const tools = [...editorTools({ service }), ...audioEditToolModule().tools];
  async function call(name: string, input: Record<string, unknown>) {
    const tool = (name === 'timeline.get' ? get : tools.find((candidate) => candidate.name === name)) as AnyTool;
    const parsed = tool.input.safeParse(name === 'timeline.get' ? input : { ...world.target, ...input });
    if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
    const ran = await tool.run(parsed.data, agentToolContext(world.bus, tool));
    return ran.ok ? { ok: true as const, value: tool.output.parse(ran.value) as Record<string, unknown> } : ran;
  }
  return { ...world, call };
}

describe('the editor tools', () => {
  it('declare full metadata, in the timeline module and an audio one, and export JSON Schema', () => {
    expect(editorTools().map((tool) => tool.name)).toHaveLength(10);
    expect(toolModuleProblems(audioEditToolModule())).toEqual([]);
    for (const tool of all) {
      expect(() => z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'throw' })).not.toThrow();
      expect(tool.command).toBe(tool.name);
      expect(tool.sideEffect).toBe('write');
    }
  });

  it('take the only transition out when removeTransition names neither it nor its clip', async () => {
    const world = await toolWorld();
    const [first, second] = world.built.ids;
    const none = await world.call('timeline.removeTransition', {});
    expect(!none.ok && none.error.detail).toBe('The video has no transitions to take out.');
    await world.call('timeline.setTransition', { clip: first, kind: 'dissolve' });
    await world.call('timeline.setTransition', { clip: second, kind: 'whip' });
    const two = await world.call('timeline.removeTransition', {});
    expect(!two.ok && two.error.detail).toMatch(/has 2 transitions: give the transitionId/);
    await world.call('timeline.removeTransition', { clip: second });
    expect((await world.call('timeline.removeTransition', {})).ok).toBe(true);
    const view = await world.call('timeline.get', { timelineId: world.target.timelineId });
    expect(view.ok && view.value.transitions).toEqual([]);
    const both = editorTools()
      .find((tool) => tool.name === 'timeline.removeTransition')!
      .input.safeParse({ ...world.target, transitionId: first, clip: first });
    expect(both.success).toBe(false);
  });

  it('take seconds and land on frames, answering the item they made', async () => {
    const world = await toolWorld();
    const [first, second] = world.built.ids;
    const split = await world.call('timeline.splitClip', { clip: second, atSeconds: 1.5 });
    expect(split.ok && split.value.itemId).toEqual(expect.any(String));
    expect(clipById(world.doc(), second as string).duration.value).toBe(15);
    await world.call('timeline.setSpeed', { clip: first, speed: 0.5 });
    expect(clipById(world.doc(), first as string).duration.value).toBe(60);
    const fade = await world.call('timeline.setTransition', { clip: first, kind: 'dissolve', durationSeconds: 0.4 });
    expect(fade.ok && fade.value.itemId).toEqual(expect.any(String));
    await world.call('timeline.setGrade', { clips: [first], temperature: 0.3 });
    await world.call('timeline.setGrade', { temperature: -0.2, reset: true });
    await world.call('audio.setVolume', { of: { kind: 'clips', clips: [first] }, muted: false, fadeOutSeconds: 0.5 });
    await world.call('timeline.addMarker', { atSeconds: 2, label: 'Check' });

    const read = await world.call('timeline.get', { timelineId: world.target.timelineId });
    if (!read.ok) throw new Error(read.error.code);
    const view = read.value as {
      seconds: number;
      clips: { clipId: string; at: number; seconds: number; speed: number; sound: { muted: boolean; fadeOut: number }; grade?: { temperature: number } }[];
      transitions: { fromClipId: string; kind: string; seconds: number }[];
      grade?: { temperature: number };
      markers: { at: number; label: string }[];
      music: unknown;
    };
    expect(view.clips[0]).toMatchObject({ clipId: first, at: 0, seconds: 2, speed: 0.5, sound: { muted: false, fadeOut: 0.5 }, grade: { temperature: 0.3 } });
    expect(view.transitions).toEqual([expect.objectContaining({ fromClipId: first, kind: 'dissolve', seconds: 0.4 })]);
    expect([view.seconds, view.grade?.temperature, view.markers[0]?.at, view.music]).toEqual([4, -0.2, 2, null]);
  });

  it('take a look by name, and none takes it off; the view gives the beat', async () => {
    const world = await toolWorld();
    const [first] = world.built.ids;
    await world.call('timeline.setGrade', { clips: [first], look: 'mono' });
    expect(clipById(world.doc(), first as string).grade?.look).toBe('mono');
    await world.call('timeline.setGrade', { clips: [first], look: 'none' });
    expect(clipById(world.doc(), first as string).grade?.look ?? null).toBeNull();
    const setGrade = all.find((tool) => tool.name === 'timeline.setGrade') as AnyTool;
    expect(setGrade.input.safeParse({ ...world.target, look: null }).success).toBe(false);
    const read = await world.call('timeline.get', { timelineId: world.target.timelineId });
    if (!read.ok) throw new Error(read.error.code);
    const beat = (read.value as { beat?: { seconds: number; frames: number } }).beat;
    if (world.doc().beatMap) expect(beat).toEqual({ seconds: expect.any(Number), frames: expect.any(Number) });
    else expect(beat).toBeUndefined();
  });

  it('softens selected highlights and whites undoably, preserves other adjustments, and resets them', async () => {
    const world = await toolWorld();
    const [first, second] = world.built.ids;
    await world.call('timeline.setGrade', { clips: [first], temperature: 0.3 });
    const changed = await world.call('timeline.setGrade', { clips: [first], highlights: -0.6, whites: -0.4 });
    expect(changed.ok).toBe(true);
    expect(clipById(world.doc(), first!).grade).toMatchObject({
      temperature: 0.3,
      highlights: -0.6,
      whites: -0.4,
    });
    expect(clipById(world.doc(), second!).grade).toBeUndefined();
    await world.undo();
    expect(clipById(world.doc(), first!).grade).toMatchObject({ temperature: 0.3 });
    expect(clipById(world.doc(), first!).grade?.highlights).toBeUndefined();
    await world.redo();
    expect(clipById(world.doc(), first!).grade?.highlights).toBe(-0.6);
    await world.call('timeline.setGrade', { clips: [first], reset: true });
    expect(clipById(world.doc(), first!).grade).toBeUndefined();
    const tool = all.find((candidate) => candidate.name === 'timeline.setGrade')!;
    expect(tool.input.safeParse({ ...world.target, highlights: -1.1 }).success).toBe(false);
    expect(tool.input.safeParse({ ...world.target, whites: 1.1 }).success).toBe(false);
  });

  it('give the model trimClip’s length as a oneOf of closed objects, inside a plain object (EDT1-OPS)', () => {
    const trim = editTools().find((tool) => tool.name === 'timeline.trimClip') as AnyTool;
    const schema = z.toJSONSchema(trim.input, { io: 'input', unrepresentable: 'any' }) as {
      type: string;
      properties: Record<string, { oneOf?: { properties: Record<string, unknown>; additionalProperties: boolean; required: string[] }[] }>;
      required: string[];
    } & Record<string, unknown>;
    // Anthropic's API refuses a oneOf, anyOf or allOf at the top of a tool's input, so the choice sits in `by`.
    expect(schema.type).toBe('object');
    expect([schema.oneOf, schema.anyOf, schema.allOf]).toEqual([undefined, undefined, undefined]);
    expect(Object.keys(schema.properties)).not.toContain('bySeconds');
    expect(Object.keys(schema.properties)).not.toContain('byBeats');
    expect(schema.required).toContain('by');
    // Closed branches: the grammar can take one, and only one, of seconds, beats and the command's frames.
    const forms = schema.properties.by!.oneOf!.map((form) => [Object.keys(form.properties), form.required, form.additionalProperties]);
    expect(forms).toEqual([
      [['seconds'], ['seconds'], false],
      [['beats'], ['beats'], false],
      [['value', 'rate'], ['value', 'rate'], false],
    ]);
  });

  it('trim a clip by seconds as by frames, and say where a refused split may go', async () => {
    const trim = editTools().find((tool) => tool.name === 'timeline.trimClip') as AnyTool;
    const lengthAfter = async (by: Record<string, unknown>) => {
      const world = await editorWorld(three);
      const last = world.built.ids[2] as string;
      const input = trim.input.parse({ ...world.target, clip: last, edge: 'end', ...by });
      const ran = await trim.run(input, agentToolContext(world.bus, trim));
      if (!ran.ok) throw new Error(ran.error.code);
      return clipById(world.doc(), last).duration.value;
    };
    expect(await lengthAfter({ by: { seconds: -0.5 } })).toBe(await lengthAfter({ by: { value: -15, rate: { num: 30, den: 1 } } }));
    expect(trim.input.safeParse({ clip: 'x', edge: 'end' }).success).toBe(false);
    const world = await toolWorld();
    const split = await world.call('timeline.splitClip', { clip: world.built.ids[1], atSeconds: 0.2 });
    expect(!split.ok && split.error.detail).toMatch(/plays from 1 s to 2 s of the video \(its middle is 1.5 s\)/);
  });

  it('slide a text box that runs off the frame back in, and take whose sound as a choice that has no "original"', async () => {
    const world = await editorWorld({ ...three, texts: [{ start: 0, frames: 30 }] });
    const text = world.doc().tracks.flatMap((track) => (track.kind === 'text' ? track.items : []))[0]!;
    const moveText = editTools().find((tool) => tool.name === 'timeline.moveText') as AnyTool;
    const input = moveText.input.parse({ ...world.target, itemId: text.id, box: { x: 0.5, y: 0.75, width: 0.6, height: 0.15 } });
    const moved = await moveText.run(input, agentToolContext(world.bus, moveText));
    expect(moved.ok).toBe(true);
    const after = world.doc().tracks.flatMap((track) => (track.kind === 'text' ? track.items : []))[0]!;
    if (after.type !== 'text') throw new Error('No text');
    const { box } = after;
    expect([box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100)).toEqual([0.4, 0.75, 0.6, 0.15]);
    const volume = all.find((tool) => tool.name === 'audio.setVolume') as AnyTool;
    const clipIds = [world.built.ids[0]];
    expect(volume.input.safeParse({ ...world.target, of: { kind: 'clips', clips: clipIds }, muted: true }).success).toBe(true);
    expect(volume.input.safeParse({ ...world.target, of: { kind: 'sound', sound: 'original' }, muted: true }).success).toBe(false);
    // Whose sound is required: a call can't leave it out.
    expect(volume.input.safeParse({ ...world.target, clipIds, muted: true }).success).toBe(false);
  });

  it('timeline.get with atSeconds says which clip plays then, and the cut near it', async () => {
    const world = await toolWorld();
    const [first, second] = world.built.ids;
    const read = async (atSeconds?: number) => {
      const got = await world.call('timeline.get', { timelineId: world.target.timelineId, ...(atSeconds === undefined ? {} : { atSeconds }) });
      if (!got.ok) throw new Error(got.error.code);
      return (got.value as { here?: unknown }).here;
    };
    expect(await read(1.5)).toEqual({ atSeconds: 1.5, clip: 2, clipId: second });
    expect(await read(1.1)).toEqual({
      atSeconds: 1.1,
      clip: 2,
      clipId: second,
      cut: { atSeconds: 1, beforeClip: 1, afterClip: 2, beforeClipId: first, afterClipId: second },
    });
    expect(await read(9)).toEqual({ atSeconds: 9, clip: null, clipId: null });
    expect(await read()).toBeUndefined();
  });

  it('pass the command’s refusals on, and refuse an input with neither or both of a pair', async () => {
    const world = await toolWorld();
    const music = await world.call('audio.setVolume', { of: { kind: 'sound', sound: 'music' }, changeDb: -3 });
    expect(!music.ok && music.error.code).toBe('timeline.invalid_move');
    const speed = all.find((tool) => tool.name === 'timeline.setSpeed') as AnyTool;
    expect(speed.input.safeParse({ ...world.target, clip: world.built.ids[0] }).success).toBe(false);
    const volume = all.find((tool) => tool.name === 'audio.setVolume') as AnyTool;
    expect(volume.input.safeParse({ ...world.target, of: { kind: 'sound', clips: [world.built.ids[0]] }, muted: true }).success).toBe(false);
  });

  it('timeline.get says what each clip shows, cut short, and reads the same without descriptions', async () => {
    const world = await editorWorld(three);
    const service = createTimelineService({ store: world.store, events: world.events });
    const shotIds = world.doc().tracks[0]!.items.flatMap((item) =>
      item.type === 'clip' && item.media.kind === 'video' ? [item.media.shotId as string] : [],
    );
    const said = new Map([
      [shotIds[0]!, 'A hand lifts a cup of coffee at a cafe table'],
      [shotIds[1]!, `A long walk ${'along the shore '.repeat(12)}`],
    ]);
    const read = async (deps: Parameters<typeof readTools>[0], docked = false) => {
      const get = readTools(deps).find((tool) => tool.name === 'timeline.get') as AnyTool;
      // EDT1-OPS: a docked run's rows name their clip by number (clip-refs.ts).
      const editor = docked ? { editor: { context: {} as never, targets: [] } } : {};
      const ran = await get.run({ timelineId: world.target.timelineId }, { ...agentToolContext(world.bus, get), ...editor });
      if (!ran.ok) throw new Error(ran.error.code);
      return (get.output.parse(ran.value) as { clips: { shows?: string }[] }).clips.map((clip) => clip.shows);
    };
    const describe: NonNullable<Parameters<typeof readTools>[0]['shotDescriptions']> = async (ids) => ({
      ok: true,
      value: new Map([...said].filter(([id]) => (ids as readonly string[]).includes(id))),
    });
    const shows = await read({ service, shotDescriptions: describe });
    expect(shows[0]).toBe(`${world.built.ids[0]}: A hand lifts a cup of coffee at a cafe table`);
    expect((await read({ service, shotDescriptions: describe }, true))[0]).toBe('clip 1: A hand lifts a cup of coffee at a cafe table');
    expect(shows[1]).toHaveLength(`${world.built.ids[1]}: `.length + 120);
    expect(shows[1]?.endsWith('…')).toBe(true);
    expect(shows[2]).toBeUndefined();
    expect(await read({ service, shotDescriptions: async () => Promise.reject(new Error('gone')) })).toEqual([undefined, undefined, undefined]);
    expect(await read({ service })).toEqual([undefined, undefined, undefined]);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the guard on whole-video changes in a docked run. The whole video's colour, or every clip's sound, asked
 * without wholeVideo while the person pointed at a clip, is refused once with that clip's id and what to call; the
 * repeat, wholeVideo, a clip's own change and a run that isn't docked go through.
 */
import {
  newId,
  RationalTime,
  type AnyTool,
  type EditItemTarget,
  type EditorContext,
  type RunId,
  type ToolEditorContext,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineService } from '../../src/service/service';
import { audioEditToolModule, editorTools } from '../../src/tools/editor-tools';
import { editorWorld } from '../editor/editor-world';
import { agentToolContext } from '../fixtures/tool-context';

const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] };

async function guardWorld() {
  const world = await editorWorld(three);
  const service = createTimelineService({ store: world.store, events: world.events });
  const tools = [...editorTools({ service }), ...audioEditToolModule({ timelines: world.store }).tools];
  const ids = world.built.ids as string[];
  /** A docked run's editor: the playhead (in frames) and what the words point at. */
  const docked = (playhead: number, pointed: readonly string[] = []): ToolEditorContext => ({
    context: {
      timelineId: world.target.timelineId,
      revision: world.doc().revision,
      playhead: RationalTime.of(playhead, world.doc().canvas.rate),
      selection: [],
    } as unknown as EditorContext,
    targets: pointed.map(
      (itemId) => ({ kind: 'item', timelineId: world.target.timelineId, itemId, itemKind: 'clip' }) as EditItemTarget,
    ),
  });
  async function call(name: string, input: Record<string, unknown>, runId: RunId, editor?: ToolEditorContext) {
    const tool = tools.find((candidate) => candidate.name === name) as AnyTool;
    const parsed = tool.input.parse({ ...world.target, ...input });
    return tool.run(parsed, { ...agentToolContext(world.bus, tool), runId, ...(editor ? { editor } : {}) });
  }
  return { ...world, ids, docked, call };
}

const run = () => newId<'AgentRun'>();

describe('the guard on whole-video changes (EDT1-OPS)', () => {
  it('refuses the whole video’s colour once, naming the clip under the playhead; the repeat goes through', async () => {
    const world = await guardWorld();
    const id = run();
    const editor = world.docked(45);
    const first = await world.call('timeline.setGrade', { look: 'mono' }, id, editor);
    expect(!first.ok && first.error.code).toBe('timeline.invalid_move');
    expect(!first.ok && first.error.detail).toBe(
      `This would change the whole video's colour. The playhead is on clip 2: give clips [2] (or ["this"]) for ` +
        `"this", "here" or "it". Only if their words ask for the whole video ("the whole video", "everything", "all ` +
        `the clips"), call again with wholeVideo true.`,
    );
    expect(world.doc().grade ?? null).toBeNull();
    expect((await world.call('timeline.setGrade', { look: 'mono' }, id, editor)).ok).toBe(true);
    expect(world.doc().grade?.look).toBe('mono');
  });

  it('names what the words point at, and lets wholeVideo, a clip’s own colour and an undocked run through', async () => {
    const world = await guardWorld();
    const pointed = await world.call('timeline.setGrade', { saturation: -1 }, run(), world.docked(0, [world.ids[2]!]));
    expect(!pointed.ok && pointed.error.detail).toMatch(/^This would change the whole video's colour\. The person pointed at clip 3: give clips \[3\]/);
    expect((await world.call('timeline.setGrade', { saturation: -1, wholeVideo: true }, run(), world.docked(0))).ok).toBe(true);
    expect((await world.call('timeline.setGrade', { clips: [world.ids[0]], temperature: 0.3 }, run(), world.docked(0))).ok).toBe(true);
    expect((await world.call('timeline.setGrade', { temperature: 0.2 }, run())).ok).toBe(true);
  });

  it('refuses every clip’s sound once, and lets some clips and wholeVideo through', async () => {
    const world = await guardWorld();
    const id = run();
    const editor = world.docked(0, [world.ids[0]!]);
    const every = { of: { kind: 'clips', clips: world.ids }, muted: true };
    const refused = await world.call('audio.setVolume', every, id, editor);
    expect(!refused.ok && refused.error.detail).toBe(
      "This changes every clip's own sound. The person pointed at clip 1: [1]. Give only the numbers of the clips " +
        'the words point at or name (a clip named by what it shows is the clip whose shows has it). Only if their ' +
        'words ask for every clip ("all the clips", "everything"), call again with wholeVideo true.',
    );
    expect((await world.call('audio.setVolume', { of: { kind: 'clips', clips: [world.ids[0]] }, muted: true }, id, editor)).ok).toBe(true);
    expect((await world.call('audio.setVolume', { ...every, wholeVideo: true }, run(), editor)).ok).toBe(true);
    expect((await world.call('audio.setVolume', every, id, editor)).ok).toBe(true);
  });
});

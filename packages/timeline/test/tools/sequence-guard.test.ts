// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: texts the reference shows in turn at one place stay one at a time (sequence-guard.ts). timeline.editText
 * refuses a change that lays one of them over another's turn and says what the reference did; changing the words,
 * retiming a text that is in no sequence, and a timeline without a template go through. In a docked run the refusal
 * comes once. Assembly gives each of a sequence's overlays its own item at the overlay's time.
 */
import {
  newId,
  ok,
  RationalTime,
  type AnyTool,
  type EditorContext,
  type RunId,
  type Template,
  type TextItem,
  type TextOverlay,
  type Timeline,
  type ToolEditorContext,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { textTracksFor } from '../../src/assembly/text';
import { createTimelineService } from '../../src/service/service';
import { createClipNumbering } from '../../src/tools/clip-refs';
import { editTools } from '../../src/tools/edit-tools';
import { sequenceBreak } from '../../src/tools/sequence-guard';
import { editorWorld } from '../editor/editor-world';
import { agentToolContext } from '../fixtures/tool-context';

const rate = { num: 30, den: 1 };
const at = (frames: number) => RationalTime.of(frames, rate);
/** Nine words in turn, with no pause between them: [word, start, end) in frames. */
const WORDS: readonly (readonly [string, number, number])[] = [
  ['I hope', 10, 44],
  ['You', 44, 52],
  ['Leave', 52, 70],
  ['And', 70, 81],
  ["Don't", 81, 98],
  ['Come', 98, 110],
  ['Back', 110, 127],
  ['Cause', 127, 141],
  ["I'm", 141, 153],
];

function overlay(text: string, start: number, end: number, box?: TextOverlay['box']): TextOverlay {
  const width = 0.05 * text.length;
  return {
    id: newId<'TextOverlay'>(),
    text,
    role: 'label',
    start: at(start),
    duration: at(end - start),
    slotId: null,
    box: box ?? { x: 0.5 - width / 2, y: 0.47, width, height: 0.045 },
    appearance: { size: 0.03, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'label',
    reveal: 'none',
    language: 'en',
    confidence: 1,
  };
}

/** A template's text and canvas: the nine words and a title that is on its own. */
function reference() {
  const words = WORDS.map(([text, start, end]) => overlay(text, start, end));
  const title = overlay('Pune to Kolkata', 170, 260, { x: 0.2, y: 0.1, width: 0.6, height: 0.06 });
  const template = { text: [...words, title], canvas: { width: 1080, height: 1920, rate } };
  return { words, title, template: template as unknown as Template };
}

/** A timeline with an item for each of `overlays`, as assembly makes them. */
async function madeWorld(overlays: readonly TextOverlay[], template: Template | null) {
  const templateId = newId<'Template'>();
  const world = await editorWorld(
    {
      clips: [{ frames: 150 }, { frames: 150 }],
      texts: overlays.map((item) => ({ start: item.start.value, frames: item.duration.value })),
    },
    undefined,
    (timeline): Timeline => ({
      ...timeline,
      template: template ? { id: templateId, version: 1 } : null,
      tracks: timeline.tracks.map((track) =>
        track.kind === 'text'
          ? {
              ...track,
              items: track.items.map((item, index) => ({
                ...(item as TextItem),
                overlayId: overlays[index]!.id,
              })),
            }
          : track,
      ),
    }),
  );
  const service = createTimelineService({ store: world.store, events: world.events });
  const numbering = createClipNumbering();
  const tools = editTools({
    service,
    numbering,
    ...(template ? { templates: { read: async () => ok(template) } } : {}),
  });
  const editText = tools.find((tool) => tool.name === 'timeline.editText') as AnyTool;
  const items = () => world.doc().tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));
  const itemOf = (overlayId: string) =>
    items().find((item) => item.type === 'text' && item.overlayId === overlayId)!;
  const docked = (): ToolEditorContext => ({
    context: {
      timelineId: world.target.timelineId,
      revision: world.doc().revision,
      playhead: at(0),
      selection: [],
    } as unknown as EditorContext,
    targets: [],
  });
  async function call(input: Record<string, unknown>, editor?: ToolEditorContext, runId?: RunId) {
    const ctx = {
      ...agentToolContext(world.bus, editText),
      runId: runId ?? newId<'AgentRun'>(),
      ...(editor ? { editor } : {}),
    };
    return editText.run(editText.input.parse({ ...world.target, ...input }), ctx);
  }
  return { ...world, items, itemOf, docked, call };
}

describe('sequenceBreak', () => {
  it('says what the reference did when a text is stretched over the others’ turns', async () => {
    const { words, template } = reference();
    const world = await madeWorld(words, template);
    const first = world.itemOf(words[0]!.id);
    const said = sequenceBreak(world.doc(), template, [
      { itemId: first.id, duration: RationalTime.of(6620, { num: 1000, den: 1 }) },
    ]);
    expect(said).toBe(
      'This is text 1 of the 9 the reference shows in turn at one place, about 0.5 s each (0.33–5.10 s). This change ' +
        'would keep it on screen over the turns of 8 others: 6.6 s where the reference gives each its own turn. Keep one ' +
        'text item for each turn, at its own time and length, and change its words only.',
    );
  });

  it('counts a text removed in the same call: removing the rest and stretching one is the same block', async () => {
    const { words, template } = reference();
    const world = await madeWorld(words, template);
    const [first, ...rest] = words.map((word) => world.itemOf(word.id));
    const edits = [
      { itemId: first!.id, duration: at(143) },
      ...rest.map((item) => ({ itemId: item.id, remove: true })),
    ];
    expect(sequenceBreak(world.doc(), template, edits)).toMatch(/over the turns of 8 others/);
    // Removing words without stretching another keeps what is left in turn.
    expect(
      sequenceBreak(
        world.doc(),
        template,
        rest.slice(0, 3).map((item) => ({ itemId: item.id, remove: true })),
      ),
    ).toBeNull();
  });

  it('lets every text move in step, a small change of one, and a text that is in no sequence', async () => {
    const { words, title, template } = reference();
    const world = await madeWorld([...words, title], template);
    const items = words.map((word) => world.itemOf(word.id));
    const later = items.map((item) => ({ itemId: item.id, start: at(item.start.value + 15) }));
    expect(sequenceBreak(world.doc(), template, later)).toBeNull();
    // Three frames more of "Leave" is on a quarter of the next word's turn, not half.
    expect(sequenceBreak(world.doc(), template, [{ itemId: items[2]!.id, duration: at(21) }])).toBeNull();
    expect(
      sequenceBreak(world.doc(), template, [
        { itemId: world.itemOf(title.id).id, start: at(0), duration: at(280) },
      ]),
    ).toBeNull();
  });
});

describe('timeline.editText on a sequence (LYR1)', () => {
  it('refuses to stretch one of the texts over the others, and still changes its words', async () => {
    const { words, template } = reference();
    const world = await madeWorld(words, template);
    const second = world.itemOf(words[1]!.id);
    const block = await world.call({
      itemId: second.id,
      text: 'you even don’t come back',
      atSeconds: 0.33,
      durationSeconds: 4.7,
    });
    expect(!block.ok && block.error.detail).toMatch(
      /^This is text 2 of the 9 the reference shows in turn at one place, about 0\.5 s each \(0\.33–5\.10 s\)\. This change would keep it on screen over the turns of 8 others/,
    );
    expect(world.itemOf(words[1]!.id).duration.value).toBe(8);
    // The same refusal again: outside a docked run it stands.
    expect((await world.call({ itemId: second.id, atSeconds: 0.33, durationSeconds: 4.7 })).ok).toBe(false);
    const reworded = await world.call({ itemId: second.id, text: 'We' });
    expect(reworded.ok).toBe(true);
    expect((world.itemOf(words[1]!.id) as TextItem).text).toBe('We');
    expect(world.itemOf(words[1]!.id).duration.value).toBe(8);
  });

  it('refuses a batch that removes the rest and stretches one', async () => {
    const { words, template } = reference();
    const world = await madeWorld(words, template);
    const [first, ...rest] = words.map((word) => world.itemOf(word.id));
    const merged = await world.call({
      edits: [
        { itemId: first!.id, text: 'Oh, you even don’t come back', durationSeconds: 4.7 },
        ...rest.map((item) => ({ itemId: item.id, remove: true })),
      ],
    });
    expect(merged.ok).toBe(false);
    expect(world.items()).toHaveLength(9);
  });

  it('refuses once in a docked run, then lets the same call through: the person may want one block', async () => {
    const { words, template } = reference();
    const world = await madeWorld(words, template);
    const run = newId<'AgentRun'>();
    const editor = world.docked();
    const first = world.itemOf(words[0]!.id);
    const input = { itemId: first.id, durationSeconds: 4.7 };
    const refused = await world.call(input, editor, run);
    expect(!refused.ok && refused.error.detail).toMatch(
      /change its words only\. Only if the person asked for one block of text, make the same call again\.$/,
    );
    expect((await world.call(input, editor, run)).ok).toBe(true);
    expect(world.itemOf(words[0]!.id).duration.value).toBe(141);
  });

  it('leaves a timeline without a template, and tools without a template reader, alone', async () => {
    const { words, template } = reference();
    const bare = await madeWorld(words, null);
    const first = bare.itemOf(words[0]!.id);
    expect((await bare.call({ itemId: first.id, durationSeconds: 4.7 })).ok).toBe(true);
    expect(template.text).toHaveLength(10);
  });
});

describe('assembly of a sequence (LYR1)', () => {
  it('gives each of the template’s texts in turn its own item, at its own time and length, on one track', () => {
    const { words, title, template } = reference();
    const full = { ...template, graphics: undefined, beatMap: null, slots: [] } as unknown as Template;
    let next = 0;
    const tracks = textTracksFor(full, {}, { item: () => `item${next++}` as never });
    const made = tracks.flatMap((track) => track.items).filter((item) => item.type === 'text');
    expect(made.map((item) => [item.text, item.start.value, item.duration.value])).toEqual([
      ...WORDS.map(([text, start, end]) => [text, start, end - start]),
      [title.text, 170, 90],
    ]);
    expect(made.slice(0, 9).map((item) => item.overlayId)).toEqual(words.map((word) => word.id));
    // In turn, so they never overlap: one track holds them all.
    expect(tracks).toHaveLength(1);
  });

  it('leaves a text the breakdown could not read out of the made video, and keeps the others’ times', () => {
    const { words, template } = reference();
    const unread = { ...words[3]!, text: '…', doubts: [{ reason: 'textMaybeScene' as const }] };
    const text = template.text.map((item) => (item.id === unread.id ? unread : item));
    const full = { ...template, text, graphics: undefined, beatMap: null, slots: [] } as unknown as Template;
    let next = 0;
    const made = textTracksFor(full, {}, { item: () => `item${next++}` as never }).flatMap(
      (track) => track.items,
    );
    expect(made.map((item) => item.start.value)).toEqual([10, 44, 52, 81, 98, 110, 127, 141, 170]);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: a sequence's pieces in one picture (sequence-sheet.ts) and what a vision model states about them applied to
 * the draft (sequence-read.ts), on made-up pixels and a scripted model: a piece the text engine could not read takes
 * the stated words, a spelling is corrected only when the two readings are alike, a piece with no text goes, and the
 * model is asked once for a reel.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, FrameRate, newId, ok, RationalTime, textOverlaySchema, UnknownError } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import type { BreakdownDraft } from '../src/breakdown/draft';
import type { GraphicModel, GraphicModelRequest } from '../src/breakdown/graphic-brief';
import { promptOverlays } from '../src/breakdown/graphic-brief';
import type { BreakdownAnalysers } from '../src/breakdown/ports';
import {
  readSequenceAnswer,
  readSequences,
  SEQUENCES_FILE,
  sequenceQuestion,
  withSequenceReading,
} from '../src/breakdown/sequence-read';
import { makeSequenceSheets, SEQUENCE_SHEETS, sequenceRect } from '../src/breakdown/sequence-sheet';
import type { StepContext } from '../src/breakdown/steps';
import type { DraftTextRegion } from '../src/breakdown/text-judge';
import { draftFixture } from './helpers/draft';

const RATE = FrameRate.of(30);
const at = (frames: number) => RationalTime.of(frames, RATE);
/** What the text engine made of five words in turn: the second in the wrong case, the fourth not read at all. */
const PIECES: readonly (readonly [string, number, number])[] = [
  ['I hope', 10, 44],
  ['YoU', 44, 52],
  ['Leave', 52, 70],
  ['…', 70, 81],
  ["Don't", 81, 98],
];

function sequenceDraft(pieces = PIECES): BreakdownDraft {
  const draft = draftFixture();
  const text = pieces.map(([words, start, end]) =>
    textOverlaySchema.parse({
      ...draft.text[0]!,
      id: newId<'TextOverlay'>(),
      text: words,
      role: 'label',
      start: at(start),
      duration: at(end - start),
      box: { x: 0.38, y: 0.47, width: 0.24, height: 0.045 },
      ...(words === '…' ? { doubts: [{ reason: 'textMaybeScene' }] } : {}),
    }),
  );
  const unread = text.filter((overlay) => overlay.text === '…').map((overlay) => overlay.id);
  return {
    ...draft,
    text,
    textSequences: [
      {
        overlayIds: text.map((overlay) => overlay.id),
        zone: { x: 0.38, y: 0.47, width: 0.24, height: 0.045 },
        start: pieces[0]![1],
        end: pieces[pieces.length - 1]![2],
        unread,
      },
    ],
  };
}

/** A grey frame, lighter by its number, so a cell's pixels say which frame it shows. */
const frameOf = (frame: number) => ({
  frame,
  width: 360,
  height: 640,
  rgb: new Uint8Array(360 * 640 * 3).fill(frame),
});

async function sheeted(options: { readonly pixels?: boolean; readonly failing?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'lyr1-sequence-'));
  const draft = sequenceDraft();
  const asked: number[][] = [];
  const ctx: StepContext = {
    path: '/synthetic/reel.mp4',
    dir,
    rate: RATE,
    total: 120,
    analysers: {
      media:
        options.pixels === false
          ? {}
          : {
              framePixels: async (_path: string, frames: readonly number[]) => {
                asked.push([...frames]);
                return options.failing ? err(UnknownError()) : ok(frames.map(frameOf));
              },
            },
    } as unknown as BreakdownAnalysers,
    config: BREAKDOWN_CONFIG,
    signal: new AbortController().signal,
  };
  const made = await makeSequenceSheets(ctx, draft.textSequences!, draft.text);
  return { dir, asked, made, draft: { ...draft, textSequences: made.sequences } };
}

function scripted(answers: string[]): GraphicModel & { requests: GraphicModelRequest[] } {
  const requests: GraphicModelRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const answer = answers.shift();
      return answer === undefined
        ? err(UnknownError())
        : ok({ text: answer, provider: 'local-runtime', model: 'qwen3.5-4b', local: true });
    },
  };
}

const words = (draft: BreakdownDraft) => draft.text.map((overlay) => overlay.text);
const spans = (draft: BreakdownDraft) =>
  draft.text.map((overlay) => [overlay.start.value, overlay.start.value + overlay.duration.value]);

describe('a sequence’s sheet (LYR1)', () => {
  it('shows every piece, read or not, at the middle of its time, in one decode', async () => {
    const { dir, asked, made } = await sheeted();
    expect(made.warnings).toEqual([]);
    expect(asked).toEqual([[27, 48, 61, 75, 89]]);
    const sheet = made.sequences[0]!.sheet!;
    expect(sheet.path).toBe(join(SEQUENCE_SHEETS.dir, '1.png'));
    expect(sheet.cells.map((cell) => cell.frame)).toEqual([27, 48, 61, 75, 89]);
    const png = await readFile(join(dir, sheet.path));
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // Three cells a row with a gap between: five pieces are two rows.
    expect(png.readUInt32BE(16)).toBe(3 * SEQUENCE_SHEETS.cellWidth + 2 * SEQUENCE_SHEETS.gap);
  });

  it('gives the place room on every side and stays inside the picture', () => {
    const rect = sequenceRect([{ x: 0.38, y: 0.47, width: 0.24, height: 0.045 }], 360, 640);
    expect(rect.left).toBeLessThan(0.38 * 360);
    expect(rect.right).toBeGreaterThan(0.62 * 360);
    expect(rect.top).toBeLessThan(0.47 * 640);
    expect(rect.bottom).toBeGreaterThan(0.515 * 640);
    const edge = sequenceRect([{ x: 0, y: 0.97, width: 1, height: 0.03 }], 360, 640);
    expect(edge).toMatchObject({ left: 0, right: 360, bottom: 640 });
  });

  it('makes none without the pixels, and warns when the frames could not be read', async () => {
    const none = await sheeted({ pixels: false });
    expect(none.made).toMatchObject({ warnings: [] });
    expect(none.made.sequences[0]!.sheet).toBeUndefined();
    const failed = await sheeted({ failing: true });
    expect(failed.made.warnings).toEqual(['sequence_sheets_failed: 1']);
    expect(failed.made.sequences[0]!.sheet).toBeUndefined();
  });
});

describe('the question and the answer', () => {
  it('gives the engine’s readings as data and says which it could not read', () => {
    const question = sequenceQuestion(['I hope', null, 'Leave']);
    expect(question).toContain(
      '<untrusted source="ocr">\n1: "I hope"\n2: (not read)\n3: "Leave"\n</untrusted>',
    );
    expect(question).toContain('with 3 entries');
  });

  it('takes one entry a picture as a plain line, and nothing else', () => {
    expect(readSequenceAnswer('Here: {"texts": ["I hope", "", "  And\\n"]}', 3)).toEqual([
      'I hope',
      '',
      'And',
    ]);
    expect(readSequenceAnswer('{"texts": ["I hope", ""]}', 3)).toBeNull();
    expect(readSequenceAnswer('The texts are I hope, You', 2)).toBeNull();
    expect(readSequenceAnswer('{"texts": ["<b>You</b>", 7]}', 2)).toEqual(['b You /b', null]);
    expect(readSequenceAnswer(`{"texts": ["${'a'.repeat(120)}"]}`, 1)).toEqual([null]);
  });
});

describe('what the reader states, applied', () => {
  it('fills the piece nobody read, corrects a spelling that is alike, and leaves the times alone', async () => {
    const { draft } = await sheeted();
    const stated = withSequenceReading(draft, new Map([[0, ['I hope', 'You', 'Leave', 'And', "Don't"]]]));
    expect(words(stated)).toEqual(['I hope', 'You', 'Leave', 'And', "Don't"]);
    expect(spans(stated)).toEqual(PIECES.map(([, start, end]) => [start, end]));
    expect(stated.text[3]!.doubts).toBeUndefined();
    expect(stated.textSequences![0]).toMatchObject({
      unread: [],
      overlayIds: draft.text.map((item) => item.id),
    });
  });

  it('keeps the engine’s reading when the stated one is unrelated, and a piece it has no entry for', async () => {
    const { draft } = await sheeted();
    const stated = withSequenceReading(
      draft,
      new Map([[0, ['Boarding Zone', null, 'Leave', null, "Don't"]]]),
    );
    expect(words(stated)).toEqual(words(draft));
    expect(stated).toBe(draft);
  });

  it('drops an unread piece that shows no text, and its record keeps no overlay', async () => {
    const { draft } = await sheeted();
    const gone = draft.text[3]!.id;
    const recorded: BreakdownDraft = {
      ...draft,
      textRegions: [{ ...regionOf(draft.text[3]!.box), overlayId: gone }],
    };
    const stated = withSequenceReading(recorded, new Map([[0, ['I hope', 'YoU', 'Leave', '', "Don't"]]]));
    expect(words(stated)).toEqual(['I hope', 'YoU', 'Leave', "Don't"]);
    expect(stated.textSequences![0]).toMatchObject({ unread: [] });
    expect(stated.textSequences![0]!.overlayIds).not.toContain(gone);
    expect(stated.textRegions![0]!.overlayId).toBeNull();
  });

  it('makes one piece of two in a row that say the same once read', async () => {
    const { draft } = await sheeted();
    const stated = withSequenceReading(draft, new Map([[0, ['I hope', 'YoU', 'Leave', 'Leave', "Don't"]]]));
    expect(words(stated)).toEqual(['I hope', 'YoU', 'Leave', "Don't"]);
    expect(spans(stated)[2]).toEqual([52, 81]);
    expect(stated.textSequences![0]!.overlayIds).toHaveLength(4);
  });
});

/** The text stage's record of the piece nobody read (text-judge.ts): kept, with the sequence's weight. */
function regionOf(box: { x: number; y: number; width: number; height: number }): DraftTextRegion {
  return {
    overlayId: null,
    text: '…',
    start: 70,
    end: 81,
    box,
    kind: 'composited',
    score: -3.5,
    sceneProbability: 0.03,
    signals: { sequence: -4 },
    lean: null,
    site: 0,
    sequence: 0,
  };
}

describe('the model reads a sequence once (LYR1)', () => {
  it('asks again once for an answer that isn’t the JSON, saves it, and never asks twice for the same reel', async () => {
    const { dir, draft } = await sheeted();
    const model = scripted([
      'The fourth says And.',
      '{"texts": ["I hope", "You", "Leave", "And", "Don\'t"]}',
    ]);
    const signal = new AbortController().signal;
    const first = await readSequences(draft, dir, model, { signal });
    expect(first).toMatchObject({ read: 1, failed: 0 });
    expect(words(first.draft)).toEqual(['I hope', 'You', 'Leave', 'And', "Don't"]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]!.content.map((part) => part.type)).toEqual(['text', 'image']);
    expect(model.requests[0]!.content[0]).toMatchObject({ text: expect.stringContaining('4: (not read)') });
    expect(model.requests[1]!.content[0]).toMatchObject({
      text: expect.stringContaining('JSON object only'),
    });
    const saved = JSON.parse(await readFile(join(dir, SEQUENCES_FILE), 'utf8'));
    expect(saved.answers[draft.text[0]!.id]).toEqual(['I hope', 'You', 'Leave', 'And', "Don't"]);
    // The same reel again: the saved answer is applied to a fresh draft, and to one that already has it.
    expect(words((await readSequences(draft, dir, model, { signal })).draft)).toContain('And');
    const again = await readSequences(first.draft, dir, model, { signal });
    expect(again.draft).toBe(first.draft);
    expect(model.requests).toHaveLength(2);
  });

  it('leaves the draft as it is when the model fails or there is no sheet', async () => {
    const { dir, draft } = await sheeted();
    const signal = new AbortController().signal;
    const failed = await readSequences(draft, dir, scripted([]), { signal });
    expect(failed).toMatchObject({ read: 0, failed: 1 });
    expect(failed.draft).toBe(draft);
    const bare = sequenceDraft();
    const model = scripted(['{"texts": []}']);
    expect((await readSequences(bare, dir, model, { signal })).draft).toBe(bare);
    expect(model.requests).toHaveLength(0);
  });
});

describe('an unread piece and the graphics’ reading', () => {
  it('is not asked about or briefed while it has no words, and is once it has them', async () => {
    const { draft } = await sheeted();
    const sheets = draft.text.map((overlay) => ({
      overlayId: overlay.id,
      path: `graphics/${overlay.id}.png`,
      frames: [1, 2, 3, 4] as [number, number, number, number],
      lead: 0,
    }));
    const withSheets = { ...draft, graphicSheets: sheets } as BreakdownDraft;
    expect(promptOverlays(withSheets).map((entry) => entry.overlay.text)).not.toContain('…');
    expect(promptOverlays(withSheets)).toHaveLength(4);
    const stated = withSequenceReading(
      withSheets,
      new Map([[0, ['I hope', 'You', 'Leave', 'And', "Don't"]]]),
    );
    expect(promptOverlays(stated).map((entry) => entry.overlay.text)).toContain('And');
  });
});

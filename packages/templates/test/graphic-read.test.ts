// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ end to end on made-up pixels and a scripted model: each kept overlay's life drawn as a PNG sheet in the
 * breakdown, the model asked about each once (again when its answer isn't JSON, never again for the same reel), the
 * reading written on the built template, and the review's edits of it.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  err,
  FrameRate,
  isNotGraphic,
  ok,
  RationalTime,
  textOverlaySchema,
  UnknownError,
} from '@taalcut/core';
import { buildTemplate } from '../src/breakdown/build-template';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import {
  GRAPHIC_BRIEF_PROMPT,
  graphicReading,
  readGraphics,
  readGraphicsFile,
  withGraphicReading,
  type GraphicModel,
  type GraphicModelRequest,
} from '../src/breakdown/graphic-brief';
import { makeGraphicSheets, momentsOf } from '../src/breakdown/graphic-sheets';
import type { BreakdownAnalysers } from '../src/breakdown/ports';
import type { StepContext } from '../src/breakdown/steps';
import { editGraphic, setGraphic } from '../src/edits/graphic-edits';
import { removeText } from '../src/edits/review-edits';
import { draftFixture } from './helpers/draft';
import { sequentialIds } from './helpers/fixtures';
import { boxOf, drawFrame, type DrawnOverlay } from './helpers/overlay-frames';

const RATE = FrameRate.of(30);
const BUBBLE: DrawnOverlay = {
  words: [120, 150, 96, 14],
  pad: { x: 22, y: 9 },
  fill: [242, 242, 247],
  ink: [12, 12, 14],
  radius: 0.36,
  tail: 'right',
  start: 30,
  end: 90,
};

function pngSize(bytes: Buffer): { width: number; height: number; pixels: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const idat = bytes.indexOf('IDAT');
  const length = bytes.readUInt32BE(idat - 4);
  const raw = inflateSync(bytes.subarray(idat + 4, idat + 4 + length));
  return { width, height, pixels: raw.length };
}

async function sheetsDraft() {
  const dir = await mkdtemp(join(tmpdir(), 'dsg1-read-'));
  const draft = draftFixture();
  const id = draft.text[0]!.id;
  const bubble = textOverlaySchema.parse({
    ...draft.text[0]!,
    text: 'How was the trip?',
    start: RationalTime.of(BUBBLE.start, RATE),
    duration: RationalTime.of(BUBBLE.end - BUBBLE.start, RATE),
    box: boxOf(BUBBLE),
    design: {
      kind: 'chatBubble',
      colors: { fill: '#f2f2f7', text: '#0c0c0e', stroke: null },
      cornerRadius: 0.36,
      tail: 'right',
      font: { class: 'sans', weight: 500 },
      motion: { enter: 'none', exit: 'none', typing: true },
      confidence: 0.9,
    },
  });
  const { design: _, ...plain } = bubble;
  const sign = textOverlaySchema.parse({
    ...plain,
    id: '01JDSG1READS1GN00000000001',
    text: 'CENTRAL STATION',
    start: RationalTime.of(5, RATE),
    duration: RationalTime.of(60, RATE),
    box: { x: 0.05, y: 0.6, width: 0.4, height: 0.04 },
    doubts: [{ reason: 'textMaybeScene' }],
  });
  const asked: number[][] = [];
  const ctx: StepContext = {
    path: '/synthetic/reel.mp4',
    dir,
    rate: RATE,
    total: 120,
    analysers: {
      media: {
        framePixels: async (_path: string, frames: readonly number[]) => {
          asked.push([...frames]);
          return ok(frames.map((frame) => drawFrame(frame, [BUBBLE])));
        },
      },
    } as unknown as BreakdownAnalysers,
    config: BREAKDOWN_CONFIG,
    signal: new AbortController().signal,
  };
  const made = await makeGraphicSheets(ctx, [bubble, sign], { [id]: 18 });
  if (!made.ok) throw new Error('no sheets');
  return {
    dir,
    asked,
    sheets: made.value.sheets,
    draft: { ...draft, text: [sign, bubble], graphicSheets: made.value.sheets },
  };
}

function scripted(answers: Record<string, string[]>): GraphicModel & { requests: GraphicModelRequest[] } {
  const requests: GraphicModelRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const text = request.content.find((part) => part.type === 'text')!.text;
      const key = Object.keys(answers).find((words) =>
        text.includes(`Words read from the video: "${words}"`),
      );
      const answer = key ? answers[key]!.shift() : undefined;
      return answer === undefined
        ? err(UnknownError())
        : ok({ text: answer, provider: 'local-runtime', model: 'qwen3.5-4b', local: true });
    },
  };
}

describe('the overlays’ sheets', () => {
  it('draws each kept overlay, doubted ones too, as a PNG of its four moments, in one decode', async () => {
    const { dir, asked, sheets, draft } = await sheetsDraft();
    expect(asked).toHaveLength(1);
    expect(sheets.map((sheet) => sheet.overlayId)).toEqual([draft.text[0]!.id, draft.text[1]!.id]);
    expect(sheets[1]).toMatchObject({ frames: momentsOf(30, 90, 120), lead: 18 });
    expect(momentsOf(30, 90, 120)).toEqual([26, 31, 60, 88]);
    const png = pngSize(await readFile(join(dir, sheets[1]!.path)));
    expect(png.width).toBe(960);
    expect(png.pixels).toBe((960 * 3 + 1) * png.height);
  });
});

describe('the model reads each overlay once', () => {
  it('asks again once for an answer that isn’t JSON, saves after each, and never asks twice for the same reel', async () => {
    const { dir, draft } = await sheetsDraft();
    const model = scripted({
      'CENTRAL STATION': [
        'It is a sign.',
        '{"graphic": false, "reason": "A station sign on the wall", "kind": "other"}',
      ],
      'How was the trip?': [
        '{"graphic": true, "kind": "incomingMessage", "what": "a friend asks", "role": "question"}',
      ],
    });
    const signal = new AbortController().signal;
    expect(await readGraphics(draft, dir, model, { signal })).toEqual({
      read: 2,
      failed: 0,
      skipped: 0,
      model: { provider: 'local-runtime', model: 'qwen3.5-4b', local: true },
    });
    expect(model.requests).toHaveLength(3);
    expect(model.requests[0]!.content.map((part) => part.type)).toEqual(['text', 'image']);
    expect(model.requests[1]!.content[0]).toMatchObject({
      text: expect.stringContaining('JSON object only'),
    });
    const saved = await readGraphicsFile(dir);
    expect(saved?.prompt).toBe(GRAPHIC_BRIEF_PROMPT);
    expect(saved?.answers[draft.text[0]!.id]).toMatchObject({
      graphic: false,
      reason: 'A station sign on the wall',
    });
    expect(await readGraphics(draft, dir, model, { signal })).toMatchObject({ read: 0, failed: 0 });
    expect(model.requests).toHaveLength(3);
  });

  it('stops asking once its time is up and leaves the rest to the facts', async () => {
    const { dir, draft } = await sheetsDraft();
    let clock = 0;
    const model = scripted({
      'CENTRAL STATION': ['{"graphic": false, "reason": "A station sign"}'],
      'How was the trip?': ['{"graphic": true, "kind": "incomingMessage"}'],
    });
    const slow: GraphicModel = {
      complete: async (request, signal) => {
        clock += 90_000;
        return model.complete(request, signal);
      },
    };
    const signal = new AbortController().signal;
    const result = await readGraphics(draft, dir, slow, { signal, budgetMs: 60_000, now: () => clock });
    expect(result).toMatchObject({ read: 1, failed: 0, skipped: 1 });
    expect(model.requests).toHaveLength(1);
  });

  it('a model that never answers leaves the briefs to the facts: doubted text is footage', async () => {
    const { dir, draft } = await sheetsDraft();
    const result = await readGraphics(draft, dir, scripted({}), { signal: new AbortController().signal });
    expect(result).toEqual({ read: 0, failed: 2, skipped: 0, model: null });
    const template = buildTemplate(draft, [], [], sequentialIds(), { createdAt: 1 });
    if (!template.ok) throw new Error(template.error.code);
    const reading = graphicReading(template.value, draft, await readGraphicsFile(dir));
    expect(reading?.model).toBeNull();
    // The sign the text stage doubted stays out of made videos, as footage the review can restore; the bubble is one.
    expect(reading?.briefs.map((brief) => [brief.source, brief.graphic, brief.kind])).toEqual([
      ['facts', false, 'other'],
      ['facts', true, 'incomingMessage'],
    ]);
    expect(reading?.briefs[0]!.reason).toContain('came and went with its shot');
  });
});

describe('the reading on the template, and the review’s edits', () => {
  async function readTemplate() {
    const { dir, draft } = await sheetsDraft();
    await readGraphics(
      draft,
      dir,
      scripted({
        'CENTRAL STATION': ['{"graphic": false, "reason": "A station sign on the wall", "kind": "other"}'],
        'How was the trip?': ['{"graphic": true, "kind": "incomingMessage", "what": "a friend asks"}'],
      }),
      { signal: new AbortController().signal },
    );
    const built = buildTemplate(draft, [], [], sequentialIds(), { createdAt: 1 });
    if (!built.ok) throw new Error(built.error.code);
    const template = withGraphicReading(
      built.value,
      graphicReading(built.value, draft, await readGraphicsFile(dir)),
    );
    return { template, sign: draft.text[0]!.id, bubble: draft.text[1]!.id };
  }

  it('writes the briefs and the system beside no designs; footage loses its doubt and is left out', async () => {
    const { template, sign, bubble } = await readTemplate();
    expect(template.graphics).toMatchObject({ uses: [] });
    expect(template.graphics).not.toHaveProperty('components');
    const reading = template.graphics!.reading!;
    expect(reading.model).toEqual({ provider: 'local-runtime', model: 'qwen3.5-4b', local: true });
    expect(reading.briefs.map((brief) => [brief.overlayId, brief.graphic, brief.kind])).toEqual([
      [sign, false, 'other'],
      [bubble, true, 'incomingMessage'],
    ]);
    expect(reading.briefs[1]!.motion.typingSeconds).toBe(0.6);
    expect(reading.system.conversation).toEqual([{ overlayId: bubble, side: 'right', speaker: 'them' }]);
    expect(isNotGraphic(template.graphics, sign)).toBe(true);
    expect(template.text.find((item) => item.id === sign)?.doubts).toBeUndefined();
  });

  it('a doubted overlay the model reads as a graphic loses its doubt and stays in made videos', async () => {
    const { dir, draft } = await sheetsDraft();
    await readGraphics(
      draft,
      dir,
      scripted({
        'CENTRAL STATION': ['{"graphic": true, "kind": "title", "what": "the place, as a title"}'],
        'How was the trip?': ['{"graphic": true, "kind": "incomingMessage"}'],
      }),
      { signal: new AbortController().signal },
    );
    const built = buildTemplate(draft, [], [], sequentialIds(), { createdAt: 1 });
    if (!built.ok) throw new Error(built.error.code);
    expect(built.value.text[0]!.doubts?.map((doubt) => doubt.reason)).toEqual(['textMaybeScene']);
    const template = withGraphicReading(
      built.value,
      graphicReading(built.value, draft, await readGraphicsFile(dir)),
    );
    const title = template.text[0]!;
    expect(template.graphics!.reading!.briefs[0]).toMatchObject({
      graphic: true,
      kind: 'title',
      source: 'model',
    });
    expect(title.doubts).toBeUndefined();
    expect(isNotGraphic(template.graphics, title.id)).toBe(false);
  });

  it('Not a graphic, its restore, a brief’s words, and Not text take the brief with the overlay', async () => {
    const { template, sign, bubble } = await readTemplate();
    const restored = setGraphic(template, { overlayId: sign, graphic: true });
    if (!restored.ok) throw new Error(restored.error.code);
    expect(restored.value.graphics!.reading!.briefs[0]).toMatchObject({
      graphic: true,
      reason: null,
      source: 'person',
    });
    const edited = editGraphic(restored.value, {
      overlayId: bubble,
      brief: { role: 'question', look: 'grey bubble' },
    });
    if (!edited.ok) throw new Error(edited.error.code);
    expect(edited.value.graphics!.reading!.briefs[1]).toMatchObject({
      role: 'question',
      look: { words: 'grey bubble' },
      source: 'person',
    });
    expect(edited.value.text).toEqual(restored.value.text);
    const gone = removeText(edited.value, { overlayIds: [bubble] });
    if (!gone.ok) throw new Error(gone.error.code);
    expect(gone.value.graphics!.reading!.briefs.map((brief) => brief.overlayId)).toEqual([sign]);
    expect(gone.value.graphics!.reading!.system.conversation).toEqual([]);
    expect(setGraphic(gone.value, { overlayId: bubble, graphic: false }).ok).toBe(false);
  });
});

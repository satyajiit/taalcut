// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Caption commands on the real command bus: edits are revisions, and undo and redo are exact. */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  FrameRate,
  newId,
  ok,
  RationalTime,
  unwrap,
  type AssetId,
  type CaptionCue,
  type CommandOrigin,
  type TimelineId,
  type Transcript,
} from '@taalcut/core';
import { oneTimeline } from '../commands/support';
import { createCaptionCommands, splitCueText } from '../../src/captions/commands';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import type { TranscriptSource } from '../../src/ports';
import { testMeasurer } from '../support/fonts';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const rate = FrameRate.of(30);
const ms = FrameRate.of(1000);
let measurer: DetailedTextMeasurer;

beforeAll(async () => {
  measurer = await testMeasurer();
});

/** Timelines in memory: every update is the next revision and must still be a valid document. */

function transcriptOf(words: readonly (readonly [string, number, number])[]): Transcript {
  return {
    version: 1,
    language: 'en',
    engine: 'whisper',
    model: 'test',
    local: true,
    wordTiming: 'native',
    segments: [
      {
        text: words.map(([text]) => text).join(' '),
        range: { start: RationalTime.of(0, ms), duration: RationalTime.of(10_000, ms) },
        language: 'en',
        words: words.map(([text, start, duration]) => ({
          text,
          range: { start: RationalTime.of(start, ms), duration: RationalTime.of(duration, ms) },
        })),
      },
    ],
  };
}

/** One 6 s clip from source 0 with two sentences of speech. */
function setup() {
  const assetId: AssetId = newId<'Asset'>();
  const timeline = makeTimeline({ items: [{ frames: 180, sourceStart: 0, assetId }] });
  const timelines = oneTimeline(timeline);
  const transcripts: TranscriptSource = {
    transcript: async (id) =>
      ok(
        id === assetId
          ? transcriptOf([
              ['Welcome', 0, 400],
              ['to', 400, 200],
              ['the', 600, 200],
              ['show.', 800, 600],
              ['Today', 2000, 500],
              ['we', 2500, 200],
              ['cook', 2700, 400],
              ['rice.', 3100, 700],
            ])
          : null,
      ),
  };
  const commands = createCaptionCommands({ timelines, transcripts, measurer });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
  bus.register(...commands.all);
  const ids = { projectId: timeline.projectId, timelineId: timeline.id as TimelineId };
  return { bus, commands, timelines, ids };
}

const texts = (cues: readonly CaptionCue[]) =>
  cues.map((cue) => cue.words.map((word) => word.text).join(' '));

describe('caption commands', () => {
  it('turning captions on builds the track from the transcript, as one undoable step', async () => {
    const { bus, commands, timelines, ids } = setup();
    const receipt = unwrap(await bus.dispatch(commands.setEnabled, { ...ids, enabled: true }, UI));
    expect(receipt.result).toMatchObject({
      enabled: true,
      cues: 2,
      language: 'en',
      styleSource: 'preset',
      revision: 2,
    });
    expect(texts(timelines.current().captions!.cues)).toEqual([
      'Welcome to the show.',
      'Today we cook rice.',
    ]);
    expect(RationalTime.toFrames(timelines.current().captions!.cues[1]!.range.start, rate)).toBe(60);

    unwrap(await bus.undo(ids.projectId, UI));
    expect(timelines.current()).toMatchObject({ captions: null, revision: 3 });
    unwrap(await bus.redo(ids.projectId, UI));
    expect(texts(timelines.current().captions!.cues)).toHaveLength(2);
  });

  it('turning captions off without a track leaves none', async () => {
    const { bus, commands, timelines, ids } = setup();
    unwrap(await bus.dispatch(commands.setEnabled, { ...ids, enabled: false }, UI));
    expect(timelines.current().captions).toBeNull();
  });

  it('edits a cue’s text, marks it edited, and undo and redo restore each track exactly', async () => {
    const { bus, commands, timelines, ids } = setup();
    unwrap(await bus.dispatch(commands.setEnabled, { ...ids, enabled: true }, UI));
    const before = timelines.current().captions!;
    const cue = before.cues[0]!;
    unwrap(
      await bus.dispatch(commands.editText, { ...ids, cueId: cue.id, text: 'Welcome to our  kitchen' }, UI),
    );
    const after = timelines.current().captions!;
    expect(after.cues[0]).toMatchObject({ id: cue.id, edited: true, range: cue.range });
    expect(texts(after.cues)[0]).toBe('Welcome to our kitchen');
    expect(after.cues[1]).toEqual(before.cues[1]);

    unwrap(await bus.undo(ids.projectId, UI));
    expect(timelines.current().captions).toEqual(before);
    unwrap(await bus.redo(ids.projectId, UI));
    expect(timelines.current().captions).toEqual(after);
  });

  it('empty text deletes the cue; a missing cue or over 40 words is an error', async () => {
    const { bus, commands, timelines, ids } = setup();
    unwrap(await bus.dispatch(commands.setEnabled, { ...ids, enabled: true }, UI));
    const [first, second] = timelines.current().captions!.cues;
    unwrap(await bus.dispatch(commands.editText, { ...ids, cueId: first!.id, text: '  ' }, UI));
    expect(timelines.current().captions!.cues.map((cue) => cue.id)).toEqual([second!.id]);

    const missing = await bus.dispatch(commands.editText, { ...ids, cueId: first!.id, text: 'Hi' }, UI);
    expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
    const long = Array.from({ length: 41 }, (_, index) => `w${index}`).join(' ');
    const tooLong = await bus.dispatch(commands.editText, { ...ids, cueId: second!.id, text: long }, UI);
    expect(tooLong.ok ? null : tooLong.error.code).toBe('core.validation');
    expect(timelines.current().captions!.cues).toHaveLength(1);
  });

  it('sets a style partially and records that the user chose it', async () => {
    const { bus, commands, timelines, ids } = setup();
    unwrap(await bus.dispatch(commands.setEnabled, { ...ids, enabled: true }, UI));
    const before = timelines.current().captions!;
    const receipt = unwrap(
      await bus.dispatch(commands.setStyle, { ...ids, style: { font: 'mukta', sizePx: 80 } }, UI),
    );
    expect(receipt.result.styleSource).toBe('user');
    expect(timelines.current().captions!.style).toEqual({ ...before.style, font: 'mukta', sizePx: 80 });
    unwrap(await bus.undo(ids.projectId, UI));
    expect(timelines.current().captions).toEqual(before);
  });

  it('rebuild regroups from the transcript and keeps the cues the user edited', async () => {
    const { bus, commands, timelines, ids } = setup();
    unwrap(await bus.dispatch(commands.setEnabled, { ...ids, enabled: true }, UI));
    const second = timelines.current().captions!.cues[1]!;
    unwrap(await bus.dispatch(commands.editText, { ...ids, cueId: second.id, text: 'Today: rice!' }, UI));
    unwrap(await bus.dispatch(commands.setStyle, { ...ids, style: { maxWords: 2 } }, UI));
    unwrap(await bus.dispatch(commands.rebuild, ids, UI));
    const cues = timelines.current().captions!.cues;
    expect(texts(cues)).toEqual(['Welcome to', 'the show.', 'Today: rice!']);
    expect(cues[2]).toMatchObject({ id: second.id, edited: true });
    expect(timelines.current().captions!.styleSource).toBe('user');
  });

  it('commands on a timeline without captions report the missing track', async () => {
    const { bus, commands, ids } = setup();
    const result = await bus.dispatch(commands.setStyle, { ...ids, style: { sizePx: 60 } }, UI);
    expect(result.ok ? null : result.error.code).toBe('core.not_found');
  });
});

describe('splitCueText', () => {
  it('shares the cue out by grapheme count, every word at least a frame', () => {
    const [cue] = captionTrackOf(rate, [[30, 4, 'a b']]).cues;
    const words = splitCueText(cue!, 'नमस्ते a b c d e', rate);
    expect(words.map((word) => word.text)).toEqual(['नमस्ते', 'a', 'b', 'c d e']);
    expect(words.map((word) => RationalTime.toFrames(word.range.duration, rate))).toEqual([1, 1, 1, 1]);
    expect(RationalTime.toFrames(words[0]!.range.start, rate)).toBe(30);
    // नमस्ते is three graphemes (न म स्ते: the conjunct stays one), "hi" two: 30 frames split 18 / 12.
    const wide = splitCueText(captionTrackOf(rate, [[0, 30, 'x']]).cues[0]!, 'नमस्ते hi', rate);
    expect(wide.map((word) => RationalTime.toFrames(word.range.duration, rate))).toEqual([18, 12]);
  });
});

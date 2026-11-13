// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * captions.applyTranslation (P3-V20, SPEC P3.9): every cue exactly once, words split for the language and
 * timed by grapheme share on whole frames (120 ms at least where the cue has room), a font that covers the
 * new script, and an exact undo through the command bus.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  FrameRate,
  ok,
  RationalTime,
  unwrap,
  type CaptionTrack,
  type CommandOrigin,
  type TimelineId,
} from '@taalcut/core';
import { oneTimeline } from '../commands/support';
import { createCaptionCommands } from '../../src/captions/commands';
import { FONT_CATEGORY } from '../../src/captions/fonts';
import { coversScript } from '../../src/captions/style';
import { timeCueWords, translateTrack, translationWords } from '../../src/captions/translation';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { testMeasurer } from '../support/fonts';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const rate = FrameRate.of(30);
const frames = (time: RationalTime) => RationalTime.toFrames(time, rate);

/** Two cues in English, 2 s and 1 s, in a geometric font with no Devanagari. */
const english = (): CaptionTrack =>
  captionTrackOf(
    rate,
    [
      [0, 60, 'Welcome to the show'],
      [60, 30, 'Today we cook'],
    ],
    { font: 'montserrat' },
  );

const translations = (track: CaptionTrack, texts: readonly string[]) =>
  track.cues.map((cue, index) => ({ cueId: cue.id, text: texts[index] ?? '' }));

describe('translateTrack', () => {
  it('refuses a translation that misses a cue, adds one, or repeats one', () => {
    const track = english();
    const [first, second] = track.cues;
    const cases = [
      { cues: [{ cueId: first!.id, text: 'Hola' }], missing: 1, extra: 0 },
      {
        cues: [...translations(track, ['Hola', 'Hoy']), { cueId: 'nope', text: 'x' }],
        missing: 0,
        extra: 1,
      },
      {
        cues: [
          { cueId: first!.id, text: 'Hola' },
          { cueId: first!.id, text: 'Otra vez' },
        ],
        missing: 1,
        extra: 1,
      },
    ];
    for (const { cues, missing, extra } of cases) {
      const result = translateTrack(track, { language: 'es', cues }, rate);
      expect(result.ok ? null : result.error).toMatchObject({
        code: 'render.translation_mismatch',
        params: { missing, extra },
      });
    }
    expect(second).toBeDefined();
  });

  it('times words by grapheme share on whole frames, 120 ms at least, filling each cue exactly', () => {
    const track = english();
    const result = translateTrack(
      track,
      { language: 'es', cues: translations(track, ['¡Bienvenidos al programa!', 'Hoy cocinamos arroz.']) },
      rate,
    );
    if (!result.ok) throw new Error(result.error.code);
    const [first, second] = result.value.cues;
    expect(first!.words.map((word) => word.text)).toEqual(['¡Bienvenidos', 'al', 'programa!']);
    expect(second!.words.map((word) => word.text)).toEqual(['Hoy', 'cocinamos', 'arroz.']);
    for (const [index, cue] of result.value.cues.entries()) {
      const source = track.cues[index]!;
      expect(cue.range).toEqual(source.range);
      expect(cue.edited).toBe(true);
      // Back to back from the cue's start to its end.
      let at = frames(cue.range.start);
      for (const word of cue.words) {
        expect(frames(word.range.start)).toBe(at);
        expect(frames(word.range.duration)).toBeGreaterThanOrEqual(4); // 120 ms at 30 fps
        at += frames(word.range.duration);
      }
      expect(at).toBe(frames(cue.range.start) + frames(cue.range.duration));
    }
    // The long word gets the long share: 12 graphemes of 23 in a 60-frame cue.
    expect(frames(first!.words[0]!.range.duration)).toBe(31);
    expect(result.value.language).toBe('es');
    expect(result.value.style.font).toBe('montserrat');
  });

  it('splits with Intl.Segmenter for the language and keeps conjuncts whole', () => {
    expect(translationWords('शो में आपका स्वागत है।', 'hi')).toEqual(['शो', 'में', 'आपका', 'स्वागत', 'है।']);
    expect(translationWords('  Não,   irmã! ', 'pt-BR')).toEqual(['Não,', 'irmã!']);
  });

  it('swaps a font that cannot draw the script for one of its category that can', () => {
    const track = english();
    const result = translateTrack(
      track,
      { language: 'hi', cues: translations(track, ['शो में आपका स्वागत है', 'आज हम चावल पकाते हैं']) },
      rate,
    );
    if (!result.ok) throw new Error(result.error.code);
    const font = result.value.style.font;
    expect(coversScript('montserrat', 'devanagari')).toBe(false);
    expect(coversScript(font, 'devanagari')).toBe(true);
    expect(FONT_CATEGORY[font]).toBe('geometric');
    expect(result.value.language).toBe('hi');
    // Every other style field stays.
    expect({ ...result.value.style, font: 'montserrat' }).toEqual(track.style);
  });

  it('drops a cue translated to nothing, as captions.editText deletes an emptied cue', () => {
    const track = english();
    const result = translateTrack(
      track,
      { language: 'es', cues: translations(track, ['Bienvenidos al programa de hoy', '   ']) },
      rate,
    );
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.cues.map((cue) => cue.id)).toEqual([track.cues[0]!.id]);
    expect(result.value.cues[0]!.words.map((word) => word.text)).toEqual([
      'Bienvenidos',
      'al',
      'programa',
      'de',
      'hoy',
    ]);
  });

  it('still refuses a cue of more than 40 words', () => {
    const track = english();
    const long = Array.from({ length: 41 }, (_, index) => `w${index}`).join(' ');
    const result = translateTrack(track, { language: 'es', cues: translations(track, [long, 'Hoy']) }, rate);
    expect(result.ok ? null : result.error.code).toBe('core.validation');
  });

  it('lets words go under 120 ms only when the cue is too short for them all', () => {
    const words = timeCueWords(
      { range: { start: RationalTime.of(10, rate), duration: RationalTime.of(6, rate) } },
      ['uno', 'dos', 'tres', 'cuatro'],
      rate,
      4,
    );
    expect(words.map((word) => frames(word.range.duration))).toEqual([1, 1, 2, 2]);
    expect(frames(words[0]!.range.start)).toBe(10);
  });
});

describe('captions.applyTranslation on the bus', () => {
  let measurer: DetailedTextMeasurer;
  beforeAll(async () => {
    measurer = await testMeasurer();
  });

  function setup() {
    const timeline = makeTimeline({ items: [{ frames: 90, sourceStart: 0 }], captions: english() });
    const timelines = oneTimeline(timeline);
    const store = createMemoryAuditLogStore();
    /** A bus over the audit log with its own caption commands, as each app start makes. */
    const busOverLog = () => {
      const commands = createCaptionCommands({
        timelines,
        transcripts: { transcript: async () => ok(null) },
        measurer,
      });
      const bus = createCommandBus({ store, clock: createManualClock(1_000) });
      bus.register(...commands.all);
      return { bus, commands };
    };
    const ids = { projectId: timeline.projectId, timelineId: timeline.id as TimelineId };
    return { ...busOverLog(), busOverLog, timelines, ids };
  }

  it('is registered with the other caption commands', () => {
    const { commands } = setup();
    expect(commands.all.map((command) => command.name)).toContain('captions.applyTranslation');
  });

  it('writes one revision, and undo restores the source track exactly', async () => {
    const { bus, commands, timelines, ids } = setup();
    const before = timelines.current();
    const receipt = unwrap(
      await bus.dispatch(
        commands.applyTranslation,
        {
          ...ids,
          revision: before.revision,
          language: 'hi',
          cues: translations(before.captions!, ['शो में आपका स्वागत है', 'आज हम चावल पकाते हैं']),
        },
        UI,
      ),
    );
    expect(receipt.result).toMatchObject({ language: 'hi', cues: 2, revision: before.revision + 1 });
    expect(timelines.current().captions!.cues.every((cue) => cue.edited)).toBe(true);
    unwrap(await bus.undo(ids.projectId, UI));
    expect(timelines.current().captions).toEqual(before.captions);
    unwrap(await bus.redo(ids.projectId, UI));
    expect(timelines.current().captions!.language).toBe('hi');
  });

  it('redoes on a new bus over the same audit log (after a restart): the stale revision is no conflict', async () => {
    const { bus, commands, busOverLog, timelines, ids } = setup();
    const before = timelines.current();
    const cues = translations(before.captions!, ['Bienvenidos al programa', 'Hoy cocinamos']);
    unwrap(
      await bus.dispatch(
        commands.applyTranslation,
        { ...ids, revision: before.revision, language: 'es', cues },
        UI,
      ),
    );
    unwrap(await bus.undo(ids.projectId, UI));
    expect(timelines.current().captions).toEqual(before.captions);

    const restarted = busOverLog();
    const redone = await restarted.bus.redo(ids.projectId, UI);
    expect(redone.ok ? null : redone.error.code).toBeNull();
    expect(timelines.current().captions!.language).toBe('es');
    expect(timelines.current().revision).toBe(before.revision + 3);
    // A fresh dispatch with the stale revision is still refused.
    const stale = await restarted.bus.dispatch(
      restarted.commands.applyTranslation,
      { ...ids, revision: before.revision, language: 'pt-BR', cues },
      UI,
    );
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
  });

  it('refuses a stale revision and a mismatch without writing', async () => {
    const { bus, commands, timelines, ids } = setup();
    const before = timelines.current();
    const cues = translations(before.captions!, ['Hola a todos', 'Hoy cocinamos']);
    const stale = await bus.dispatch(
      commands.applyTranslation,
      { ...ids, revision: before.revision + 5, language: 'es', cues },
      UI,
    );
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
    const short = await bus.dispatch(
      commands.applyTranslation,
      { ...ids, language: 'es', cues: cues.slice(0, 1) },
      UI,
    );
    expect(short.ok ? null : short.error.code).toBe('render.translation_mismatch');
    expect(timelines.current()).toEqual(before);
  });
});

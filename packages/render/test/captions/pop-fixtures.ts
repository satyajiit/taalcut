// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pop suites' shared pieces (pop-room.int, pop-rest.int): pop-highlight captions with long and short words,
 * one-word lines, a line plain text fills edge to edge, upper case, heavy strokes, a background box, Devanagari,
 * Hinglish, and blocks pinned to both edges of the safe rect; and a harness that renders them with the pinned
 * shell and probes any frames.
 */
import { afterAll, beforeAll } from 'vitest';
import { join } from 'node:path';
import { FrameRate, type CaptionStyle, type CaptionTrack, type Rect } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createCompositionFonts } from '../../src/captions/fonts';
import { layoutCue, type CueLayoutDetail } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { popWindows, wordSpans } from '../../src/captions/pop';
import type { CaptionLayout, CompositionBundle } from '../../src/compile/composition';
import type { CueLayout, ProbedTextBox, ProbedWord } from '../../src/types';
import { FONTS_DIR, testMeasurer } from '../support/fonts';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { captionTrackOf } from '../support/timeline';
import { probeCaptionFrames } from './caption-probe';
import { LEGACY_CAPTION_PRESET } from './caption-presets';

const media = await findTestMedia('pop room');
const shell = findTestShell('pop room');
/** No ffmpeg or no headless shell: the pop suites skip. */
export const skipPop = !media.binaries || !shell.path;

export const RATE = FrameRate.of(30);
/** Frames per word: the peak (3 in) and the way back both fit. */
const WORD_FRAMES = 6;
// Edge-to-edge fixtures must stay narrow enough to expose a missing allowance for the pop's width.
export const preset = LEGACY_CAPTION_PRESET;

export interface Fixture {
  readonly name: string;
  readonly language: string;
  readonly style: Partial<CaptionStyle>;
  readonly cues: readonly string[];
}

export const FIXTURES: readonly Fixture[] = [
  {
    name: 'long and short words over three lines',
    language: 'en',
    style: { maxLines: 3 },
    cues: ['Meet the team that ships every Friday', 'Sales grew forty percent this year'],
  },
  {
    name: 'long words, one a line, and a one-word cue',
    language: 'en',
    style: { font: 'poppins', weight: 800, sizePx: 64, maxLines: 3 },
    cues: ['Extraordinary breakthroughs everywhere', 'Unbelievable'],
  },
  {
    name: 'short words',
    language: 'en',
    style: { font: 'poppins', weight: 800, sizePx: 80, maxLines: 3 },
    cues: ['I am so in it to win it at all'],
  },
  {
    // Set as plain text, "Everybody loves a" fills the safe width: popped, its ends would leave it.
    name: 'a line plain text fills edge to edge',
    language: 'en',
    style: { maxLines: 3 },
    cues: ['Everybody loves a good surprise party'],
  },
  {
    name: 'upper case, the bold preset',
    language: 'en',
    style: {
      font: 'anton',
      weight: 400,
      sizePx: 96,
      stroke: { color: '#000000', widthPx: 6 },
      letterCase: 'upper',
      maxLines: 3,
    },
    cues: ['the quick brown fox jumps over it'],
  },
  {
    name: 'a stroke heavier than half a space',
    language: 'en',
    style: {
      font: 'poppins',
      weight: 800,
      sizePx: 48,
      stroke: { color: '#000000', widthPx: 14 },
      maxLines: 3,
    },
    cues: ['we ship it on a friday every week'],
  },
  {
    name: 'a background box',
    language: 'en',
    style: { stroke: null, background: { color: '#000000', opacity: 0.6, paddingPx: 18, radiusPx: 14 } },
    cues: ['Here are three tips to plan'],
  },
  {
    name: 'Devanagari with conjuncts and marks above and below',
    language: 'hi',
    style: { font: 'poppins', weight: 800, sizePx: 72, maxLines: 3 },
    cues: ['क्षमा त्रिशूल ज्ञान श्रम कर्क ज़िंदगी कि कृ', 'कि की कु कू कृ के कै को कौ'],
  },
  {
    name: 'Devanagari in Noto Sans Devanagari',
    language: 'hi',
    style: { font: 'notoSansDevanagari', weight: 700, sizePx: 80, maxLines: 3 },
    cues: ['कुछ भी हो सकता है प्रिय मित्र'],
  },
  {
    name: 'Hinglish',
    language: 'hi',
    style: { font: 'mukta', weight: 700, sizePx: 76 },
    cues: ['Yeh video bahut अच्छा hai'],
  },
  {
    name: 'pinned to the top of the safe rect',
    language: 'en',
    style: { anchorY: 0, maxLines: 3 },
    cues: ['Pinned up against the top edge'],
  },
  {
    name: 'pinned to the bottom of the safe rect',
    language: 'en',
    style: { anchorY: 1, maxLines: 3 },
    cues: ['Pinned down at the bottom edge'],
  },
];

/** The fixture named so. */
export function fixtureNamed(name: string): Fixture {
  const found = FIXTURES.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`no pop fixture "${name}"`);
  return found;
}

/** The fixture's cues back to back, WORD_FRAMES a word. */
export function trackOf(fixture: Fixture): { track: CaptionTrack; frames: number } {
  let at = 0;
  const cues = fixture.cues.map((text) => {
    const frames = text.split(' ').length * WORD_FRAMES;
    const cue = [at, frames, text] as const;
    at += frames;
    return cue;
  });
  const track = captionTrackOf(RATE, cues, { ...fixture.style, highlight: 'pop' }, fixture.language);
  return { track, frames: at + 6 };
}

/** Each word's pop in a cue, by word index (null: it doesn't pop). */
export const popsOf = (cue: CaptionTrack['cues'][number]) => popWindows(wordSpans(cue.words, RATE));

/** How far two boxes run into each other (0 or less: clear). */
export const overlap = (a: Rect, b: Rect) =>
  Math.min(
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );

/** Words on the same line as `word` (their boxes share most of its height). */
export const sameLine = (word: ProbedWord, other: ProbedWord) =>
  overlap(
    { x: 0, y: word.box.y, width: 1, height: word.box.height },
    { x: 0, y: other.box.y, width: 1, height: other.box.height },
  ) >
  word.box.height / 2;

/** How far a box reaches out of a rect (0 or less: inside). */
export const outside = (box: Rect, rect: Rect) =>
  Math.max(
    rect.x - box.x,
    rect.y - box.y,
    box.x + box.width - rect.x - rect.width,
    box.y + box.height - rect.y - rect.height,
  );

/** A laid-out cue drawn as plain text: the same lines and block, with no pop room. */
export const withoutPop = (laid: CueLayout): CueLayout => ({
  lines: laid.lines,
  lineWords: laid.lineWords,
  widthPx: laid.widthPx,
  heightPx: laid.heightPx,
  topPx: laid.topPx,
  ...(laid.lineHeightPx ? { lineHeightPx: laid.lineHeightPx } : {}),
});

export interface PopHarness {
  readonly measurer: DetailedTextMeasurer;
  /** The real layout, as the app lays captions out. */
  readonly layout: (...args: Parameters<CaptionLayout>) => CueLayoutDetail;
  /** Chrome's caption boxes at the frames `framesOf` names, the track compiled with `captionLayout`. */
  readonly probe: (
    track: CaptionTrack,
    frames: number,
    captionLayout: CaptionLayout,
    framesOf: (cue: CaptionTrack['cues'][number]) => readonly number[],
  ) => Promise<{ boxes: Map<string, ProbedTextBox[]>; bundle: CompositionBundle }>;
}

/** The harness for a describe block: a still to draw on and the test measurer, set up before its tests. */
export function popHarness(): PopHarness {
  const state: {
    ctx?: MediaContext;
    work?: Awaited<ReturnType<typeof tempDir>>;
    measurer?: DetailedTextMeasurer;
    still?: string;
  } = {};
  const ready = () => {
    const { ctx, work, measurer, still } = state;
    if (!ctx || !work || !measurer || !still || !shell.path) throw new Error('the pop harness is not set up');
    return { ctx, work, measurer, still, chromePath: shell.path };
  };
  beforeAll(async () => {
    if (!media.binaries) return;
    state.ctx = mediaContext(media.binaries);
    state.work = await tempDir('pop-room');
    state.measurer = await testMeasurer();
    state.still = join(state.work.dir, 'background.jpg');
    await ffmpeg(state.ctx, [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x3a6ea5:s=1080x1920',
      '-frames:v',
      '1',
      state.still,
    ]);
  });
  afterAll(async () => {
    await state.work?.dispose();
  });
  return {
    get measurer() {
      return ready().measurer;
    },
    layout: (words, style, safe, language, height) =>
      layoutCue(words, style, ready().measurer, safe, language, height),
    probe: (track, frames, captionLayout, framesOf) => {
      const { ctx, work, measurer, still, chromePath } = ready();
      return probeCaptionFrames(
        {
          track,
          frames,
          rate: RATE,
          preset,
          still,
          workDir: work.dir,
          chromePath,
          ctx,
          options: { fonts: createCompositionFonts(FONTS_DIR, measurer), captionLayout },
        },
        framesOf,
      );
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A cue is laid out as its words and drawn on exactly the lines it was laid out on (SPEC section 6, "A cue is laid
 * out as its words"). A cue word may hold spaces: an edit that leaves more words than frames joins the tail into
 * one word, and a translated word keeps its punctuation. Laid out as text, such a word was split across lines the
 * markup could not match, and the cue was drawn on one unbroken line.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type CaptionTrack } from '@taalcut/core';
import { splitCueText } from '../../src/captions/commands';
import { layoutCue } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { CLASSIC_STYLE } from '../../src/captions/style';
import { translationWords } from '../../src/captions/translation';
import { compileComposition } from '../../src/compile/composition';
import { presetFor } from '../../src/presets/presets.v1';
import { testMeasurer } from '../support/fonts';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);
const preset = presetFor('device');
let measurer: DetailedTextMeasurer;

beforeAll(async () => {
  measurer = await testMeasurer();
});

/** The cue's markup and its layout, compiled with the real layout. */
function drawn(track: CaptionTrack) {
  const timeline = makeTimeline({ rate, items: [{ kind: 'image', frames: 30 }], captions: track });
  const compiled = compileComposition(timeline, {
    variant: 'export',
    preset,
    burnCaptions: true,
    captionLayout: (words, style, safe, language, height) =>
      layoutCue(words, style, measurer, safe, language, height),
    media: () => ({ file: '/still.png', key: 'still', mediaStart: RationalTime.zero(rate), ext: 'png' }),
  });
  if (!compiled.ok) throw new Error(compiled.error.code);
  const html = compiled.value.files['index.html'] ?? '';
  const start = html.indexOf('class="clip tc-cue');
  const words = track.cues[0]?.words.map((word) => word.text) ?? [];
  return {
    markup: html.slice(start, html.indexOf('</div>', start)),
    layout: layoutCue(words, track.style, measurer, preset.safe, track.language),
  };
}

describe('a cue drawn on its laid-out lines', () => {
  it('keeps a cue word with spaces inside it whole, on one line', () => {
    for (const [words, language] of [
      [['Meet', 'the', 'team', 'that ships every Friday and the people who make it happen'], 'en'],
      [['Prêt', 'à', 'partir 🔥 ! «', 'Allons-y »'], 'fr'],
    ] as const) {
      const width = measurer.measure(
        'partir 🔥 ! «',
        CLASSIC_STYLE.font,
        CLASSIC_STYLE.weight,
        CLASSIC_STYLE.sizePx,
      );
      const narrow = { ...preset.safe, width: Math.ceil(width.width) + 120 };
      for (const highlight of ['pop', 'color'] as const) {
        const layout = layoutCue(
          words,
          { ...CLASSIC_STYLE, highlight, maxLines: 3 },
          measurer,
          narrow,
          language,
        );
        expect(layout.lineWords.reduce((sum, count) => sum + count, 0)).toBe(words.length);
        let at = 0;
        layout.lineWords.forEach((count, line) => {
          expect(layout.lines[line]).toBe(words.slice(at, (at += count)).join(' '));
        });
        if (highlight === 'pop') expect(layout.pop?.push).toHaveLength(words.length);
      }
    }
  });

  it('breaks a cue edited to more words than frames where it was laid out', () => {
    const track = captionTrackOf(rate, [[0, 4, 'Hi']], { maxLines: 3 });
    const cue = track.cues[0]!;
    const words = splitCueText(cue, 'Meet the team that ships every Friday and more', rate);
    // Four frames: the tail is one word.
    expect(words.map((word) => word.text)).toEqual([
      'Meet',
      'the',
      'team',
      'that ships every Friday and more',
    ]);
    const { markup, layout } = drawn({ ...track, cues: [{ ...cue, words }] });
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(markup.match(/<br>/g)).toHaveLength(layout.lines.length - 1);
    let at = 0;
    for (const count of layout.lineWords.slice(0, -1)) {
      at += count;
      expect(markup).toContain(`<br><span id="w-0-${at}"`);
    }
  });

  it('breaks a translated cue whose words keep their punctuation where it was laid out', () => {
    const track = captionTrackOf(rate, [[0, 30, 'Hi']], { maxLines: 3, sizePx: 120 }, 'fr');
    const cue = track.cues[0]!;
    const text = translationWords('Prêt à partir 🔥 ! « Allons-y » maintenant', 'fr');
    expect(text).toContain('partir 🔥 ! «');
    const words = text.map((word) => ({ ...cue.words[0]!, text: word }));
    const { markup, layout } = drawn({ ...track, cues: [{ ...cue, words }] });
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(markup.match(/<br>/g)).toHaveLength(layout.lines.length - 1);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * At rest a pop caption is plain text (SPEC section 6, "Room for the pop"). The pop fixtures (pop-fixtures.ts)
 * rendered by the pinned shell at the start of every word's pop, when nothing has moved: every word sits exactly
 * where the same lines drawn as plain text (another highlight, no pop room) put it, one space after the word
 * before it, and lower only by the lead kept over its line and the lines above.
 */
import { describe, expect, it } from 'vitest';
import type { CaptionLayout } from '../../src/compile/composition';
import { FIXTURES, popHarness, popsOf, preset, sameLine, skipPop, trackOf, withoutPop } from './pop-fixtures';

/** The frames each word's pop starts on: every word at rest. */
const atRest = (cue: Parameters<typeof popsOf>[0]) =>
  popsOf(cue).flatMap((window) => (window ? [window.start] : []));

describe.skipIf(skipPop)('a pop caption at rest', { timeout: 240_000 }, () => {
  const harness = popHarness();

  it.each(FIXTURES)('$name: every word sits as plain text sets it', async (fixture) => {
    const { track, frames } = trackOf(fixture);
    const style = track.style;
    // The pop's own layout, drawn with another highlight and without its room: the same lines as plain text.
    const popped: CaptionLayout = (words, cueStyle, ...rest) =>
      harness.layout(words, { ...cueStyle, highlight: 'pop' }, ...rest);
    const plainLayout: CaptionLayout = (...args) => withoutPop(popped(...args));
    const plainTrack = { ...track, style: { ...style, highlight: 'color' as const } };
    const pop = await harness.probe(track, frames, harness.layout, atRest);
    const plain = await harness.probe(plainTrack, frames, plainLayout, atRest);
    const space = harness.measurer.measure(' ', style.font, style.weight, style.sizePx).width;
    const stroke = style.stroke?.widthPx ?? 0;
    for (const cue of track.cues) {
      const laid = harness.layout(
        cue.words.map((word) => word.text),
        style,
        preset.safe,
        track.language,
        preset.height,
      );
      const lead = laid.pop?.leadPx ?? 0;
      expect(lead).toBeGreaterThan(0);
      const lineOf = laid.lineWords.flatMap((count, line) => Array.from({ length: count }, () => line));
      const restFrames = pop.boxes.get(cue.id) ?? [];
      const plainFrames = plain.boxes.get(cue.id) ?? [];
      expect(restFrames).toHaveLength(atRest(cue).length);
      expect(plainFrames).toHaveLength(restFrames.length);
      restFrames.forEach((box, frameIndex) => {
        const words = box.words ?? [];
        const plainWords = plainFrames[frameIndex]?.words ?? [];
        expect(words).toHaveLength(cue.words.length);
        expect(plainWords).toHaveLength(cue.words.length);
        words.forEach((word, wordIndex) => {
          const label = `${fixture.name}: "${cue.words[wordIndex]?.text}" at frame ${box.frame}`;
          const set = plainWords[wordIndex]!;
          expect(word.scale, label).toBeCloseTo(1, 3);
          expect(word.box.x, `${label}: x`).toBeCloseTo(set.box.x, 0);
          expect(Math.abs(word.box.width - set.box.width), `${label}: width`).toBeLessThanOrEqual(0.5);
          const below = ((lineOf[wordIndex] ?? 0) + 1) * lead;
          expect(Math.abs(word.box.y - set.box.y - below), `${label}: the lead above it`).toBeLessThanOrEqual(
            1,
          );
          // One space after the word before it on its line (their outlines one space less two strokes apart).
          const before = words[wordIndex - 1];
          if (!before || !sameLine(before, word)) return;
          const gap = word.box.x - (before.box.x + before.box.width);
          expect(Math.abs(gap - (space - 2 * stroke)), `${label}: one space`).toBeLessThanOrEqual(0.75);
        });
      });
    }
  });
});

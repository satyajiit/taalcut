// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The popped word keeps clear (SPEC section 6, "Room for the pop"). The pop fixtures (pop-fixtures.ts) rendered
 * by the pinned shell: at every word's pop peak the DOM probe reads every word as Chrome draws it. The popped
 * word is at POP_SCALE and alone in it, runs into no other word, keeps at least half a space from the words
 * beside it (which have moved apart for it), and every word stays inside the safe rect; the caption QA checks
 * pass. The same captions without the push, without the lead, or without either fail captionOverflow, and
 * wrapped as plain text (no room for the widest moment) they fail captionSafeZone, so a regression fails the
 * gate.
 */
import { describe, expect, it } from 'vitest';
import { POP_SCALE } from '../../src/captions/pop';
import type { CaptionLayout } from '../../src/compile/composition';
import { captionOverflowCheck, captionSafeZoneCheck } from '../../src/qa/checks/captions';
import type { CueLayout, ProbedTextBox } from '../../src/types';
import { target } from '../qa/support';
import {
  FIXTURES,
  fixtureNamed,
  outside,
  overlap,
  popHarness,
  popsOf,
  preset,
  sameLine,
  skipPop,
  trackOf,
  type Fixture,
} from './pop-fixtures';

/** Every word's pop peak in a cue, by word index (-1: it doesn't pop). */
const peaksOf = (cue: Parameters<typeof popsOf>[0]) => popsOf(cue).map((window) => window?.peak ?? -1);
const atPeaks = (cue: Parameters<typeof popsOf>[0]) => peaksOf(cue).filter((frame) => frame >= 0);

describe.skipIf(skipPop)('the popped caption word keeps clear', { timeout: 240_000 }, () => {
  const harness = popHarness();

  it.each(FIXTURES)(
    '$name: every word at its peak is clear of the others and inside the safe rect',
    async (fixture) => {
      const { track, frames } = trackOf(fixture);
      for (const cue of track.cues) {
        const words = cue.words.map((word) => word.text);
        const laid = harness.layout(words, track.style, preset.safe, track.language, preset.height);
        expect(laid.overflow, `${cue.words.length} words fit popped`).toBe(false);
      }
      const { boxes, bundle } = await harness.probe(track, frames, harness.layout, atPeaks);
      const style = track.style;
      const space = harness.measurer.measure(' ', style.font, style.weight, style.sizePx).width;
      const probed: ProbedTextBox[] = [];
      for (const cue of track.cues) {
        const peaks = peaksOf(cue);
        const found = boxes.get(cue.id) ?? [];
        expect(found).toHaveLength(peaks.length);
        found.forEach((box, wordIndex) => {
          probed.push(box);
          const words = box.words ?? [];
          expect(words).toHaveLength(cue.words.length);
          const popped = words[wordIndex]!;
          const label = `${fixture.name}: "${cue.words[wordIndex]?.text}" at frame ${box.frame}`;
          expect(popped.scale, label).toBeCloseTo(POP_SCALE, 3);
          words.forEach((other, otherIndex) => {
            const name = `"${cue.words[otherIndex]?.text}"`;
            expect(
              outside(other.box, preset.safe),
              `${label}: ${name} inside the safe rect`,
            ).toBeLessThanOrEqual(0.5);
            if (otherIndex === wordIndex) return;
            expect(other.scale, `${label}: one word pops at a time`).toBeCloseTo(1, 3);
            expect(overlap(popped.box, other.box), `${label} against ${name}`).toBeLessThanOrEqual(0.5);
            if (!sameLine(popped, other)) return;
            const gap = Math.max(
              other.box.x - (popped.box.x + popped.box.width),
              popped.box.x - (other.box.x + other.box.width),
            );
            expect(gap, `${label}: half a space from ${name}`).toBeGreaterThanOrEqual(space / 2 - 0.5);
          });
        });
      }
      const input = { plan: bundle.qaPlan, captions: track, boxes: probed, safe: preset.safe, target };
      expect(captionSafeZoneCheck(input).status).toBe('pass');
      expect(captionOverflowCheck(input).status).toBe('pass');
    },
  );

  /** The fixture's captions at their peaks, laid out by the real layout and then changed by `change`. */
  const checkedWith = async (fixture: Fixture, change: (laid: CueLayout) => CueLayout) => {
    const { track, frames } = trackOf(fixture);
    const captionLayout: CaptionLayout = (...args) => change(harness.layout(...args));
    const { boxes, bundle } = await harness.probe(track, frames, captionLayout, atPeaks);
    const input = {
      plan: bundle.qaPlan,
      captions: track,
      boxes: [...boxes.values()].flat(),
      safe: preset.safe,
      target,
    };
    return { overflow: captionOverflowCheck(input), safeZone: captionSafeZoneCheck(input) };
  };
  const collided = (result: Awaited<ReturnType<typeof checkedWith>>['overflow']) =>
    result.findings.some((finding) => finding.measured?.unit === 'px' && finding.measured.value > 1);

  it('the same captions without the push or the lead fail captionOverflow at the pop peaks', async () => {
    const changes: readonly [string, Fixture, (laid: CueLayout) => CueLayout][] = [
      ['without either', FIXTURES[0]!, ({ pop: _pop, ...laid }) => laid],
      [
        'without either',
        fixtureNamed('a stroke heavier than half a space'),
        ({ pop: _pop, ...laid }) => laid,
      ],
      [
        'without the push',
        FIXTURES[0]!,
        (laid) => ({
          ...laid,
          ...(laid.pop ? { pop: { ...laid.pop, push: laid.pop.push.map(() => 0) } } : {}),
        }),
      ],
      [
        'without the lead',
        FIXTURES[0]!,
        (laid) => ({ ...laid, ...(laid.pop ? { pop: { ...laid.pop, leadPx: 0 } } : {}) }),
      ],
    ];
    for (const [name, fixture, change] of changes) {
      const { overflow } = await checkedWith(fixture, change);
      expect(overflow.status, `${fixture.name} ${name}`).toBe('fail');
      expect(collided(overflow), `${fixture.name} ${name}`).toBe(true);
    }
  });

  it('the same captions wrapped as plain text push a line out of the safe rect at a peak', async () => {
    const fixture = fixtureNamed('a line plain text fills edge to edge');
    const { safeZone } = await checkedWith(fixture, (laid) => {
      const words = fixture.cues[0]?.split(' ') ?? [];
      const style = { ...trackOf(fixture).track.style, highlight: 'color' as const };
      const plain = harness.layout(words, style, preset.safe, fixture.language, preset.height);
      expect(plain.lines).not.toEqual(laid.lines);
      return { ...laid, lines: plain.lines, lineWords: plain.lineWords, widthPx: plain.widthPx };
    });
    expect(safeZone.status).toBe('fail');
  });
});

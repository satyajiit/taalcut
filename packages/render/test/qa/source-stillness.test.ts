// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How QA sees a clip's segment when it asks the footage about a render freeze (qa/passes/source-stillness.ts): the
 * view from the clip's reframe record, and the FFmpeg crop that follows the crop keys over a range of frames. The
 * crop's x and y expressions are evaluated here, as FFmpeg evaluates them for frame n of the range, and must give
 * the window `cropAt` gives at the range's start + n.
 */
import { describe, expect, it } from 'vitest';
import type { ReframedClip } from '../../src/qa/checks/reframe';
import { segmentView, viewFilters, type SegmentView } from '../../src/qa/passes/source-stillness';
import { cropAt } from '../../src/reframe/crop-window';
import type { CropKey } from '../../src/reframe/framing-types';

const CANVAS = { width: 1080, height: 1920 };

/** Evaluates the subset of FFmpeg's expression language the view writes: if, lt, +, *, -, parentheses, numbers. */
function evaluate(text: string, n: number): number {
  let at = 0;
  const consume = (token: string) => {
    if (!text.startsWith(token, at)) throw new Error(`expected ${token} at ${at} in ${text}`);
    at += token.length;
  };
  const number = () => {
    const match = /^-?\d+(\.\d+)?/.exec(text.slice(at));
    if (!match) throw new Error(`number expected at ${at} in ${text}`);
    at += match[0].length;
    return Number(match[0]);
  };
  const value = (): number => {
    if (text.startsWith('if(lt(n,', at)) {
      at += 'if(lt(n,'.length;
      const bound = number();
      consume('),');
      const then = value();
      consume(',');
      const otherwise = value();
      consume(')');
      return n < bound ? then : otherwise;
    }
    const base = number();
    if (!text.startsWith('+(n-(', at)) return base;
    consume('+(n-(');
    const from = number();
    consume('))*(');
    const slope = number();
    consume(')');
    return base + slope * (n - from);
  };
  const result = value();
  if (at !== text.length) throw new Error(`trailing text at ${at} in ${text}`);
  return result;
}

/** The crop filter's window at frame n of its range, as fractions of the segment. */
function windowAt(filter: string, n: number) {
  const match = /^crop=w=iw\*([\d.]+):h=ih\*([\d.]+):x='iw\*\((.*)\)':y='ih\*\((.*)\)'$/.exec(filter);
  if (!match) throw new Error(`not a window crop: ${filter}`);
  return {
    x: evaluate(match[3]!, n),
    y: evaluate(match[4]!, n),
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

const rect = (x: number, y: number) => ({ x, y, width: 0.25, height: 0.5 });
const KEYS: CropKey[] = [
  { frame: 0, rect: rect(0.1, 0.2) },
  { frame: 12.5, rect: rect(0.4, 0.1) },
  { frame: 30, rect: rect(0.35, 0.3) },
  { frame: 31, rect: rect(0.6, 0.3) },
  { frame: 80, rect: rect(0.2, 0.45) },
];

describe('segment view', () => {
  it('shows a clip without a reframe record whole', () => {
    expect(segmentView(undefined, CANVAS)).toEqual({ kind: 'whole' });
    expect(viewFilters({ kind: 'whole' }, 10, 20)).toEqual([]);
  });

  it('contains a blurred-pad clip in the canvas, its pad still', () => {
    const clip = {
      clipId: 'clip-a',
      visible: { start: 0, end: 60 },
      framing: { kind: 'blurPad', reason: 'subjectTooTall' },
      reframe: null,
      source: { width: 1080, height: 1920 },
      extent: { x: 0, y: 0, width: 1, height: 1 },
    } satisfies ReframedClip;
    const view = segmentView(clip, { width: 1920, height: 1080 });
    expect(view).toEqual({ kind: 'contained', canvas: { width: 1920, height: 1080 } });
    expect(viewFilters(view, 0, 30)).toEqual([
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
    ]);
  });

  it("follows a crop's keys as fractions of the segment's extent", () => {
    const clip = {
      clipId: 'clip-a',
      visible: { start: 0, end: 90 },
      framing: { kind: 'crop', reason: 'subject', keys: KEYS, subject: [], scale: 1, faces: [], raw: [] },
      reframe: null,
      source: { width: 1920, height: 1080 },
      extent: { x: 0.05, y: 0.1, width: 0.8, height: 0.8 },
    } satisfies ReframedClip;
    const view = segmentView(clip, CANVAS);
    if (view.kind !== 'window') throw new Error(view.kind);
    expect(view.keys[1]!.frame).toBe(12.5);
    expect(view.keys[1]!.rect.x).toBeCloseTo((0.4 - 0.05) / 0.8, 12);
    expect(view.keys[1]!.rect.y).toBeCloseTo(0, 12);
    expect(view.keys[1]!.rect.width).toBeCloseTo(0.25 / 0.8, 12);
    expect(view.keys[1]!.rect.height).toBeCloseTo(0.5 / 0.8, 12);
  });

  it.each([
    ['from the first frame', 0, 90],
    ['starting between keys', 7, 20],
    ['starting on a key', 30, 15],
    ['across a one-frame step', 25, 10],
    ['past the last key', 70, 20],
  ])('crops the window cropAt gives, %s', (_label, start, frames) => {
    const view: SegmentView = { kind: 'window', keys: KEYS };
    const filters = viewFilters(view, start, frames);
    expect(filters).toHaveLength(1);
    for (let n = 0; n < frames; n++) {
      const expected = cropAt(KEYS, start + n);
      const drawn = windowAt(filters[0]!, n);
      expect(drawn.x, `x at ${start + n}`).toBeCloseTo(expected.x, 5);
      expect(drawn.y, `y at ${start + n}`).toBeCloseTo(expected.y, 5);
      expect(drawn.width).toBeCloseTo(expected.width, 5);
      expect(drawn.height).toBeCloseTo(expected.height, 5);
    }
  });

  it('writes only the keys that bracket the range', () => {
    const [filter] = viewFilters({ kind: 'window', keys: KEYS }, 31, 10);
    // Keys at 31 and 80 bracket frames 31–40: on each axis, the hold before, one linear piece and the hold after.
    expect(filter!.match(/if\(lt/g)).toHaveLength(4);
    expect(filter).not.toContain('12.5');
  });
});

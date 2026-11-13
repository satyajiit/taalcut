// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lowering's widenings (HFW1 hf): positions placed as GSAP places them (delays, repeats and staggers included),
 * finite repeat and yoyo, keyframes in their three forms unrolled, motion paths and line splits.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkup } from '../../src/workspace/html/markup';
import { lowerScript, type LoweredMotion } from '../../src/workspace/lower/lower';
import { placeCalls } from '../../src/workspace/lower/positions';
import { WORKSPACE_MARKUP, WORKSPACE_MARKUP_LIMITS } from '../../src/workspace/gate/markup-rules';

const ROOT = `<div id="root" data-composition-id="t" data-width="1080" data-height="1920" data-duration="6">
  <div id="card"><h1 id="title">Hello there friend</h1><p class="tag">one</p><p class="tag">two</p><p class="tag">three</p></div>
  <svg viewBox="0 0 10 10"><path id="route" d="M0,0 C40,-60 160,-60 200,0"/><path id="moved" d="M0 0 L5 5" transform="translate(2,2)"/></svg>
</div>`;

const root = () => {
  const parsed = parseMarkup(ROOT, WORKSPACE_MARKUP_LIMITS, WORKSPACE_MARKUP);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.nodes[0]!;
};

const script = (body: string, options = '{ paused: true }') =>
  `gsap.registerPlugin(SplitText, MotionPathPlugin);\nconst tl = gsap.timeline(${options});\n${body}\nwindow.__timelines["t"] = tl;`;

const lowered = (body: string, options?: string): LoweredMotion => {
  const result = lowerScript(script(body, options), root());
  if (!result.ok) throw new Error(JSON.stringify(result.findings, null, 1));
  return result.motion;
};
const codes = (body: string, options?: string) => {
  const result = lowerScript(script(body, options), root());
  return result.ok ? [] : result.findings.map((finding) => finding.code);
};
const starts = (motion: LoweredMotion) => motion.tweens.map((tween) => tween.at);

describe('placing a script’s tweens as GSAP does', () => {
  it('starts a tween after its delay and ends it after its repeats and stagger', () => {
    const motion = lowered(
      'tl.to("#card", { x: 10, duration: 1, delay: 0.3, repeat: 2, yoyo: true, repeatDelay: 0.1 }, 0.5);\n' +
        'tl.to("#title", { opacity: 0.5 });\n' +
        'tl.to(".tag", { y: 5, duration: 0.4, stagger: 0.2 }, "<");\n' +
        'tl.to("#title", { x: 4 }, ">");\n' +
        'tl.to("#title", { y: 4 }, "-=0.25");',
    );
    // 0.5 + 0.3 delay; ends at 0.8 + 3 runs of 1 s + 2 repeat delays of 0.1 = 4.0.
    expect(starts(motion)).toEqual([0.8, 4, 4, expect.closeTo(4.8, 9), expect.closeTo(5.05, 9)]);
    expect(motion.tweens[0]).toMatchObject({ repeat: { count: 2, yoyo: true, delay: 0.1 } });
    expect(motion.tweens[1]?.repeat).toBeUndefined();
  });

  it('places labels and positions from them, adding an unknown label at the end', () => {
    const motion = lowered(
      'tl.to("#card", { x: 10, duration: 2 }, 0);\ntl.addLabel("exit", "-=0.5");\ntl.to("#card", { opacity: 0 }, "exit");\n' +
        'tl.to("#title", { x: 1 }, "later+=0.25");',
    );
    expect(starts(motion)).toEqual([0, 1.5, 2.25]);
    expect(motion.labels).toEqual({ exit: 1.5 });
  });

  it('refuses a position read from an end that depends on the words, a percent, and a start before 0', () => {
    const split = 'const s = SplitText.create("#title", { type: "words" });\n';
    expect(codes(`${split}tl.from(s.words, { y: 10, stagger: 0.1 }, 0);\ntl.to("#card", { x: 1 });`)).toEqual(
      ['lower.position'],
    );
    // From its start, or at seconds, it places.
    expect(
      starts(
        lowered(`${split}tl.from(s.words, { y: 10, stagger: 0.1 }, 0.2);\ntl.to("#card", { x: 1 }, "<0.1");`),
      ),
    ).toEqual([0.2, expect.closeTo(0.3, 9)]);
    expect(codes('tl.to("#card", { x: 1, duration: 1 }, 0);\ntl.to("#card", { y: 1 }, "<50%");')).toEqual([
      'lower.position',
    ]);
    expect(codes('tl.to("#card", { x: 1 }, "-=1");')).toEqual(['lower.position']);
  });

  it('agrees with GSAP’s own placement on a mixed chain', () => {
    const placed = placeCalls([
      { kind: 'tween', position: undefined, delay: 0, length: 1 },
      { kind: 'tween', position: '+=0.5', delay: 0.2, length: 1 },
      { kind: 'label', name: 'mid', position: undefined },
      { kind: 'tween', position: '<-0.1', delay: 0, length: 0.4 },
      { kind: 'tween', position: 'mid-=0.2', delay: 0, length: 0.1 },
    ]);
    expect(placed.starts).toEqual([0, 1.7, 1.6, 2.5]);
    expect(placed.labels.get('mid')).toBe(2.7);
  });
});

describe('repeat, keyframes, motion paths and lines', () => {
  it('refuses an endless or huge repeat with a hint', () => {
    expect(codes('tl.to("#card", { x: 10, repeat: -1 }, 0);')).toEqual(['lower.repeat']);
    expect(codes('tl.to("#card", { x: 10, repeat: 50 }, 0);')).toEqual(['lower.repeat']);
    const result = lowerScript(script('tl.to("#card", { x: 10, repeat: -1 }, 0);'), root());
    expect(!result.ok && result.findings[0]?.fixHint).toMatch(/at most 20/);
  });

  it('unrolls an array of frames one after another, eased "none" unless a frame says', () => {
    const motion = lowered(
      'tl.to("#card", { keyframes: [{ x: 100, duration: 1 }, { y: 50, duration: 0.5, ease: "power2.out" }, { opacity: 0 }] }, 1);',
    );
    expect(motion.tweens).toEqual([
      { targets: { ids: ['card'] }, at: 1, duration: 1, from: {}, to: { x: 100 }, ease: 'none' },
      { targets: { ids: ['card'] }, at: 2, duration: 0.5, from: {}, to: { y: 50 }, ease: 'power2.out' },
      { targets: { ids: ['card'] }, at: 2.5, duration: 0.5, from: {}, to: { opacity: 0 }, ease: 'none' },
    ]);
    // The parser's percentages are rounded to 0.1% (43.5% of 2.3 s is 1.0005 s); the frames keep their own lengths.
    const uneven = lowered(
      'tl.to("#card", { keyframes: [{ x: 1, duration: 1 }, { y: 2, duration: 0.8 }, { x: 3 }] }, 0);',
    );
    expect(uneven.tweens.map((tween) => [tween.at, tween.duration])).toEqual([
      [0, 1],
      [1, 0.8],
      [1.8, 0.5],
    ]);
  });

  it('unrolls percentages and value arrays per property over the duration', () => {
    const percent = lowered(
      'tl.to("#card", { keyframes: { "0%": { x: 0 }, "50%": { x: 100, ease: "power2.in" }, "100%": { x: 50, y: 20 }, easeEach: "sine.inOut" }, duration: 2 }, 0);',
    );
    expect(percent.tweens.map((tween) => [tween.at, tween.duration, tween.to, tween.ease])).toEqual([
      [0, 0, { x: 0 }, undefined],
      [0, 1, { x: 100 }, 'power2.in'],
      [1, 1, { x: 50 }, 'sine.inOut'],
      [0, 2, { y: 20 }, 'sine.inOut'],
    ]);
    const arrays = lowered(
      'tl.to("#card", { keyframes: { x: [0, 100, 50] }, duration: 3, ease: "none" }, 0);',
    );
    expect(arrays.tweens.map((tween) => [tween.at, tween.duration, tween.to.x, tween.ease])).toEqual([
      [0, 0, 0, undefined],
      [0, 1.5, 100, 'power1.inOut'],
      [1.5, 1.5, 50, 'power1.inOut'],
    ]);
  });

  it('refuses keyframes eased as a whole, by the tween or by the timeline’s default', () => {
    expect(codes('tl.to("#card", { keyframes: [{ x: 1 }, { x: 2 }], ease: "power2.out" }, 0);')).toEqual([
      'lower.keyframes',
    ]);
    expect(
      codes(
        'tl.to("#card", { keyframes: [{ x: 1 }, { x: 2 }] }, 0);',
        '{ paused: true, defaults: { ease: "power2.out" } }',
      ),
    ).toEqual(['lower.keyframes']);
    expect(
      codes(
        'tl.to("#card", { keyframes: [{ x: 1 }, { x: 2 }], ease: "none" }, 0);',
        '{ paused: true, defaults: { ease: "power2.out" } }',
      ),
    ).toEqual([]);
    expect(codes('tl.to(".tag", { keyframes: [{ x: 1 }, { x: 2 }], stagger: 0.1 }, 0);')).toEqual([
      'lower.keyframes',
    ]);
  });

  it('lowers a motion path from data or a path of the composition, and refuses align and point lists', () => {
    const data = lowered(
      'tl.to("#card", { motionPath: { path: "M0,0 L100,50", autoRotate: true }, duration: 2 }, 0);',
    );
    expect(data.tweens[0]?.to.motionPath).toEqual({
      path: 'M0,0 L100,50',
      autoRotate: true,
      start: 0,
      end: 1,
    });
    const byId = lowered('tl.to("#card", { motionPath: "#route", duration: 2 }, 0);');
    expect(byId.tweens[0]?.to.motionPath).toEqual({
      path: 'M0,0 C40,-60 160,-60 200,0',
      autoRotate: false,
      start: 0,
      end: 1,
    });
    expect(codes('tl.to("#card", { motionPath: { path: "#route", align: "#route" } }, 0);')).toEqual([
      'lower.motionPath',
    ]);
    expect(codes('tl.to("#card", { motionPath: { path: [{ x: 0, y: 0 }, { x: 9, y: 9 }] } }, 0);')).toContain(
      'lower.motionPath',
    );
    expect(codes('tl.to("#card", { motionPath: "m0,0 l10,10" }, 0);')).toEqual(['lower.motionPath']);
    expect(codes('tl.to("#card", { motionPath: "#moved" }, 0);')).toEqual(['lower.motionPath']);
  });

  it('splits lines (masked) and targets them', () => {
    const motion = lowered(
      'const s = SplitText.create("#title", { type: "words,lines", mask: "lines" });\n' +
        'tl.from(s.lines, { yPercent: 100, duration: 0.6, stagger: 0.1 }, 0);',
    );
    expect(motion.splits).toEqual([{ id: 'title', type: 'lines,words', mask: 'lines' }]);
    expect(motion.tweens[0]?.targets).toEqual({ split: ['title'], unit: 'lines' });
  });
});

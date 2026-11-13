// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lowering (HFW1 hf): a composition's one GSAP script, read by HyperFrames' parser, becomes tc.js motion data
 * against the composition's own markup; what does not lower is refused with a fix hint.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkup } from '../../src/workspace/html/markup';
import { lowerScript } from '../../src/workspace/lower/lower';
import { WORKSPACE_MARKUP, WORKSPACE_MARKUP_LIMITS } from '../../src/workspace/gate/markup-rules';
import { gatedFixture } from './support';

const ROOT = `<div id="root" data-composition-id="t" data-width="1080" data-height="1920" data-duration="3">
  <div id="card"><h1 id="title" class="big">Hello there</h1><p class="tag">one</p><p class="tag">two</p></div>
  <svg viewBox="0 0 10 10"><path id="line" d="M0 0 L10 10"/></svg>
</div>`;

const root = () => {
  const parsed = parseMarkup(ROOT, WORKSPACE_MARKUP_LIMITS, WORKSPACE_MARKUP);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.nodes[0]!;
};

const script = (body: string) =>
  `gsap.registerPlugin(SplitText, DrawSVGPlugin);\nconst tl = gsap.timeline({ paused: true });\n${body}\nwindow.__timelines["t"] = tl;`;

const codes = (body: string) => {
  const lowered = lowerScript(script(body), root());
  return lowered.ok ? [] : lowered.findings.map((finding) => finding.code);
};

describe('lowering a composition’s script', () => {
  it('lowers the headline fixture: letters from a split, the underline’s draw and the exit at its label', async () => {
    const { motion } = await gatedFixture('headline.html');
    expect(motion.splits).toEqual([{ id: 'title', type: 'words,chars', mask: 'chars' }]);
    expect(motion.labels).toEqual({ enter: 0, exit: 3.4 });
    expect(motion.tweens).toEqual([
      {
        targets: { split: ['title'], unit: 'chars' },
        at: 0.2,
        duration: 0.6,
        method: 'from',
        immediateRender: true,
        from: { yPercent: 110 },
        to: {},
        ease: 'power3.out',
        stagger: { each: 0.025, from: 'start' },
      },
      {
        targets: { ids: ['underline-path'] },
        at: 0.7,
        duration: 0.8,
        from: { drawSVG: '0%' },
        to: { drawSVG: '100%' },
        ease: 'power2.inOut',
        immediateRender: true,
      },
      {
        targets: { ids: ['card'] },
        at: 3.4,
        duration: 0.5,
        from: {},
        to: { opacity: 0, y: -40 },
        ease: 'power2.in',
      },
    ]);
  });

  it('resolves classes in document order, relative positions and GSAP’s defaults', () => {
    const lowered = lowerScript(
      script(
        'tl.to(".tag", { x: "40px", rotation: "12deg", stagger: { amount: 0.3, from: "end" } }, 1);\n' +
          'tl.set("#card .big", { opacity: 0.5 }, 1.75);',
      ),
      root(),
    );
    if (!lowered.ok) throw new Error(JSON.stringify(lowered.findings));
    const [tags, set] = lowered.motion.tweens;
    expect(tags).toEqual({
      targets: { ids: ['_t0', '_t1'] },
      at: 1,
      duration: 0.5,
      from: {},
      to: { x: 40, rotation: 12 },
      ease: 'power1.out',
      stagger: { amount: 0.3, from: 'end' },
    });
    expect(set).toEqual({
      targets: { ids: ['title'] },
      at: 1.75,
      duration: 0,
      from: {},
      to: { opacity: 0.5 },
    });
    expect([...lowered.motion.generatedIds.values()]).toEqual(['_t0', '_t1']);
  });

  it('refuses what HyperFrames runs but tc.js would not, each with a hint', () => {
    expect(codes('tl.to("#card", { x: Math.random() * 100 }, 0);')).toContain('lower.forbidden');
    expect(codes('tl.to("#card", { x: Date.now() % 5 }, 0);')).toContain('lower.forbidden');
    expect(codes('fetch("https://example.com/x.json");')).toContain('lower.forbidden');
    expect(codes('eval("tl.to(\'#card\', { x: 1 })");')).toContain('lower.forbidden');
    expect(codes('tl.to("#card", { x: 10, repeat: -1 }, 0);')).toContain('lower.repeat');
    expect(codes('for (let i = 0; i < 3; i++) tl.to("#card", { x: i * 10 }, i);')).toContain(
      'lower.scriptShape',
    );
    expect(codes('document.querySelector("#title").textContent = "x";')).toContain('lower.scriptShape');
    expect(codes('const other = gsap.timeline({ paused: true });')).toContain('lower.multipleTimelines');
    expect(codes('tl.to("#nothing", { x: 10 }, 0);')).toContain('lower.target');
    expect(codes('tl.to("#card", { x: "+=10" }, 0);')).toContain('lower.value');
    expect(codes('tl.to("#card", { fontSize: 20 }, 0);')).toContain('lower.property');
    expect(codes('tl.to("#card", { x: 1, ease: "wiggle(3)" }, 0);')).toContain('lower.ease');
    // A stagger over a split lasts as long as its words make it: a position from its end is refused.
    expect(
      codes(
        'const s = SplitText.create("#title", { type: "words" });\ntl.from(s.words, { y: 10, stagger: 0.1 }, 0);\n' +
          'tl.to("#card", { x: 1 }, "+=0.1");',
      ),
    ).toContain('lower.position');
    expect(codes('tl.to("#card", { keyframes: [{ x: 1 }, { x: 2 }], ease: "power2.out" }, 0);')).toContain(
      'lower.keyframes',
    );
    expect(
      codes('const s = SplitText.create("#title", { type: "rows" }); tl.from(s.rows, { y: 10 }, 0);'),
    ).toContain('lower.split');
    const lowered = lowerScript(script('tl.to("#card", { x: Math.random() }, 0);'), root());
    expect(lowered.ok).toBe(false);
    if (!lowered.ok)
      for (const finding of lowered.findings) expect(finding.fixHint.length).toBeGreaterThan(10);
  });

  it('resolves positions relative to the timeline’s end and labels', () => {
    const lowered = lowerScript(
      script(
        'tl.to("#line", { drawSVG: "50%", duration: 1 }, 2);\ntl.to("#line", { drawSVG: "60%" }, "+=0.1");\n' +
          'tl.addLabel("exit", 2.5);\ntl.to("#card", { opacity: 0 }, "exit+=0.2");',
      ),
      root(),
    );
    if (!lowered.ok) throw new Error(JSON.stringify(lowered.findings));
    expect(lowered.motion.tweens.map((tween) => tween.at)).toEqual([2, 3.1, expect.closeTo(2.7, 9)]);
    expect(lowered.motion.labels).toEqual({ exit: 2.5 });
  });

  it('drops a dwell that only lengthens the timeline', () => {
    const lowered = lowerScript(
      script('tl.to("#card", { x: 5 }, 0);\ntl.to({}, { duration: 2 }, 1);'),
      root(),
    );
    expect(lowered.ok && lowered.motion.tweens.length).toBe(1);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fold (HFW1 hf, compile/layers/compositions.ts): a gated composition joins the timeline's one composition at
 * its item's place, ids prefixed, words escaped, rules scoped, and its tweens moved onto the master timeline.
 */
import { lintHyperframeHtml } from '@hyperframes/core/lint';
import { describe, expect, it } from 'vitest';
import { createCompositionFonts } from '../../src/captions/fonts';
import type { MotionPart } from '../../src/motion/motion-data';
import { FONTS_DIR, testMeasurer } from '../support/fonts';
import { compileWith, gatedFixture, placement, stillTimeline } from './support';

const motionOf = (html: string): MotionPart =>
  (
    JSON.parse(/<script type="application\/json" id="tc-data">([^<]*)<\/script>/.exec(html)?.[1] ?? '{}') as {
      motion: MotionPart;
    }
  ).motion;

describe('folding a composition into the timeline', () => {
  it('draws it as one clip in the item’s window, its ids prefixed and its words escaped', async () => {
    const headline = await gatedFixture('headline.html');
    const bundle = compileWith(stillTimeline(180), [
      placement(headline, { start: 30, end: 150 }, { title: 'Fresh <news> & more', accent: '#00ff88' }),
    ]);
    const html = bundle.files['index.html']!;
    expect(html).toContain('<div id="w-ITEM1" class="clip tc-comp" data-tc-composition data-start="1" data-duration="4">');
    expect(html).toContain('<h1 id="w-ITEM1-title">Fresh &lt;news&gt; &amp; more</h1>');
    expect(html).not.toMatch(/data-var-|data-composition-id="headline"|<template|window\.__timelines/);
    const css = bundle.files['tc.css']!;
    expect(css).toContain('#w-ITEM1 { z-index: 190;');
    expect(css).toContain('--accent: #00ff88;');
    expect(css).toContain('#w-ITEM1 #w-ITEM1-underline-path { fill: none; stroke: var(--accent);');
    expect(css).toMatch(/#w-ITEM1 #w-ITEM1-title \{[^}]*font-family: 'Anton', 'Noto Sans'/);
    const motion = motionOf(html);
    expect(motion.splits).toEqual([{ id: 'w-ITEM1-title', type: 'words,chars', mask: 'chars' }]);
    expect(motion.tweens.map((tween) => [tween.targets, tween.at])).toEqual([
      [{ split: ['w-ITEM1-title'], unit: 'chars' }, 1.2],
      [{ ids: ['w-ITEM1-underline-path'] }, 1.7],
      [{ ids: ['w-ITEM1-card'] }, 4.4],
    ]);
    expect(Object.keys(bundle.links)).toEqual(
      expect.arrayContaining(['vendor/gsap/SplitText.min.js', 'vendor/gsap/DrawSVGPlugin.min.js']),
    );
  });

  it('moves the exit with a longer item, and a value that does not fit falls back to the default', async () => {
    const headline = await gatedFixture('headline.html');
    const bundle = compileWith(stillTimeline(240), [
      placement(headline, { start: 30, end: 210 }, { accent: 'red' }),
    ]);
    expect(motionOf(bundle.files['index.html']!).tweens.map((tween) => tween.at)).toEqual([1.2, 1.7, 6.4]);
    expect(bundle.files['tc.css']).toContain('--accent: #ffd23f;');
    expect(bundle.warnings).toContain('composition ITEM1: variable accent has a value that does not fit it');
  });

  it('passes HyperFrames’ lint as the page runs it', async () => {
    const headline = await gatedFixture('headline.html');
    const fonts = createCompositionFonts(FONTS_DIR, await testMeasurer());
    const bundle = compileWith(stillTimeline(180), [placement(headline, { start: 30, end: 150 })], { fonts });
    const html = bundle.files['index.html']!.replace(
      '<script src="tc.js"></script>',
      () => `<script>${bundle.files['tc.js']!}</script>`,
    );
    const lint = await lintHyperframeHtml(html, {
      filePath: 'index.html',
      externalStyles: [{ href: 'tc.css', content: bundle.files['tc.css']! }],
    });
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });

  it('two placements of one composition never share an id', async () => {
    const headline = await gatedFixture('headline.html');
    const bundle = compileWith(stillTimeline(300), [
      placement(headline, { start: 0, end: 120 }, {}, 'A'),
      placement(headline, { start: 150, end: 270 }, {}, 'B'),
    ]);
    const ids = [...bundle.files['index.html']!.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

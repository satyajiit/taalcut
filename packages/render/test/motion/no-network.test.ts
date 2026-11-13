// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Motion never reaches the network and never carries markup (SPEC G.1, G.2): a composition using every kind of
 * motion names no URL with a scheme in its index.html, tc.css or tc.js; each script it loads is a bundle file it
 * links; and every tween's properties, values and eases are ones tc.js accepts, in both variants.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime } from '@taalcut/core';
import { compileComposition, type CompileOptions } from '../../src/compile/composition';
import { CUBIC_BEZIER, EASES, MOTION_PROPERTIES, type MotionPart } from '../../src/motion/motion-data';
import { valueAllowed } from '../../src/motion/motion-values';
import { presetFor } from '../../src/presets/presets.v1';
import { motionTimeline } from './support';
import { HF_FIXTURES } from '../workspace/fixture-list';
import { gatedFixture, placement, stillTimeline } from '../workspace/support';

const media: CompileOptions['media'] = (visual) => ({
  file: `/media/${visual.assetId}.mp4`,
  key: `key-${visual.assetId}`,
  mediaStart: RationalTime.zero(FrameRate.of(30)),
  ext: 'mp4',
});

const { timeline } = await motionTimeline();
const compile = (variant: 'export' | 'preview') => {
  const result = compileComposition(timeline, {
    variant,
    preset: presetFor('device'),
    burnCaptions: true,
    media,
    ...(variant === 'preview' ? { runtimeScript: { file: '/runtime.js', key: 'runtime' } } : {}),
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

const motionOf = (html: string): MotionPart => {
  const json = /<script type="application\/json" id="tc-data">([^<]*)<\/script>/.exec(html)?.[1] ?? '{}';
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null || !('motion' in data)) throw new Error('no motion data');
  const motion: unknown = data.motion;
  if (typeof motion !== 'object' || motion === null || !('tweens' in motion) || !('splits' in motion))
    throw new Error('bad motion data');
  return motion as MotionPart;
};

describe('motion and the network', () => {
  for (const variant of ['export', 'preview'] as const) {
    it(`${variant}: no URL with a scheme, every script a linked bundle file`, () => {
      const bundle = compile(variant);
      for (const [path, text] of Object.entries(bundle.files)) {
        expect(text, path).not.toMatch(/\b[a-z][a-z0-9+.-]*:\/\//i);
        expect(text, path).not.toMatch(/url\(\s*['"]?(?:https?:|\/\/|data:)/i);
      }
      const html = bundle.files['index.html'] ?? '';
      const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1] ?? '');
      expect(scripts).toContain('tc.js');
      for (const src of scripts) expect(src in bundle.files || src in bundle.links, src).toBe(true);
      // Transitions and captions: GSAP and its eases (the kit's graphics loaded the plugins; HFW1 retire).
      expect(scripts.filter((src) => src.startsWith('vendor/gsap/'))).toEqual([
        'vendor/gsap/gsap.min.js',
        'vendor/gsap/CustomEase.min.js',
      ]);
    });

    it(`${variant}: every tween is one tc.js accepts`, () => {
      const motion = motionOf(compile(variant).files['index.html'] ?? '');
      expect(motion.tweens.length).toBeGreaterThan(50);
      const properties: ReadonlySet<string> = new Set(MOTION_PROPERTIES);
      const eases: ReadonlySet<string> = new Set(EASES);
      for (const tween of motion.tweens) {
        for (const vars of [tween.from, tween.to])
          for (const [property, value] of Object.entries(vars)) {
            expect(properties.has(property), property).toBe(true);
            const known = MOTION_PROPERTIES.find((name) => name === property);
            expect(
              known !== undefined && valueAllowed(known, value),
              `${property}: ${JSON.stringify(value)}`,
            ).toBe(true);
          }
        if (tween.ease !== undefined)
          expect(eases.has(tween.ease) || CUBIC_BEZIER.test(tween.ease), tween.ease).toBe(true);
        expect(Number.isFinite(tween.at) && tween.at >= 0).toBe(true);
        expect(Number.isFinite(tween.duration) && tween.duration >= 0).toBe(true);
      }
    });
  }

  it('preview and export carry the same motion for the same preset', () => {
    expect(motionOf(compile('preview').files['index.html'] ?? '')).toEqual(
      motionOf(compile('export').files['index.html'] ?? ''),
    );
  });
});

describe('workspace compositions and the network (HFW1)', () => {
  it('folds every HyperFrames fixture naming no URL with a scheme, every tween one tc.js accepts', async () => {
    const placed = await Promise.all(
      HF_FIXTURES.map(async (name, index) =>
        placement(
          await gatedFixture(`${name}.html`),
          { start: index * 10, end: index * 10 + 90 },
          {},
          `F${index}`,
        ),
      ),
    );
    for (const variant of ['export', 'preview'] as const) {
      const result = compileComposition(stillTimeline(240), {
        variant,
        preset: presetFor('device'),
        burnCaptions: false,
        media,
        compositions: placed,
        ...(variant === 'preview' ? { runtimeScript: { file: '/runtime.js', key: 'runtime' } } : {}),
      });
      if (!result.ok) throw new Error(result.error.code);
      for (const [path, text] of Object.entries(result.value.files)) {
        expect(text, path).not.toMatch(/\b[a-z][a-z0-9+.-]*:\/\//i);
        expect(text, path).not.toMatch(/jsdelivr|unpkg|cdnjs/i);
      }
      const motion = motionOf(result.value.files['index.html'] ?? '');
      for (const tween of motion.tweens)
        for (const vars of [tween.from, tween.to])
          for (const [property, value] of Object.entries(vars)) {
            const known = MOTION_PROPERTIES.find((name) => name === property);
            expect(
              known !== undefined && valueAllowed(known, value),
              `${property}: ${JSON.stringify(value)}`,
            ).toBe(true);
          }
    }
  });
});

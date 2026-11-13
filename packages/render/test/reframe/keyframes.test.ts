// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { cropAt, coverWindow, placeWindow, windowCrop } from '../../src/reframe/crop-window';
import type { CropKey, VisualFraming } from '../../src/reframe/framing-types';
import { blurPadGeometry, framingGeometry, framingStyle, probedCrop } from '../../src/reframe/keyframes';
import { RATE_30 } from './support';

type Crop = Extract<VisualFraming, { kind: 'crop' }>;
const W = 0.31640625;
const crop = (keys: readonly CropKey[], scale = 1): Crop => ({
  kind: 'crop',
  reason: 'subject',
  keys,
  subject: keys.map(() => null),
  scale,
  faces: keys.map(() => null),
  raw: keys.map(() => null),
});
const rect = (x: number, y = 0, width = W, height = 1) => ({ x, y, width, height });
const canvas = { width: 1080, height: 1920 };
const source = { width: 1920, height: 1080 };
const aspect = 1920 / 1080;
const whole = { x: 0, y: 0, width: 1, height: 1 };

type Style = ReturnType<typeof framingStyle>;

/** A property's moving tweens (the set at 0 aside), in time order. */
const moving = (style: Style, property: 'objectPosition' | 'transformOrigin') =>
  style.tweens.filter((tween) => tween.duration > 0 && property in tween.to);

/** The value a property's tweens give at each key: each segment starts on a key, the last ends on one. */
function atKeys(style: Style, property: 'objectPosition' | 'transformOrigin'): string[] {
  const tweens = moving(style, property);
  const values = tweens.map((tween) => String(tween.from[property]));
  const last = tweens.at(-1);
  return last ? [...values, String(last.to[property])] : [];
}

/** Reads a style's values back the way the probe would see them at a key. */
function probedAtKeys(style: Style, framing: Crop) {
  const position = atKeys(style, 'objectPosition');
  const origin = atKeys(style, 'transformOrigin');
  return framing.keys.map((_, index) => ({
    objectPosition:
      position[Math.min(index, position.length - 1)] ??
      /object-position: ([^;]+);/.exec(style.css[0] ?? '')?.[1] ??
      '',
    scale: framing.scale > 1 ? String(framing.scale) : 'none',
    transformOrigin:
      origin[Math.min(index, origin.length - 1)] ??
      /transform-origin: ([^;]+);/.exec(style.css[0] ?? '')?.[1] ??
      '540px 960px',
  }));
}

describe('crop windows', () => {
  it('sizes the cover window for both aspects', () => {
    expect(coverWindow(aspect, 9 / 16).width).toBeCloseTo(W, 9);
    expect(coverWindow(9 / 16, 16 / 9)).toEqual({ width: 1, height: 9 / 16 / (16 / 9) });
  });

  it('places and recovers a punch-in crop', () => {
    const window = coverWindow(9 / 16, 9 / 16);
    const target = rect(0.05, 0.02, 1 / 1.1, 1 / 1.1);
    const placed = placeWindow(target, window, 1.1);
    const back = windowCrop(placed, window, 1.1);
    expect(back.x).toBeCloseTo(target.x, 12);
    expect(back.y).toBeCloseTo(target.y, 12);
  });
});

describe('framingStyle', () => {
  const framing = crop([
    { frame: 0, rect: rect(0.1) },
    { frame: 30, rect: rect(0.4) },
    { frame: 60, rect: rect(0.4) },
  ]);

  it('pans with object-position tweens, linear between keys, on the visible window', () => {
    const style = framingStyle({
      elementId: 'v-a',
      framing,
      extent: whole,
      canvas,
      sourceAspect: aspect,
      visible: { start: 10, end: 70 },
      rate: RATE_30,
    });
    expect(style.css[0]).toContain('#v-a { object-fit: cover; object-position:');
    // The value it rests on is set at 0; one linear tween from frame 10 to 40; the hold after it is no tween.
    expect(style.tweens).toEqual([
      { targets: { ids: ['v-a'] }, at: 0, duration: 0, from: {}, to: { objectPosition: '14.6286% 50%' } },
      {
        targets: { ids: ['v-a'] },
        at: 10 / 30,
        duration: 1,
        from: { objectPosition: '14.6286% 50%' },
        to: { objectPosition: '58.5143% 50%' },
        ease: 'none',
      },
    ]);
    expect(moving(style, 'transformOrigin')).toEqual([]);
  });

  it('round-trips through the probe: the drawn crop is the planned one at every key', () => {
    for (const extent of [whole, { x: 0.05, y: 0, width: 0.7, height: 1 }]) {
      const style = framingStyle({
        elementId: 'v-a',
        framing,
        extent,
        canvas,
        sourceAspect: aspect,
        visible: { start: 0, end: 60 },
        rate: RATE_30,
      });
      probedAtKeys(style, framing).forEach((probed, index) => {
        const drawn = probedCrop(probed, { canvas, extent, sourceAspect: aspect });
        const planned = cropAt(framing.keys, framing.keys[index]?.frame ?? 0);
        expect(Math.abs((drawn?.x ?? -1) - planned.x) * (canvas.width / W)).toBeLessThan(0.01);
      });
    }
  });

  it('draws a punch-in as scale about a moving transform-origin', () => {
    const punched = crop(
      [
        { frame: 0, rect: rect(0, 0.0, 1 / 1.1, 1 / 1.1) },
        { frame: 30, rect: rect(1 - 1 / 1.1, 0.05, 1 / 1.1, 1 / 1.1) },
      ],
      1.1,
    );
    const style = framingStyle({
      elementId: 'v-b',
      framing: punched,
      extent: whole,
      canvas,
      sourceAspect: 9 / 16,
      visible: { start: 0, end: 30 },
      rate: RATE_30,
    });
    expect(style.css[0]).toContain('scale: 1.1;');
    expect(atKeys(style, 'transformOrigin')).toEqual(['0px 0px', '1080px 1056px']);
    probedAtKeys(style, punched).forEach((probed, index) => {
      const drawn = probedCrop(probed, { canvas, extent: whole, sourceAspect: 9 / 16 });
      const planned = punched.keys[index]?.rect;
      expect(drawn?.x).toBeCloseTo(planned?.x ?? -1, 6);
      expect(drawn?.y).toBeCloseTo(planned?.y ?? -1, 6);
      expect(drawn?.width).toBeCloseTo(1 / 1.1, 9);
    });
  });

  it('returns null for a probe it cannot read', () => {
    expect(
      probedCrop(
        { objectPosition: 'center', scale: 'none', transformOrigin: '0px 0px' },
        { canvas, extent: whole, sourceAspect: aspect },
      ),
    ).toBeNull();
  });
});

describe('framingGeometry', () => {
  it('scales the source so the crop maps onto the canvas and keeps only the path extent', () => {
    const framing = crop([
      { frame: 0, rect: rect(0.2) },
      { frame: 30, rect: rect(0.5) },
    ]);
    const geometry = framingGeometry(framing, source, canvas);
    expect(geometry.scaledSize).toEqual({ width: 3414, height: 1920 });
    expect(geometry.crop.height).toBe(1920);
    expect(geometry.crop.x % 2).toBe(0);
    expect(geometry.crop.width % 2).toBe(0);
    expect(geometry.extent.x).toBeLessThanOrEqual(0.2);
    expect(geometry.extent.x + geometry.extent.width).toBeGreaterThanOrEqual(0.5 + W);
  });

  it('a still crop keeps one window (to the even pixel)', () => {
    const geometry = framingGeometry(crop([{ frame: 0, rect: rect(0.3) }]), source, canvas);
    expect(geometry.crop.width).toBeGreaterThanOrEqual(1080);
    expect(geometry.crop.width).toBeLessThanOrEqual(1082);
  });

  it('never scales a punch-in above the source resolution', () => {
    const big = { width: 3840, height: 2160 };
    const geometry = framingGeometry(crop([{ frame: 0, rect: rect(0.3, 0, W / 2, 0.5) }], 2), big, canvas);
    expect(geometry.scaledSize.width).toBeLessThanOrEqual(3840);
  });

  it('contains the whole frame for a blurred pad', () => {
    expect(blurPadGeometry(source, canvas)).toEqual({ width: 1080, height: 608 });
  });
});

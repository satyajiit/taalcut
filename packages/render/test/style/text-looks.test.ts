// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: a Style's text look is the whole of how a role's letters are drawn. It says every part (outline, shadow,
 * box, spacing) or says none, sizes the type by the face's own capitals, scales its pixels with the canvas, and
 * dresses every text of the role, whoever wrote the words.
 */
import { describe, expect, it } from 'vitest';
import { GRAPHICS_THRESHOLDS } from '../../src/qa/checks/graphics';
import { READABLE_CAP_PX, textLookSchema, type Style, type TextLook } from '@taalcut/core';
import { fontMetrics } from '../../src/captions/fonts';
import { textFaces } from '../../src/captions/text-faces';
import { lookDeclarations, textLookFor, textLookRules } from '../../src/style/text-looks';
import type { PlannedText } from '../../src/plan/types';

const HEAVY: TextLook = textLookSchema.parse({
  font: { family: 'montserrat', weight: 800 },
  colour: '#ffffff',
  background: null,
  stroke: { colour: '#000000', widthPx: 5 },
  shadow: null,
});
const SERIF: TextLook = textLookSchema.parse({
  font: { family: 'cormorantGaramond', weight: 400 },
  colour: '#f4d35e',
  background: null,
  stroke: null,
  shadow: { colour: '#000000', opacity: 0.6, blurPx: 12, offsetPx: 3 },
  letterSpacing: 0.02,
});

const text = (overrides: Partial<PlannedText> = {}): PlannedText => ({
  id: 't1',
  span: { start: 0, end: 30 },
  text: 'I hope',
  role: 'label',
  box: { x: 0.3, y: 0.5, width: 0.4, height: 0.05 },
  sizeRatio: 0.03,
  align: 'center',
  letterCase: 'mixed',
  background: 'outline',
  reveal: 'none',
  language: 'en',
  styleKey: 'label',
  origin: 'template',
  ...overrides,
});
const context = (textStyles: Style['textStyles'], width = 1080, height = 1920) => ({
  style: { textStyles } as Style,
  width,
  height,
});

describe('a Style’s text look (TXT1)', () => {
  it('states every part of the look, so the item’s own chrome never mixes in', () => {
    const { css, fonts } = textLookRules([text()], context({ label: HEAVY }));
    expect(fonts).toEqual(['montserrat']);
    expect(css).toHaveLength(1);
    const rule = css[0]!;
    expect(rule).toContain('font-weight: 800');
    expect(rule).toContain('color: #ffffff');
    // The outline is 5 px round the letters: a 10 px stroke painted under the fill.
    expect(rule).toContain('-webkit-text-stroke: 10px #000000; paint-order: stroke fill;');
    // What the look does not have is said as none, over the item's own `background: 'outline'`.
    expect(rule).toContain('text-shadow: none;');
    expect(rule).toContain('background-color: transparent; padding: 0; border-radius: 0;');
    expect(rule).toContain('letter-spacing: normal; font-variant-numeric: lining-nums;');
    expect(lookDeclarations(SERIF, 1)).toBe(
      'background-color: transparent; padding: 0; border-radius: 0; -webkit-text-stroke: 0; ' +
        'text-shadow: 0 3px 12px rgba(0, 0, 0, 0.6); letter-spacing: 0.02em; font-variant-numeric: lining-nums;',
    );
  });

  it('sizes the type by the face’s own capitals, and scales a look’s pixels with the canvas', () => {
    const sizeOf = (look: TextLook, height = 1920, width = 1080) =>
      Number(
        /font-size: (\d+)px/.exec(
          textLookRules([text()], context({ label: look }, width, height)).css[0]!,
        )![1],
      );
    // 0.03 of 1920 is a 57.6 px capital in either face; their ems differ.
    expect(sizeOf(HEAVY)).toBe(Math.round(57.6 / fontMetrics('montserrat').capHeight));
    expect(sizeOf(SERIF)).toBe(Math.round(57.6 / fontMetrics('cormorantGaramond').capHeight));
    expect(sizeOf(SERIF)).toBeGreaterThan(sizeOf(HEAVY));
    // A 540×960 preview draws the same look at half the pixels.
    expect(textLookRules([text()], context({ label: HEAVY }, 540, 960)).css[0]).toContain(
      '-webkit-text-stroke: 5px #000000',
    );
  });

  it('dresses every text of the role, whoever wrote the words; a role without a look keeps the default', () => {
    const styles = { label: HEAVY };
    expect(textLookFor(text({ origin: 'user' }), context(styles))).toEqual(HEAVY);
    expect(textLookFor(text({ origin: 'editor' }), context(styles))).toEqual(HEAVY);
    expect(textLookFor(text({ styleKey: 'title' }), context(styles))).toBeNull();
    expect(textLookFor(text(), { style: null })).toBeNull();
  });

  it('the faces offered to the designer are the bundled ones, each with its class and the weights it draws', () => {
    const faces = new Map(textFaces().map((face) => [face.id, face]));
    expect(faces.get('anton')).toEqual({
      id: 'anton',
      family: 'Anton',
      class: 'condensed',
      weights: [400, 400],
    });
    expect(faces.get('cormorantGaramond')).toMatchObject({ class: 'serif', weights: [300, 700] });
    expect(faces.get('courierPrime')).toMatchObject({ class: 'mono', weights: [400, 700] });
    expect(new Set([...faces.values()].map((face) => face.class))).toEqual(
      new Set(['sans', 'geometric', 'humanist', 'rounded', 'condensed', 'serif', 'script', 'mono']),
    );
  });

  it('the reading fact the text tools report is QA’s readable cap height for graphics: one number', () => {
    expect(READABLE_CAP_PX).toBe(GRAPHICS_THRESHOLDS.minCapHeightPx);
  });
});

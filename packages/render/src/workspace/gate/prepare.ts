// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition made ready to fold (HFW1): the file read into its parts (document.ts), its styles parsed and
 * checked under the workspace's rules (css-rules.ts, DSG1's parser), and its script lowered to motion data
 * (lower/). Pure and synchronous, so the compile can run it on a composition the gate already passed; the gate
 * (gate.ts) adds HyperFrames' own lint in front of it.
 */
import { CAPTION_FONTS } from '@taalcut/core';
import { parseCss, type CssRule } from '../html/css';
import type { CaptionFontId } from '../../types';
import { lowerScript, type LoweredMotion } from '../lower/lower';
import { cssFixHint, curatedFont, WORKSPACE_CSS } from './css-rules';
import { readComposition, type CompositionDocument, type CompositionProfile } from './document';
import { refusal, type Gated } from './finding';
import { ASSET_PATH } from './markup-rules';

export interface PreparedComposition {
  readonly doc: CompositionDocument;
  readonly rules: readonly CssRule[];
  readonly motion: LoweredMotion;
  /** The bundled fonts its styles name. */
  readonly fonts: readonly CaptionFontId[];
}

const isFont = (font: string): font is CaptionFontId => (CAPTION_FONTS as readonly string[]).includes(font);

export function prepareComposition(
  html: string,
  profile: CompositionProfile = {},
): Gated<PreparedComposition> {
  const read = readComposition(html, profile);
  if (!read.ok) return read;
  const doc = read.value;
  const cssVariables = new Set(
    doc.variables
      .filter((param) => param.type === 'colour' || param.type === 'number')
      .map((param) => param.name),
  );
  const css = parseCss(
    doc.style,
    { variables: cssVariables, attributes: new Set(), assetUrl: (path) => ASSET_PATH.test(path) },
    { ...WORKSPACE_CSS, maxRules: profile.maxCssRules ?? WORKSPACE_CSS.maxRules },
  );
  const lowered = lowerScript(doc.script, doc.root, profile.tweens, profile.cubicPaths);
  // Both run, so the model reads every finding of the style and the script at once.
  const findings = [
    ...(css.ok
      ? []
      : css.problems.map((problem) => refusal('gate.css', `the style has ${problem}`, cssFixHint(problem)))),
    ...(lowered.ok ? [] : lowered.findings),
  ];
  if (!css.ok || !lowered.ok) return { ok: false, findings };
  const fonts = new Set<CaptionFontId>();
  for (const rule of css.rules)
    for (const [property, value] of rule.declarations)
      if (property === 'font-family') {
        const found = curatedFont(value);
        if ('font' in found && isFont(found.font)) fonts.add(found.font);
      }
  return {
    ok: true,
    value: { doc, rules: css.rules, motion: lowered.motion, fonts: [...fonts] },
    warnings: [],
  };
}

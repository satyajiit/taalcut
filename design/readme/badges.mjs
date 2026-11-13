// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes the README's joke badges to .github/media/badges as SVG: two blocks, capitals, the app's four accents.
 * The words are set in fonts every system has, at a stated length, so the badge is the same width wherever
 * GitHub draws it.
 *
 *   node design/readme/badges.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = join(import.meta.dirname, '../../.github/media/badges');
mkdirSync(out, { recursive: true });

const INK = '#211a13';
const PAPER = '#fffdf9';
/** name, left words, right words, left colour, right colour, right text colour. */
const BADGES = [
  ['zero-posts', '1,284 clips', 'zero posts', INK, '#ffb331', INK],
  ['cuts-on-the-beat', 'cuts', 'on the beat', '#8f1f45', '#b02b57', PAPER],
  ['works-on-my-mac', 'works on', 'my mac', '#4a3396', '#6347b8', PAPER],
  ['beaver-approved', 'approved by', 'a beaver', '#034f4c', '#056965', PAPER],
];

const HEIGHT = 35;
const PAD = 14;
/** A capital's advance at 11 px bold with 1.4 px of tracking, close enough for every fallback font. */
const ADVANCE = 9.3;
const lengthOf = (words) => Math.round(words.length * ADVANCE);

function badge(left, right, leftFill, rightFill, rightInk) {
  const [a, b] = [left.toUpperCase(), right.toUpperCase()];
  const [aLength, bLength] = [lengthOf(a), lengthOf(b)];
  const aWidth = aLength + PAD * 2;
  const width = aWidth + bLength + PAD * 2;
  const text = (words, x, length, fill, weight) =>
    `<text x="${x}" y="22" fill="${fill}" font-weight="${weight}" textLength="${length}" lengthAdjust="spacing">${words}</text>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="${a}: ${b}">`,
    `  <title>${a}: ${b}</title>`,
    `  <rect width="${aWidth}" height="${HEIGHT}" fill="${leftFill}"/>`,
    `  <rect x="${aWidth}" width="${width - aWidth}" height="${HEIGHT}" fill="${rightFill}"/>`,
    `  <g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `    ${text(a, PAD, aLength, PAPER, 400)}`,
    `    ${text(b, aWidth + PAD, bLength, rightInk, 700)}`,
    `  </g>`,
    `</svg>`,
    '',
  ].join('\n');
}

for (const [name, left, right, leftFill, rightFill, rightInk] of BADGES) {
  writeFileSync(join(out, `${name}.svg`), badge(left, right, leftFill, rightFill, rightInk));
  process.stdout.write(`${name}.svg\n`);
}

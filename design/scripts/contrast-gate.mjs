// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// The contrast gate: every text-on-surface pair against its WCAG 2 ratio and its APCA Lc floor, the non-text
// pairs against 3:1, and the dark layers against their separation floors. The build fails on any miss.
import { apca, css, hex, inGamut, oklchToLinear, ratio } from './colour-math.mjs';

// APCA Lc floors (APCA-W3 0.1.9), on every surface text sits on, hover, pressed and selected included, in both
// themes. ink is body text (75); ink-2 is secondary content people read (65); ink-3 is meta, never a sentence
// someone needs (50). An accent's -strong text is a chip's word or a short label (60), and so are the words on the
// two fills the kit writes on, primary and danger (60).
export const APCA_FLOORS = { ink: 75, 'ink-2': 65, 'ink-3': 50, strong: 60, fill: 60 };

// Dark separation floors, in OKLCH lightness points: [upper, lower, min]. WCAG ratios compress at the dark end (its
// 0.05 flare term makes every dark pair look like 1.1:1), so layers are held apart by perceptual lightness instead.
// Light separates by shadow and hairline, so its steps are reported, not held.
export const SEPARATION = [
  ['canvas', 'sidebar', 4],
  ['canvas', 'sunken', 3.5],
  ['raised', 'canvas', 5],
  ['raised', 'well', 3],
  ['panel', 'canvas', 4],
  ['bubble', 'canvas', 6],
  ['overlay', 'raised', 3],
  ['control', 'canvas', 6],
  ['hover', 'overlay', 3],
  ['pressed', 'hover', 3],
  ['sidebar-hover', 'sidebar', 4],
  ['raised', 'sidebar-hover', 4],
  ['rule-subtle', 'hover', 3.5],
  ['rule', 'raised', 12],
  ['tooltip', 'overlay', 6],
  ['chip', 'raised', 4.5],
  ['chip', 'panel', 5],
  ['thumb', 'sunken', 30],
];

// Surfaces text rests on, and the states a row or a control takes on top of them. `selected` is marigold-soft.
export const RESTING = [
  'canvas',
  'sidebar',
  'sunken',
  'well',
  'panel',
  'bubble',
  'chip',
  'raised',
  'overlay',
  'control',
];
export const STATES = [
  'hover',
  'pressed',
  'selected',
  'sidebar-hover',
  'sidebar-pressed',
  'control-hover',
  'control-pressed',
];
// Where an accent's -strong text and icons appear outside its own wash: a chip's word, a menu item, an area's mark.
const STRONG_ON = ['canvas', 'sidebar', 'sunken', 'panel', 'raised', 'overlay', 'hover'];
// The fills the kit writes words on (the primary and the destructive button); the others carry shapes and marks.
const LABELLED_FILLS = ['marigold', 'danger'];

export function runGate(src, colours, themes) {
  const { body, strongText, ui } = src.floors;
  const lcFloor = APCA_FLOORS;
  const checks = [];
  const at = (theme, name) =>
    name === 'selected' ? colours[theme][`${src.roles.primary}-soft`] : colours[theme][name];
  function check(theme, fg, bg, min, minLc, note = '') {
    const r = ratio(at(theme, fg), at(theme, bg));
    const lc = Math.abs(apca(at(theme, fg), at(theme, bg)));
    const pass = r >= min && (minLc === null || lc >= minLc);
    checks.push({ theme, fg, bg, ratio: r, lc, min, minLc, pass, note });
  }

  const hues = [...Object.keys(src.accents), ...Object.keys(src.kinds), ...Object.keys(src.status)];
  for (const t of themes) {
    for (const s of [...RESTING, ...STATES]) {
      const resting = RESTING.includes(s);
      check(t, 'ink', s, strongText, lcFloor.ink, resting ? 'body text' : 'body text on a state');
      check(t, 'ink-2', s, strongText, lcFloor['ink-2'], 'secondary text');
      check(t, 'ink-3', s, body, lcFloor['ink-3'], 'meta');
      check(t, 'focus', s, ui, null, 'focus ring');
      if (resting) check(t, 'rule-strong', s, ui, null, 'input borders');
    }
    check(t, 'on-inverse', 'inverse', strongText, lcFloor.ink, 'text on an ink fill');
    check(t, 'inverse', 'canvas', ui, null, 'an ink fill as a shape');
    check(t, 'inverse', 'raised', ui, null, 'an ink fill as a shape');
    check(t, 'on-tooltip', 'tooltip', strongText, lcFloor.ink, 'tooltip text');
    check(t, 'on-thumb', 'thumb', ui, null, "a glyph on a switch's knob");
    check(t, 'viewer-ink', 'viewer', strongText, lcFloor.ink, 'text on the viewer');
    check(t, 'viewer-ink-2', 'viewer', strongText, lcFloor['ink-2'], 'secondary text on the viewer');
    for (const a of hues) {
      for (const s of STRONG_ON)
        check(t, `${a}-strong`, s, body, lcFloor.strong, s === 'canvas' ? 'accent text and markers' : '');
      check(t, `${a}-strong`, `${a}-soft`, body, lcFloor.strong, 'text on its wash');
      check(t, 'ink', `${a}-soft`, strongText, lcFloor.ink, 'ink on the wash');
      const labelled = LABELLED_FILLS.includes(a);
      check(
        t,
        `${a}-ink`,
        a,
        body,
        labelled ? lcFloor.fill : null,
        labelled ? 'a button label on the fill' : 'text on the fill',
      );
      check(
        t,
        `${a}-strong-ink`,
        `${a}-strong`,
        body,
        labelled ? lcFloor.fill : null,
        'text on the strong fill (a pressed or hovered fill)',
      );
      if (t === 'dark') check(t, a, 'canvas', ui, null, 'fill as a shape');
    }
    for (const k of ['close', 'minimize', 'zoom'])
      check(t, `window-${k}-ink`, `window-${k}`, ui, null, 'traffic-control glyph on its disc');
    for (const k of Object.keys(src.logo[t]))
      check(t, `logo-${k}`, 'canvas', k === 'ink' ? strongText : body, null, 'logo on the canvas');
  }

  // Every accent's wash has to read as a chip on a card, as well as on the canvas.
  const softOnCard = hues.map((a) => [`${a}-soft`, 'raised', 3]);
  const separations = [];
  for (const t of themes) {
    for (const [upper, lower, min] of [...SEPARATION, ...softOnCard]) {
      const dL = at(t, upper)[0] - at(t, lower)[0];
      const gated = t === 'dark';
      separations.push({
        theme: t,
        upper,
        lower,
        dL,
        min,
        ratio: ratio(at(t, upper), at(t, lower)),
        gated,
        pass: !gated || dL >= min,
      });
    }
  }

  const gamut = [];
  for (const t of themes)
    for (const [k, v] of Object.entries(colours[t]))
      if (!inGamut(oklchToLinear(v))) gamut.push(`${t}:${k} ${css(v)}`);
  return { checks, separations, gamut };
}

const title = (t) => t[0].toUpperCase() + t.slice(1);

export function gateReport({ src, colours, themes, checks, separations, gamut, SPDX, COPYRIGHT }) {
  const fails = checks.filter((c) => !c.pass);
  const sepFails = separations.filter((s) => !s.pass);
  const row = (c) =>
    `| ${c.fg} | ${c.bg} | ${c.ratio.toFixed(2)} | ${c.min} | ${c.lc.toFixed(1)} | ${c.minLc ?? '·'} | ${c.pass ? 'pass' : '**FAIL**'} | ${c.note} |`;
  const sepRow = (s) =>
    `| ${s.upper} | ${s.lower} | ${s.dL.toFixed(1)} | ${s.gated ? s.min : '·'} | ${s.ratio.toFixed(2)} | ${s.gated ? (s.pass ? 'pass' : '**FAIL**') : 'reported'} |`;
  const swatchRows = (t) =>
    Object.entries(colours[t])
      .map(([k, v]) => `| \`--color-${k}\` | \`${css(v)}\` | \`${hex(v)}\` |`)
      .join('\n');
  const { body, strongText, ui } = src.floors;
  const lc = APCA_FLOORS;
  return `<!-- ${SPDX} -->
<!-- ${COPYRIGHT} -->

# Contrast report

Generated by \`design/scripts/build-tokens.mjs\` from \`design/tokens/source.mjs\`. Do not edit by hand.

**${checks.length - fails.length} of ${checks.length} contrast checks pass** and **${separations.filter((s) => s.gated).length - sepFails.length} of ${separations.filter((s) => s.gated).length} dark separation floors hold**. ${gamut.length ? `**${gamut.length} colours are outside sRGB:** ${gamut.join(', ')}.` : 'Every colour is inside the sRGB gamut, so it looks the same on every display.'}

Each pair must clear both columns.
- **WCAG 2 ratio:** ${strongText}:1 for ink and ink-2, ${body}:1 for ink-3 and accent text, ${ui}:1 for borders, focus rings and shapes.
- **APCA Lc** (APCA-W3 0.1.9, on the 8-bit colours below): ink ${lc.ink}, ink-2 ${lc['ink-2']}, ink-3 ${lc['ink-3']}, an accent's -strong text ${lc.strong}, the words on the primary and danger fills ${lc.fill}. A dot means the pair is not text, or is text the kit never sets in sentences, and is held by its ratio alone.
- Text is checked on every surface it sits on: ${RESTING.join(', ')}, and the states ${STATES.join(', ')} (selected is marigold-soft).

${themes
  .map(
    (t) => `## ${title(t)} theme

| Foreground | Background | Ratio | Floor | APCA Lc | Lc floor | Result | Use |
| --- | --- | --- | --- | --- | --- | --- | --- |
${checks
  .filter((c) => c.theme === t)
  .map(row)
  .join('\n')}
`,
  )
  .join('\n')}
## Separation

How far apart the layers sit, in OKLCH lightness points (ΔL), with the WCAG ratio beside it for reference. Dark is held to the floors: WCAG ratios compress at the dark end, so a step people can see reads as 1.1:1 there. Light separates by shadow and hairline, so its steps are reported; a negative ΔL there means the role sits below its partner, as light's wells, panels and states do.

${themes
  .map(
    (t) => `### ${title(t)}

| Upper | Lower | ΔL | Floor | Ratio | Result |
| --- | --- | --- | --- | --- | --- |
${separations
  .filter((s) => s.theme === t)
  .map(sepRow)
  .join('\n')}
`,
  )
  .join('\n')}
## Resolved values

${themes
  .map(
    (t) => `### ${title(t)}

| Token | OKLCH | Hex (sRGB) |
| --- | --- | --- |
${swatchRows(t)}
`,
  )
  .join('\n')}`;
}

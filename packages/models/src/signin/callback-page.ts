// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The page the system browser shows when a sign-in comes back to Taalcut's loopback server (UX3-AGT): the
 * Taalcut lockup drawn inline, the app's colours in light and dark (`prefers-color-scheme`), one status, a
 * heading and one sentence that says what to do next. DESIGN.md's message pages: plain text on the canvas, no
 * card, no marigold fill; the four-colour lockup only for the brand moment of signing in.
 *
 * Static by construction: every word comes from the catalogue by key and nothing from the request (never the
 * code, the state or a token). No script, no request leaves the page, and its one stylesheet is pinned by hash
 * in the Content-Security-Policy, so not even an inline style attribute would apply.
 */
import { createHash } from 'node:crypto';

/** How a sign-in ended, as the browser that came back is told. */
export const CALLBACK_OUTCOMES = [
  'signed_in',
  'denied',
  'state_mismatch',
  'timeout',
  'exchange_failed',
  'failed',
] as const;
export type CallbackOutcome = (typeof CALLBACK_OUTCOMES)[number];

export type Translate = (key: string) => string;

/** The catalogue keys a page reads: models.signin.callback.<outcome>.{title,body}, plus the shared ones. */
export function callbackPageKeys(outcome: CallbackOutcome): readonly string[] {
  return [
    `models.signin.callback.${outcome}.title`,
    `models.signin.callback.${outcome}.body`,
    outcome === 'signed_in' ? 'models.signin.callback.status.done' : 'models.signin.callback.status.failed',
    'models.signin.callback.title',
    'models.signin.callback.close',
  ];
}

// The app's tokens (design/tokens/tokens.css): canvas, ink, ink-2, ink-3, rule-subtle (--rule here), the status strongs and
// the logo's colours, which are the strong accents on light and the fills on dark.
const STYLE = `:root{color-scheme:light dark;--canvas:oklch(97.5% 0.008 75);--ink:oklch(21% 0.014 55);--ink-2:oklch(38% 0.014 58);--ink-3:oklch(49% 0.014 60);--rule:oklch(92% 0.01 70);--ok:oklch(46% 0.11 150);--bad:oklch(50% 0.18 28);--l1:oklch(53% 0.14 50);--l2:oklch(51% 0.17 6);--l3:oklch(49% 0.17 290);--l4:oklch(47% 0.08 190);--li:oklch(21% 0.014 55)}
@media (prefers-color-scheme:dark){:root{--canvas:oklch(18% 0.01 65);--ink:oklch(94.5% 0.008 78);--ink-2:oklch(81% 0.01 72);--ink-3:oklch(67% 0.011 68);--rule:oklch(24.8% 0.01 65);--ok:oklch(80% 0.13 150);--bad:oklch(75% 0.14 28);--l1:oklch(80% 0.15 70);--l2:oklch(70% 0.17 5);--l3:oklch(70% 0.15 290);--l4:oklch(74% 0.115 185);--li:oklch(94.5% 0.008 78)}}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{margin:0;min-height:100vh;background:var(--canvas);color:var(--ink);font:400 15px/1.55 "Onest","Onest Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-synthesis:none;-webkit-font-smoothing:antialiased}
main{max-width:34rem;margin:0 auto;padding:clamp(48px,16vh,160px) 24px 48px}
.lockup{display:block;height:32px;width:auto}
.l1{fill:var(--l1)}.l2{fill:var(--l2)}.l3{fill:var(--l3)}.l4{fill:var(--l4)}.li{fill:var(--li)}
.status{display:flex;align-items:center;gap:8px;margin:48px 0 12px;font-size:13px;font-weight:500;color:var(--ink-2)}
.status svg{width:16px;height:16px;flex:none;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.done .status svg{stroke:var(--ok)}.failed .status svg{stroke:var(--bad)}
h1{margin:0;font-size:29px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;text-wrap:balance}
p.body{margin:12px 0 0;max-width:60ch;font-size:17px;color:var(--ink-2)}
p.close{margin:32px 0 0;padding-top:16px;border-top:1px solid var(--rule);font-size:13px;color:var(--ink-3)}
@media (prefers-contrast:more){:root{--ink-2:var(--ink);--ink-3:var(--ink)}}`;

const STYLE_HASH = createHash('sha256').update(STYLE, 'utf8').digest('base64');

/** The page's Content-Security-Policy: nothing loads, nothing runs, and only its own stylesheet applies. */
export const CALLBACK_PAGE_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${STYLE_HASH}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// The horizontal lockup (design/logo/kit/svg/taalcut-horizontal-*.svg): the Avartan symbol's four arcs
// clockwise from the top, then the drawn wordmark. Never set in a font as a stand-in.
const ARCS = [
  'M137.45 16.36A112 112 0 0 1 233.95 90.41L175.59 106.05A52 52 0 0 0 137.45 76.78Z',
  'M238.61 107.8A112 112 0 0 1 137.45 239.64L137.45 201.45A74 74 0 0 0 201.72 117.68Z',
  'M119.45 239.64A112 112 0 0 1 22.94 165.59L42.34 160.39A92 92 0 0 0 119.45 219.56Z',
  'M18.28 148.2A112 112 0 0 1 119.45 16.36L119.45 54.55A74 74 0 0 0 55.17 138.32Z',
];
const WORDMARK =
  'M324.07 60.8L343.49 60.8L343.49 83.2L362.9 83.2L362.9 100.37L343.49 100.37L343.49 172.8L324.07 172.8L324.07 100.37L307.65 100.37L307.65 83.2L324.07 83.2ZM448.02 83.2L467.43 83.2L467.43 172.8L448.02 172.8L448.02 166.07A47.04 47.04 0 1 1 448.02 89.93ZM448.02 128A27.63 27.63 0 1 0 392.77 128A27.63 27.63 0 1 0 448.02 128ZM557.03 83.2L576.45 83.2L576.45 172.8L557.03 172.8L557.03 166.07A47.04 47.04 0 1 1 557.03 89.93ZM557.03 128A27.63 27.63 0 1 0 501.78 128A27.63 27.63 0 1 0 557.03 128ZM592.87 41.39L612.29 41.39L612.29 172.8L592.87 172.8ZM709.02 161.26A47.04 47.04 0 1 1 709.02 94.74L695.29 108.46A27.63 27.63 0 1 0 695.29 147.54ZM731.75 83.2L751.17 83.2L751.17 130.24A25.39 25.39 0 0 0 776.55 155.63A25.39 25.39 0 0 0 801.94 130.24L801.94 83.2L821.35 83.2L821.35 172.8L801.94 172.8L801.94 167.15A44.8 44.8 0 0 1 731.75 130.24ZM849.73 60.8L869.14 60.8L869.14 83.2L888.55 83.2L888.55 100.37L869.14 100.37L869.14 172.8L849.73 172.8L849.73 100.37L833.3 100.37L833.3 83.2L849.73 83.2Z';

/** Four colours for the brand moment (signed in); two (the first beat and ink) everywhere else. */
function lockup(fourColour: boolean): string {
  const arcs = ARCS.map((d, index) => {
    const tone = index === 0 || fourColour ? `l${index + 1}` : 'li';
    return `<path class="${tone}" fill-rule="evenodd" d="${d}"/>`;
  }).join('');
  return `<svg class="lockup" viewBox="0 0 905 256" role="img" aria-label="Taalcut" xmlns="http://www.w3.org/2000/svg">${arcs}<path class="li" fill-rule="evenodd" d="${WORDMARK}"/></svg>`;
}

// Lucide's circle-check and circle-alert (ISC), drawn as strokes.
const DONE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const FAILED_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

/** The whole page for an outcome, in the catalogue's words; `lang` is the catalogue's language. */
export function callbackPage(t: Translate, outcome: CallbackOutcome, lang = 'en'): string {
  const done = outcome === 'signed_in';
  const [titleKey, bodyKey, statusKey, appKey, closeKey] = callbackPageKeys(outcome) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const heading = escapeHtml(t(titleKey));
  return `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex">
<title>${heading} · ${escapeHtml(t(appKey))}</title>
<style>${STYLE}</style>
</head><body class="${done ? 'done' : 'failed'}" data-outcome="${outcome}"><main>
${lockup(done)}
<p class="status" role="status">${done ? DONE_ICON : FAILED_ICON}<span>${escapeHtml(t(statusKey))}</span></p>
<h1>${heading}</h1>
<p class="body">${escapeHtml(t(bodyKey))}</p>
<p class="close">${escapeHtml(t(closeKey))}</p>
</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

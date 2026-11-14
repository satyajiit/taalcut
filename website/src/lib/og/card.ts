// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { createElement as h, type CSSProperties, type ReactElement } from 'react';
import { page } from '#content/pages';
import { SITE } from '#content/site';
import { tokenHex, worldHex } from './palette';

/**
 * The social card every route's opengraph-image draws at build (1200×630, PNG), in the Remix Vernacular world: the
 * white ground, the four-colour lockup for light backgrounds, the page's title in Onest heavy and its description,
 * and on the right the saved reel in its 28 px frame (the owner's own footage) with the template's segment bar and its
 * rose music-beat ticks on top, and one tilted sticker on its edge carrying the page's fact. Colours come from the
 * tokens (palette.ts), the lockup from design/logo/kit, the poster from reel-poster.jpg beside this file (Satori reads
 * no WebP); nothing is typed as a colour.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

const REPO = join(process.cwd(), '..');
const HERE = join(process.cwd(), 'src/lib/og');

type StickerField = 'pink' | 'violet' | 'teal' | 'marigold' | 'sky' | 'lime' | 'paper';

/** Each page's sticker: one short fact, in a sticker field. Words follow the ledger like any on the site. */
const STICKERS: Readonly<Record<string, readonly [text: string, field: StickerField]>> = {
  '/': ['Your version', 'violet'],
  '/features/': ['Read, pick, make', 'pink'],
  '/features/reel-breakdown/': ['Cuts and music beats', 'pink'],
  '/features/auto-pick/': ['From your camera roll', 'teal'],
  '/features/templates/': ['Fill it again', 'lime'],
  '/features/agent/': ['Approve once', 'violet'],
  '/features/editor/': ['Your timeline', 'sky'],
  '/features/import/': ['Phone over Wi-Fi', 'teal'],
  '/features/shorts/': ['One long video in', 'marigold'],
  '/features/instagram-edits/': ['Hook drops marked', 'pink'],
  '/features/launch-videos/': ['From your sources', 'violet'],
  '/features/product-videos/': ['A video per feature', 'lime'],
  '/features/plugins/': ['You choose what it may do', 'sky'],
  '/ai/': ['Your ChatGPT plan', 'paper'],
  '/download/': ['Free for Mac', 'sky'],
  '/premium/': ['Set up for you', 'lime'],
  '/premium/thanks/': ['Your order', 'paper'],
  '/waitlist/': ['Download for Mac', 'marigold'],
  '/faq/': ['Straight answers', 'lime'],
  '/about/': [SITE.pronunciation, 'marigold'],
  '/press/': ['Logos and Kaatu', 'sky'],
  '/contact/': ['Write to us', 'pink'],
  '/privacy/': ['What we keep', 'teal'],
  '/terms/': ['Plain words', 'paper'],
  '/beta-terms/': ['Three lines', 'lime'],
};

/** The template's parts over its thirteen slots (the footer's motif), and how many have filled. */
const PARTS = [
  { label: 'Hook', slots: 3 },
  { label: 'Build', slots: 3 },
  { label: 'Peak', slots: 4 },
  { label: 'Outro', slots: 3 },
] as const;
const FILLED = 8;
const BEATS = 23;

interface OgFont {
  readonly name: string;
  readonly data: Buffer;
  readonly weight: 500 | 700 | 800;
  readonly style: 'normal';
}

interface Loaded {
  readonly c: Readonly<Record<string, string>>;
  readonly lockup: string;
  readonly poster: string;
  readonly fonts: OgFont[];
}

let cached: Loaded | undefined;

/**
 * Onest for the card, from @fontsource/onest's static cuts: Satori reads TTF, OTF and WOFF, and the site's
 * @fontsource-variable/onest ships woff2 only. The build fails if they're missing, so a card never falls back to
 * next/og's built-in face.
 */
function onest(): OgFont[] {
  const dir = join(process.cwd(), 'node_modules/@fontsource/onest/files');
  return ([500, 700, 800] as const).map((weight) => {
    const file = join(dir, `onest-latin-${weight}-normal.woff`);
    if (!existsSync(file)) throw new Error(`The social cards need ${file} (@fontsource/onest)`);
    return { name: 'Onest', data: readFileSync(file), weight, style: 'normal' as const };
  });
}

function load(): Loaded {
  if (cached) return cached;
  const names = ['canvas', 'ink', 'ink-2', 'ink-3', 'rule', 'rose', 'sticker-cut', 'sticker-shadow'] as const;
  const fields = ['pink', 'violet', 'teal', 'marigold', 'sky', 'lime', 'paper'] as const;
  const c: Record<string, string> = Object.fromEntries(names.filter((n) => n !== 'sticker-shadow').map((n) => [n, worldHex(n)]));
  for (const f of fields) {
    c[`sticker-${f}`] = worldHex(`sticker-${f}`);
    c[`sticker-${f}-ink`] = worldHex(`sticker-${f}-ink`);
  }
  c.viewer = tokenHex('light', 'viewer');
  c['viewer-ink'] = tokenHex('light', 'viewer-ink');
  const svg = readFileSync(join(REPO, 'design/logo/kit/svg/taalcut-horizontal-four-colour-light.svg'));
  cached = {
    c,
    lockup: `data:image/svg+xml;base64,${svg.toString('base64')}`,
    poster: `data:image/jpeg;base64,${readFileSync(join(HERE, 'reel-poster.jpg')).toString('base64')}`,
    fonts: onest(),
  };
  return cached;
}

const flex = (style: CSSProperties): CSSProperties => ({ display: 'flex', ...style });

/** The template's segment bar over the reel: part names, thirteen segments, the first ones filled, rose beat ticks. */
function segmentBar(c: Loaded['c'], width: number): ReactElement {
  const gap = 4;
  const total = PARTS.reduce((n, p) => n + p.slots, 0);
  const seg = (width - gap * (total - 1)) / total;
  let index = 0;
  const parts = PARTS.map((p) =>
    h(
      'div',
      { key: p.label, style: flex({ flexDirection: 'column', gap: 6, width: p.slots * seg + (p.slots - 1) * gap }) },
      h('div', { style: { fontSize: 15, fontWeight: 700, color: c['viewer-ink'], letterSpacing: -0.2 } }, p.label),
      h(
        'div',
        { style: flex({ gap }) },
        ...Array.from({ length: p.slots }, () => {
          const filled = index++ < FILLED;
          return h('div', { key: index, style: { width: seg, height: 7, borderRadius: 4, background: c['viewer-ink'], opacity: filled ? 1 : 0.4 } });
        }),
      ),
    ),
  );
  const ticks = Array.from({ length: BEATS }, (_, i) =>
    h('div', {
      key: `b${i}`,
      style: { position: 'absolute', left: Math.round(((i + 0.5) / BEATS) * width) - 1, top: 0, width: 3, height: i % 4 === 0 ? 11 : 7, borderRadius: 2, background: c.rose },
    }),
  );
  return h(
    'div',
    { style: flex({ flexDirection: 'column', gap: 7, width }) },
    h('div', { style: flex({ gap }) }, ...parts),
    h('div', { style: flex({ position: 'relative', width, height: 12 }) }, ...ticks),
  );
}

/** The saved reel in its frame, the bar on top under a scrim. */
function reel(l: Loaded, width: number, height: number): ReactElement {
  const { c } = l;
  return h(
    'div',
    { style: flex({ position: 'relative', width, height, borderRadius: 28, overflow: 'hidden', background: c.viewer, boxShadow: `0 24px 48px -16px ${c.ink}55` }) },
    h('img', { src: l.poster, width, height, style: { position: 'absolute', left: 0, top: 0, width, height, objectFit: 'cover' } }),
    h('div', { style: { position: 'absolute', left: 0, top: 0, width, height: 170, backgroundImage: `linear-gradient(to bottom, ${c.viewer}e0, ${c.viewer}00)` } }),
    h('div', { style: flex({ position: 'absolute', left: 16, top: 16 }) }, segmentBar(c, width - 32)),
  );
}

function sticker(c: Loaded['c'], text: string, field: StickerField): ReactElement {
  return h(
    'div',
    {
      style: flex({
        alignItems: 'center',
        padding: '14px 26px',
        borderRadius: 999,
        fontSize: 30,
        fontWeight: 800,
        letterSpacing: -0.6,
        background: c[`sticker-${field}`],
        color: c[`sticker-${field}-ink`],
        border: `5px solid ${c['sticker-cut']}`,
        boxShadow: `0 10px 22px -6px ${c.ink}50`,
        transform: 'rotate(-6deg)',
      }),
    },
    text,
  );
}

/** The card for a page in PAGES, by its path. */
export function ogImage(path: string): ImageResponse {
  const l = load();
  const { c, lockup, fonts } = l;
  const entry = page(path);
  const [text, field] = STICKERS[path] ?? ['Taalcut', 'paper'];
  const title = entry.title;
  const pad = 72;
  const frame = { width: 300, height: 534 };
  return new ImageResponse(
    h(
      'div',
      { style: flex({ position: 'relative', width: '100%', height: '100%', background: c.canvas, color: c.ink, fontFamily: 'Onest' }) },
      h(
        'div',
        { style: flex({ flexDirection: 'column', justifyContent: 'space-between', width: 720, padding: `60px 0 56px ${pad}px` }) },
        h('img', { src: lockup, width: 226, height: 64, alt: '' }),
        h(
          'div',
          { style: flex({ flexDirection: 'column', gap: 22 }) },
          h('div', { style: { fontSize: title.length > 34 ? 60 : 78, fontWeight: 800, lineHeight: 1.0, letterSpacing: title.length > 34 ? -2.2 : -3, maxWidth: 600, textWrap: 'balance' } }, title),
          h('div', { style: { fontSize: 26, fontWeight: 500, lineHeight: 1.38, color: c['ink-2'], maxWidth: 560 } }, entry.description),
        ),
        h('div', { style: { fontSize: 22, fontWeight: 700, color: c['ink-3'] } }, new URL(SITE.origin).host),
      ),
      h('div', { style: flex({ position: 'absolute', right: pad + 24, top: 48 }) }, reel(l, frame.width, frame.height)),
      // The sticker hangs off the frame's lower left edge, clear of the words (they stop at 72 + 600 px).
      h('div', { style: flex({ position: 'absolute', left: OG_SIZE.width - pad - 24 - frame.width - 130, top: 444 }) }, sticker(c, text, field)),
    ),
    { ...OG_SIZE, fonts },
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { VIDEO_SIZES, type CoverSettings } from '@taalcut/core';
import { CAPTION_FONT_FILES } from '../captions/fonts';
import type { CompositionBundle, BundleLink } from '../compile/composition';
import { escapeHtml, jsonForScript } from '../compile/html';
import { fontFaces } from '../compile/css';
import { TC_RUNTIME_JS, TC_RUNTIME_VERSION } from '../compile/runtime';
import { gsapBundlePath, gsapDistDir, GSAP_LOCK } from '../motion/gsap-files';
import { coverStyles } from './cover-style';
import { authoredCover, COVER_DESIGN_FIT_JS } from './cover-design';

/** One deterministic composition for the studio preview and the exported image. User text is never markup. */
export function coverBundle(
  cover: CoverSettings,
  image: string | null,
  fontsDir: string,
): Pick<CompositionBundle, 'files' | 'links'> {
  const { width, height } = VIDEO_SIZES[cover.aspect];
  const fonts = new Set(['notoSans', 'notoSansDevanagari', 'notoColorEmoji']);
  for (const layer of cover.design?.layers ?? []) if (layer.kind === 'text') fonts.add(layer.font);
  const faceEntries = CAPTION_FONT_FILES.filter((font) => fonts.has(font.fontId));
  const faces = faceEntries.map((font) => ({ ...font, fontId: font.fontId }));
  const links: Record<string, BundleLink> = image ? { 'backdrop.jpg': { source: image, key: image } } : {};
  for (const face of faceEntries)
    links[`fonts/${face.file}`] = { source: join(fontsDir, face.file), key: face.sha256 };
  links[gsapBundlePath('gsap.min.js')] = {
    source: join(gsapDistDir(), 'gsap.min.js'),
    key: GSAP_LOCK['gsap.min.js'].sha256,
  };
  const authored = cover.design ? authoredCover(cover.design, width, height, Boolean(image)) : undefined;
  const content = authored?.html ?? presetContent(cover);
  const css = `${fontFaces(faces).join('\n')}\n${authored?.css ?? coverStyles(cover)}`;
  const backdrop = image ? '<img class="backdrop" src="backdrop.jpg" alt="">' : '';
  const motion = { tweens: [], splits: [] };
  return {
    links,
    files: {
      'index.html': `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="cover.css"></head><body><div id="root" data-archetype="${cover.archetype}" data-composition-id="taalcut" data-start="0" data-width="${width}" data-height="${height}" data-fps="30" data-duration="1">${backdrop}${content}</div><script id="tc-data" type="application/json">${jsonForScript({ version: TC_RUNTIME_VERSION, duration: 1, motion })}</script><script src="${gsapBundlePath('gsap.min.js')}"></script><script src="tc.js"></script>${authored ? `<script>${COVER_DESIGN_FIT_JS}</script>` : ''}</body></html>`,
      'cover.css': css,
      'tc.js': TC_RUNTIME_JS,
    },
  };
}

function presetContent(cover: CoverSettings): string {
  const channel = cover.channel?.show
    ? [cover.channel.name.trim(), cover.channel.handle.trim()].filter(Boolean).join(' · ')
    : '';
  const tag = (cls: string, text: string) => (text ? `<div class="${cls}">${escapeHtml(text)}</div>` : '');
  const callout = cover.archetype === 'stat-callout';
  const badges = `${tag('channel', channel)}${callout ? '' : tag('stat', cover.statBadge)}`;
  const hasText = cover.hookText || cover.kickerText || cover.statBadge || channel;
  return hasText
    ? `<div class="scrim"></div><div class="safe">${badges ? `<div class="badges">${badges}</div>` : ''}<div class="body"><div class="words">${callout ? tag('callout', cover.statBadge) : ''}${tag('kicker', cover.kickerText)}${tag('hook', cover.hookText)}</div></div></div>`
    : '';
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { VIDEO_SIZES, type CoverSettings } from '@taalcut/core';

const PALETTES = {
  'golden-hour': ['#edb839', '#171717'],
  midnight: ['#ab8be8', '#15151a'],
  newsprint: ['#f3efe5', '#242323'],
  studio: ['#ef9c8e', '#292627'],
  terminal: ['#75c4b4', '#151c1b'],
  'brand-kit': ['#e4a0af', '#292329'],
} as const;

/** Typography, crop-safe placement and distinct cover structures for preview and JPEG. */
export function coverStyles(cover: CoverSettings): string {
  const { width, height } = VIDEO_SIZES[cover.aspect];
  const unit = Math.min(width, height) / 1080;
  const [accent, ink] = PALETTES[cover.theme];
  const channel = cover.channel?.show && (cover.channel.name || cover.channel.handle);
  // Portrait words survive the centred square crop as well as the taller feed crop.
  const safeY = cover.aspect === '9:16' ? [25, 25] : cover.aspect === '4:5' ? [14, 14] : [8, 12];
  const safeRight = cover.aspect === '9:16' ? 18 : 15;
  const justify =
    cover.textAlign === 'top-left' ? 'flex-start' : cover.textAlign === 'left' ? 'center' : 'flex-end';
  const hookScale = cover.hookText.length > 32 ? 0.84 : 1;
  return `    *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
    #root{--color-accent:${accent};--color-ink:${ink};--color-paper:#fff;--color-scrim:rgba(0,0,0,.72);--font-display:'Noto Sans','Noto Sans Devanagari','Noto Color Emoji',sans-serif;position:relative;width:${width}px;height:${height}px;background:var(--color-ink);color:var(--color-paper);font-family:var(--font-display)}
    img{position:absolute;width:100%;height:100%;object-fit:cover}
    .scrim{position:absolute;inset:0;background:linear-gradient(90deg,var(--color-scrim),transparent);display:${cover.hookText || cover.statBadge || channel ? 'block' : 'none'}}
    .safe{position:absolute;top:${safeY[0]}%;bottom:${safeY[1]}%;left:7%;right:${safeRight}%;display:flex;flex-direction:column;gap:${24 * unit}px}
    .badges{display:flex;align-items:flex-start;justify-content:space-between;gap:${20 * unit}px}
    .body{display:flex;flex:1;min-height:0;flex-direction:column;justify-content:${justify}}
    .words{width:100%;max-width:100%;overflow-wrap:anywhere}
    .hook{font-size:${88 * unit * hookScale}px;line-height:1.12;font-style:normal;font-weight:800;overflow-wrap:anywhere;text-wrap:balance}
    .kicker{display:table;max-width:100%;background:var(--color-accent);color:var(--color-ink);font-size:${28 * unit}px;font-weight:800;padding:${8 * unit}px ${14 * unit}px;margin-bottom:${20 * unit}px}
    .channel,.stat{font-size:${24 * unit}px;font-weight:700;padding:${10 * unit}px ${14 * unit}px;max-width:65%;overflow-wrap:anywhere}
    .channel{background:var(--color-ink);color:var(--color-paper)}.stat{background:var(--color-accent);color:var(--color-ink)}
    .callout{font-size:${100 * unit}px;font-weight:800;line-height:1;max-width:100%;color:var(--color-accent);margin-bottom:${20 * unit}px;overflow-wrap:anywhere}
    [data-archetype="editorial-specimen"] .words{border-left:${6 * unit}px solid var(--color-accent);padding-left:${24 * unit}px;width:94%}
    [data-archetype="brutal-slab"] .words{background:var(--color-ink);padding:${28 * unit}px}
    [data-archetype="brutal-slab"] .hook{font-size:${94 * unit * hookScale}px;letter-spacing:-.035em}
    [data-archetype="atmospheric-cinema"] .words{width:82%}
    [data-archetype="atmospheric-cinema"] .hook{font-size:${76 * unit * hookScale}px;letter-spacing:.015em;font-weight:600}
    [data-archetype="minimal-frame"] .words{width:86%;border:${2 * unit}px solid var(--color-paper);padding:${28 * unit}px}
    [data-archetype="minimal-frame"] .hook{font-size:${68 * unit * hookScale}px;font-weight:600}
    [data-archetype="stat-callout"] .hook{font-size:${78 * unit * hookScale}px}`;
}

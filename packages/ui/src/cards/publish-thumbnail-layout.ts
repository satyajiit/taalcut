// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- CSS values and font family names, not user-facing copy */

import type { ThumbnailArchetype, ThumbnailAspect, ThumbnailVariant, ThumbnailTheme } from '@taalcut/core';
import type { CSSProperties } from 'react';

const PALETTES = {
  'golden-hour': ['#edb839', '#171717'],
  midnight: ['#ab8be8', '#15151a'],
  newsprint: ['#f3efe5', '#242323'],
  studio: ['#ef9c8e', '#292627'],
  terminal: ['#75c4b4', '#151c1b'],
  'brand-kit': ['#e4a0af', '#292329'],
} as const;

/** Matches the renderer's cover safe area; the UI package cannot import render. */
export function coverSafeInset(aspect: ThumbnailAspect): CSSProperties {
  const [top, bottom] = aspect === '9:16' ? [25, 25] : aspect === '4:5' ? [14, 14] : [8, 12];
  return { top: `${top}%`, bottom: `${bottom}%`, left: '7%', right: aspect === '9:16' ? '18%' : '15%' };
}

/** Layout proportions follow coverBundle; live covers use the renderer's exact image and pinned fonts. */
export function thumbnailLayout(
  variant: ThumbnailVariant,
  aspect: ThumbnailAspect,
  archetype: ThumbnailArchetype,
  theme: ThumbnailTheme,
) {
  const unit = (n: number) => `${(n / (aspect === '16:9' ? 1920 : 1080)) * 100}cqw`;
  const [accent, ink] = PALETTES[theme];
  const { words, hook } = thumbnailTypeStyles(variant.hookText, archetype, unit);
  const badge: CSSProperties = {
    fontSize: unit(24),
    fontWeight: 700,
    padding: `${unit(10)} ${unit(14)}`,
    maxWidth: '65%',
    overflowWrap: 'anywhere',
  };
  return {
    root: {
      '--color-accent': accent,
      '--color-ink': ink,
      '--color-paper': '#fff',
      '--color-scrim': 'rgba(0,0,0,.72)',
      '--font-display': "'Noto Sans Variable','Noto Sans Devanagari Variable',sans-serif",
      containerType: 'inline-size',
      color: 'var(--color-paper)',
      background: 'var(--color-ink)',
      fontFamily: 'var(--font-display)',
      aspectRatio: aspect.replace(':', '/'),
    } as CSSProperties,
    scrim: { background: 'linear-gradient(90deg,var(--color-scrim),transparent)' } as CSSProperties,
    safe: { ...coverSafeInset(aspect), gap: unit(24) },
    badges: { gap: unit(20) },
    body: {
      justifyContent:
        variant.textAlign === 'top-left'
          ? 'flex-start'
          : variant.textAlign === 'left'
            ? 'center'
            : 'flex-end',
    },
    words,
    hook,
    kicker: {
      display: 'table',
      maxWidth: '100%',
      background: 'var(--color-accent)',
      color: 'var(--color-ink)',
      fontSize: unit(28),
      fontWeight: 800,
      padding: `${unit(8)} ${unit(14)}`,
      marginBottom: unit(20),
    } as CSSProperties,
    channel: { ...badge, background: 'var(--color-ink)', color: 'var(--color-paper)' },
    stat: { ...badge, background: 'var(--color-accent)', color: 'var(--color-ink)' },
    callout: {
      fontSize: unit(100),
      fontWeight: 800,
      lineHeight: 1,
      maxWidth: '100%',
      color: 'var(--color-accent)',
      marginBottom: unit(20),
      overflowWrap: 'anywhere',
    } as CSSProperties,
  };
}

function thumbnailTypeStyles(
  hookText: string,
  archetype: ThumbnailArchetype,
  unit: (value: number) => string,
) {
  const scale = hookText.length > 32 ? 0.84 : 1;
  const words: CSSProperties = { width: '100%', maxWidth: '100%', overflowWrap: 'anywhere' };
  const hook: CSSProperties = {
    margin: 0,
    fontSize: unit(88 * scale),
    lineHeight: 1.12,
    fontStyle: 'normal',
    fontWeight: 800,
    overflowWrap: 'anywhere',
    textWrap: 'balance',
  };
  if (archetype === 'editorial-specimen')
    Object.assign(words, {
      borderLeft: `${unit(6)} solid var(--color-accent)`,
      paddingLeft: unit(24),
      width: '94%',
    });
  if (archetype === 'brutal-slab') {
    Object.assign(words, { background: 'var(--color-ink)', padding: unit(28) });
    Object.assign(hook, { fontSize: unit(94 * scale), letterSpacing: '-.035em' });
  }
  if (archetype === 'atmospheric-cinema') {
    words.width = '82%';
    Object.assign(hook, { fontSize: unit(76 * scale), letterSpacing: '.015em', fontWeight: 600 });
  }
  if (archetype === 'minimal-frame') {
    Object.assign(words, { width: '86%', border: `${unit(2)} solid var(--color-paper)`, padding: unit(28) });
    Object.assign(hook, { fontSize: unit(68 * scale), fontWeight: 600 });
  }
  if (archetype === 'stat-callout') hook.fontSize = unit(78 * scale);
  return { words, hook };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The brand layer (P3-V10, SPEC P3.5): the Style's logo (above clips, below text, graphics and captions),
 * its watermark (always on, in a corner) and its intro and outro text cards. Logo files come from the style
 * asset store, hard-linked into the bundle's `brand/` folder: PNG, JPEG or WebP only, never SVG. Text is
 * escaped like every other text.
 */
import { ok, type Style } from '@taalcut/core';
import { CAP_HEIGHT_EM, familyList } from '../compile/css';
import { element, escapeHtml } from '../compile/html';
import { layerOutput, Z, type CompositionLayer, type LayerContext, type LayerLink } from '../compile/layer';
import { windowSeconds } from '../time/frames';
import type { CaptionFontId } from '../types';
import { brandLayout, WATERMARK_TEXT_SHARE, type BrandPiece } from './brand-layout';

/** A Style asset on disk, for the bundle. */
export interface BrandAssetFile {
  readonly file: string;
  readonly key: string;
  readonly ext: 'png' | 'jpg' | 'webp';
}

/** Text cards sit above the clips and below the logo. */
const Z_CARD = 120;

function rectCss(id: string, piece: BrandPiece, z: number): string {
  const { x, y, width, height } = piece.rect;
  return `#${id} { left: ${x}px; top: ${y}px; width: ${width}px; height: ${height}px; opacity: ${piece.opacity}; z-index: ${z}; object-fit: contain; }`;
}

function cards(context: LayerContext, style: Style) {
  const markup: string[] = [];
  const css: string[] = [];
  const font = style.fonts.heading;
  const stack = context.fonts ? context.fonts.stack(font.family) : [];
  const size = Math.round((0.04 * context.height) / CAP_HEIGHT_EM);
  for (const card of context.plan.bumpers.cards) {
    const id = `k-${card.id}`;
    const window = windowSeconds(card.span.start, card.span.end, context.rate);
    markup.push(
      element(
        'div',
        { id, class: 'clip tc-card', 'data-start': window.start, 'data-duration': window.duration },
        element('span', { class: 'tc-card-text' }, escapeHtml(card.text)),
      ),
    );
    css.push(
      `#${id} { z-index: ${Z_CARD}; display: flex; align-items: center; justify-content: center; ` +
        `background: ${style.colours[card.background]}; color: ${style.colours.text}; ` +
        `font-family: ${familyList(stack)}; font-weight: ${font.weight}; font-size: ${size}px; text-align: center; }`,
      `#${id} .tc-card-text { max-width: ${context.safe.width}px; }`,
    );
  }
  return { markup, css, fonts: context.plan.bumpers.cards.length > 0 ? [font.family] : [] };
}

export function brandLayer(
  assets: ((sha256: string) => BrandAssetFile | undefined) | undefined,
): CompositionLayer {
  return {
    id: 'brand',
    build(context) {
      const style = context.style;
      if (!style) return ok(layerOutput({}));
      const markup: string[] = [];
      const css: string[] = [];
      const links: Record<string, LayerLink> = {};
      const warnings: string[] = [];
      const fonts: CaptionFontId[] = [];
      const pieces = brandLayout(style, context, context.plan.bumpers, context.plan.durationFrames);
      for (const piece of pieces) {
        const z = piece.kind === 'logo' ? Z.brand : Z.watermark;
        piece.spans.forEach((span, index) => {
          const id = `b-${piece.kind}-${index}`;
          const window = windowSeconds(span.start, span.end, context.rate);
          const timing = {
            'data-start': window.start,
            'data-duration': window.duration,
            'data-tc-brand': piece.kind,
          };
          if (piece.asset) {
            const file = assets?.(piece.asset);
            if (!file) {
              if (index === 0) warnings.push(`brand ${piece.kind} image is missing`);
              return;
            }
            const path = `brand/${piece.asset}.${file.ext}`;
            links[path] = { source: file.file, key: file.key };
            markup.push(
              element('img', { id, class: 'clip tc-brand', src: path, alt: '', ...timing }, '', true),
            );
            css.push(rectCss(id, piece, z));
            return;
          }
          const body = style.fonts.body;
          fonts.push(body.family);
          const stack = context.fonts ? context.fonts.stack(body.family) : [];
          const size = Math.round((WATERMARK_TEXT_SHARE * context.height) / CAP_HEIGHT_EM);
          markup.push(
            element('div', { id, class: 'clip tc-brand', ...timing }, escapeHtml(piece.text ?? '')),
          );
          css.push(
            `${rectCss(id, piece, z).slice(0, -1)} font-family: ${familyList(stack)}; font-weight: ${body.weight}; ` +
              `font-size: ${size}px; color: ${style.colours.text}; white-space: nowrap; }`,
          );
        });
      }
      const drawn = cards(context, style);
      return ok(
        layerOutput({
          markup: [...drawn.markup, ...markup],
          css: [...drawn.css, ...css],
          links,
          fonts: [...drawn.fonts, ...fonts],
          warnings,
        }),
      );
    },
  };
}

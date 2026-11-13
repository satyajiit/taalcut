// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CoverDesign, CoverDesignLayer, CoverPathCommand } from '@taalcut/core';
import { fileForWeight, fontStack } from '../captions/fonts';
import { escapeHtml } from '../compile/html';

const color = (role: string) => (role === 'transparent' ? 'transparent' : `var(--color-${role})`);

/** The path language contains typed, bounded numbers only; it cannot name files or execute markup. */
export function coverPathData(commands: readonly CoverPathCommand[]): string {
  return commands
    .map((point) => {
      switch (point.command) {
        case 'M':
        case 'L':
          return `${point.command}${point.x} ${point.y}`;
        case 'Q':
          return `Q${point.cx} ${point.cy} ${point.x} ${point.y}`;
        case 'C':
          return `C${point.c1x} ${point.c1y} ${point.c2x} ${point.c2y} ${point.x} ${point.y}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

function layerContents(
  layer: CoverDesignLayer,
  unit: number,
  localUnit: number,
  index: number,
  hasImage: boolean,
) {
  if (layer.kind === 'text') {
    const { weight } = fileForWeight(layer.font, layer.weight);
    const shadow =
      hasImage && (layer.color === 'paper' || layer.color === 'accent')
        ? 'text-shadow:0 2px 6px rgba(0,0,0,.55),0 8px 28px rgba(0,0,0,.42);'
        : '';
    return {
      html: `<div class="design-layer design-text" data-design-layer="${index}" data-cover-fit>${escapeHtml(layer.text)}</div>`,
      css: `font-family:var(--font-${layer.font});font-weight:${weight};font-size:${unit * layer.fontSize}px;line-height:${layer.lineHeight};letter-spacing:${layer.letterSpacing}em;text-align:${layer.align};color:${color(layer.color)};${shadow}white-space:pre-wrap;overflow-wrap:anywhere;font-style:normal;font-synthesis:none;`,
    };
  }
  if (layer.kind === 'shape') {
    const softScrim =
      hasImage &&
      layer.shape === 'rectangle' &&
      layer.fill === 'ink' &&
      layer.strokeWidth === 0 &&
      layer.box.width >= 0.35 &&
      layer.box.height >= 0.06;
    const bg = softScrim
      ? 'radial-gradient(ellipse at center,rgba(0,0,0,.48) 0%,rgba(0,0,0,.22) 62%,transparent 100%)'
      : color(layer.fill);
    const radius =
      layer.shape === 'ellipse'
        ? '50%'
        : `${unit * (softScrim ? Math.max(layer.radius, 0.03) : layer.radius)}px`;
    return {
      html: `<div class="design-layer design-shape" data-design-layer="${index}"></div>`,
      css: `background:${bg};border:${unit * layer.strokeWidth}px solid ${color(layer.stroke)};border-radius:${radius};`,
    };
  }
  const stroke = layer.strokeWidth * localUnit;
  return {
    html: `<svg class="design-layer design-path" data-design-layer="${index}" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><path d="${coverPathData(layer.commands)}" fill="${color(layer.fill)}" stroke="${color(layer.stroke)}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"${layer.dashed ? ` stroke-dasharray="${stroke * 4} ${stroke * 3}"` : ''}/></svg>`,
    css: 'overflow:visible;',
  };
}

/** Authored covers preserve the brief's geometry; platform crop guides never silently move the design. */
export function authoredCover(design: CoverDesign, width: number, height: number, hasImage = false) {
  const unit = Math.min(width, height);
  const html: string[] = [];
  const fonts = [...new Set(design.layers.flatMap((layer) => (layer.kind === 'text' ? [layer.font] : [])))];
  const fontTokens = fonts
    .map(
      (font) =>
        `--font-${font}:${fontStack(font)
          .map((name) => `'${name}'`)
          .join(',')}`,
    )
    .join(';');
  const backdrop = design.backdrop ?? { fit: 'cover', x: 0.5, y: 0.5 };
  const css = [
    `*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:clip}`,
    `#root{position:relative;width:${width}px;height:${height}px;overflow:clip;${Object.entries(
      design.palette,
    )
      .map(([key, value]) => `--color-${key}:${value}`)
      .join(';')};${fontTokens};background:var(--color-paper)}`,
    `.backdrop{position:absolute;inset:0;width:100%;height:100%;object-fit:${backdrop.fit};object-position:${backdrop.x * 100}% ${backdrop.y * 100}%}`,
    '.design-layer{position:absolute;transform-origin:center;min-width:0;margin:0}',
  ];
  design.layers.forEach((layer, index) => {
    const content = layerContents(
      layer,
      unit,
      Math.min(layer.box.width * width, layer.box.height * height),
      index,
      hasImage,
    );
    const { x, y, width: w, height: h } = layer.box;
    html.push(content.html);
    css.push(
      `[data-design-layer="${index}"]{left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;opacity:${layer.opacity};transform:rotate(${layer.rotation}deg);${content.css}}`,
    );
  });
  return { html: html.join(''), css: css.join('\n') };
}

/** Fit after the pinned fonts load. A bounded search prevents long edits from being clipped or covering another layer. */
export const COVER_DESIGN_FIT_JS = `document.fonts.ready.then(() => {
  for (const element of document.querySelectorAll('[data-cover-fit]')) {
    const max = parseFloat(getComputedStyle(element).fontSize);
    let low = Math.min(12, max), high = max;
    const fits = () => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
    if (fits()) continue;
    for (let i = 0; i < 12; i++) {
      const size = (low + high) / 2;
      element.style.fontSize = size + 'px';
      if (fits()) low = size; else high = size;
    }
    element.style.fontSize = low + 'px';
    element.dataset.coverFit = fits() ? 'fitted' : 'overflow';
  }
});`;

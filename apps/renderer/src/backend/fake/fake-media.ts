// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in footage for the fake backend. A plain browser has no app://media
 * host, so each thumbnail key is painted on a canvas from the scene its hash
 * carries (library/scenes.ts) and handed out as a data: URL (the CSP allows
 * data: images). A few hundred distinct pictures at most, cached; jsdom has no
 * canvas, so there it returns null and frames stay on the viewer grey.
 */
import type { TemplateSummarySheet } from '@taalcut/core';
import type { MediaUrls } from '../media';
import { sampleOriginal } from './library/sample-clips';
import { SCENES, type Scene } from './library/scenes';
import { prng, sceneOfKey } from './library/seed';
import { sampleReelOf, sampleSheetOf } from './templates/template-review-plans';

type Ctx = CanvasRenderingContext2D;

const FAKE_PREVIEW = 'app://preview/fake/';
/** The sample clips' files (UX2), served by vite dev and preview (e2e/sample-media/server.ts). */
const SAMPLE_MEDIA = '/fake-media/';
/** A sample clip's derived key names its file: `….sample-<file>.v<recipe>.<ext>` (library/sample-clips.ts). */
const SAMPLE_KEY = /\.sample-([a-z0-9-]+)\.v\d+\.(mp4|jpg)$/;
const STOCK_PREVIEW = 'app://media/stock/';

function gradient(ctx: Ctx, top: string, bottom: string, y0: number, y1: number) {
  const fill = ctx.createLinearGradient(0, y0, 0, y1);
  fill.addColorStop(0, top);
  fill.addColorStop(1, bottom);
  return fill;
}

function paint(ctx: Ctx, scene: Scene, x: number, y: number, w: number, h: number, variant: number) {
  const random = prng(variant * 977 + 3);
  const [sky, haze, ground, detail] = scene.colours;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const horizon = y + h * (0.48 + random() * 0.18);
  ctx.fillStyle = gradient(ctx, sky, haze, y, horizon);
  ctx.fillRect(x, y, w, h);
  switch (scene.layout) {
    case 'horizon':
    case 'water': {
      ctx.fillStyle = detail;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x + w * (0.25 + random() * 0.5), horizon - h * 0.04, Math.min(w, h) * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient(ctx, ground, sky, horizon, y + h);
      ctx.beginPath();
      ctx.moveTo(x, horizon);
      for (let i = 0; i <= 6; i += 1)
        ctx.lineTo(x + (w * i) / 6, horizon + (scene.layout === 'water' ? 0 : (random() - 0.6) * h * 0.08));
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.fill();
      if (scene.layout === 'water') {
        ctx.strokeStyle = detail;
        ctx.globalAlpha = 0.45;
        for (let i = 0; i < 9; i += 1) {
          const ly = horizon + (h * 0.5 * (i + random())) / 9;
          ctx.lineWidth = 1 + random() * 2;
          ctx.beginPath();
          ctx.moveTo(x + w * random() * 0.5, ly);
          ctx.lineTo(x + w * (0.5 + random() * 0.5), ly);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'city': {
      let bx = x - random() * 10;
      while (bx < x + w) {
        const bw = w * (0.12 + random() * 0.18);
        const top = y + h * (0.25 + random() * 0.35);
        ctx.fillStyle = ground;
        ctx.fillRect(bx, top, bw - 2, y + h - top);
        ctx.fillStyle = detail;
        for (let wy = top + 6; wy < y + h - 6; wy += 9)
          for (let wx = bx + 4; wx < bx + bw - 6; wx += 7) if (random() < 0.35) ctx.fillRect(wx, wy, 3, 4);
        bx += bw;
      }
      break;
    }
    case 'closeup': {
      ctx.fillStyle = ground;
      ctx.fillRect(x, y + h * 0.55, w, h * 0.45);
      const r = Math.min(w, h) * (0.3 + random() * 0.08);
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.58, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.ellipse(x + w / 2 + r * 0.1, y + h * 0.56, r * 0.55, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'room': {
      ctx.fillStyle = detail;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x + w * (random() < 0.5 ? 0.08 : 0.55), y + h * 0.12, w * 0.36, h * 0.34);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ground;
      ctx.fillRect(x, y + h * 0.7, w, h * 0.3);
      ctx.beginPath();
      ctx.ellipse(x + w * (0.35 + random() * 0.3), y + h * 0.58, w * 0.14, h * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  // A soft vignette, like a phone lens.
  const vignette = ctx.createRadialGradient(
    x + w / 2,
    y + h / 2,
    Math.min(w, h) * 0.3,
    x + w / 2,
    y + h / 2,
    Math.max(w, h) * 0.75,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function createFakeMedia(): MediaUrls {
  const cache = new Map<string, string | null>();
  let canvas: HTMLCanvasElement | null = null;

  function draw(key: string, width: number, height: number, drawing: (ctx: Ctx) => void): string | null {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    canvas ??= document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    let ctx: Ctx | null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) {
      cache.set(key, null);
      return null;
    }
    drawing(ctx);
    const url = canvas.toDataURL('image/jpeg', 0.82);
    cache.set(key, url);
    return url;
  }

  const derived: MediaUrls['derived'] = (ref) => {
    const sample = SAMPLE_KEY.exec(ref.key);
    if (sample) return `${SAMPLE_MEDIA}${sample[1]}.${sample[2]}`;
    const code = sceneOfKey(ref.key);
    const scene = code % SCENES.length;
    // Three looks per scene: enough to tell clips apart, few enough to cache.
    const variant = Number.parseInt(ref.key.slice(-12, -8), 16) % 3 || 0;
    const width = Math.max(32, Math.round(ref.width ?? 180));
    const height = Math.max(32, Math.round(ref.height ?? 320));
    return draw(`${scene}:${variant}:${width}x${height}`, width, height, (ctx) =>
      paint(ctx, SCENES[scene]!, 0, 0, width, height, scene * 3 + variant),
    );
  };

  return {
    derived,
    playback(assetId, playback) {
      if (playback.source === 'proxy') return derived(playback.file);
      const original = sampleOriginal(assetId);
      return original ? `${SAMPLE_MEDIA}${original}.mp4` : null;
    },
    // BRK1-REV: a template's kept reel is its own sample (make-reels.mjs) when there is one, else the landscape clip.
    templateReel: (templateId) => `${SAMPLE_MEDIA}${sampleReelOf(templateId)}`,
    templateAsset(sheet: TemplateSummarySheet) {
      // BRK1-REV: a template whose reel the fake plays shows that reel's own frames.
      const made = sampleSheetOf(sheet.asset);
      if (made) return `${SAMPLE_MEDIA}${made}`;
      const base = Number.parseInt(sheet.asset.slice(0, 4), 16);
      const { columns, rows, tile } = sheet;
      return draw(`sheet:${sheet.asset}`, columns * tile.width, rows * tile.height, (ctx) => {
        for (let i = 0; i < columns * rows; i += 1) {
          const scene = (base + i * 5) % SCENES.length;
          paint(
            ctx,
            SCENES[scene]!,
            (i % columns) * tile.width,
            Math.floor(i / columns) * tile.height,
            tile.width,
            tile.height,
            i,
          );
        }
      });
    },
    // The render fake's posters name the library frame they show (fake-renders.ts mediaUrl); videos have none.
    // A stock result's poster (main's app://media/stock/<sha>.jpg, phase3/stock) is painted from its digest.
    preview(url: string) {
      if (url.startsWith(STOCK_PREVIEW))
        return derived({ key: url.slice(STOCK_PREVIEW.length - 'stock/'.length), width: 320, height: 180 });
      const key = url.startsWith(FAKE_PREVIEW) ? url.slice(FAKE_PREVIEW.length) : null;
      return key && !key.startsWith('render/') ? derived({ key, width: 180, height: 320 }) : null;
    },
  };
}

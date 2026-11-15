// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the made-up title's words: data, never translated */

/**
 * DSG2: stand-in stills for the fake's three made-up designs of one title (the ui kit's design option fixtures).
 * The real stills are the Designer's renders of each option over the person's video, kept with the workspace's
 * files; a plain browser has none, so each fixture sha256 is painted on a canvas (as fake-media.ts paints the
 * stand-in footage): a dusk street, and the title lettered three ways. They are pictures for the picker in the
 * preview only: nothing the app ships, and nothing a graphic is drawn from. jsdom has no canvas, so there the
 * read has no image and the tile keeps the shot under the graphic.
 */
import { DESIGN_OPTION_IDS } from '@taalcut/ui';

type Ctx = CanvasRenderingContext2D;

const WIDTH = 270;
const HEIGHT = 480;
const TITLE = 'Golden hour market';

function street(ctx: Ctx) {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, '#f2a65a');
  sky.addColorStop(0.45, '#d9734e');
  sky.addColorStop(1, '#3b2a3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#ffd9a0';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(WIDTH * 0.68, HEIGHT * 0.34, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Stalls: awnings along the street, darker toward the bottom.
  const awnings = ['#7a3b3b', '#2f4858', '#8a5a2b', '#4a3350'];
  for (let i = 0; i < 4; i += 1) {
    const x = i * 72 - 10;
    const top = HEIGHT * 0.52 + (i % 2) * 14;
    ctx.fillStyle = awnings[i] ?? '#4a3350';
    ctx.beginPath();
    ctx.moveTo(x, top + 26);
    ctx.lineTo(x + 36, top);
    ctx.lineTo(x + 78, top + 26);
    ctx.fill();
    ctx.fillStyle = '#2a1f2b';
    ctx.fillRect(x + 6, top + 26, 66, HEIGHT - top);
  }
  ctx.fillStyle = 'rgba(30, 20, 30, 0.55)';
  ctx.fillRect(0, HEIGHT * 0.78, WIDTH, HEIGHT * 0.22);
}

/** Tall condensed capitals off the left edge, led by a short rule. */
function poster(ctx: Ctx) {
  ctx.fillStyle = '#f4b63f';
  ctx.fillRect(24, 296, 26, 3);
  ctx.fillStyle = '#fdf8ee';
  ctx.shadowColor = 'rgba(20, 14, 6, 0.6)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.font = '400 44px "Anton", "Bebas Neue", Impact, "Arial Narrow", sans-serif';
  ctx.textBaseline = 'top';
  ['GOLDEN HOUR', 'MARKET'].forEach((line, index) => ctx.fillText(line, 24, 306 + index * 46));
}

/** Light lettering in the middle. */
function whisper(ctx: Ctx) {
  ctx.fillStyle = '#fbfaf6';
  ctx.shadowColor = 'rgba(12, 16, 22, 0.55)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.font = '200 23px "Montserrat", "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(TITLE, WIDTH / 2, HEIGHT / 2);
}

/** A rounded paper tag in the top corner. */
function tag(ctx: Ctx) {
  ctx.font = '700 17px "Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  const width = Math.min(WIDTH - 40, ctx.measureText(TITLE).width + 24);
  const x = WIDTH - 20 - width;
  ctx.fillStyle = '#f3ead8';
  ctx.beginPath();
  ctx.roundRect(x, 72, width, 32, 8);
  ctx.fill();
  ctx.fillStyle = '#2a2118';
  ctx.textBaseline = 'middle';
  ctx.fillText(TITLE, x + 12, 89, width - 24);
}

const LETTERINGS = [poster, whisper, tag] as const;
const painted = new Map<string, { mimeType: 'image/jpeg'; dataBase64: string } | null>();

/** The still behind a fixture sha256 as `workspace.read` hands an image back; null for any other sha256. */
export function optionStill(sha256: string): { mimeType: 'image/jpeg'; dataBase64: string } | null {
  const index = (DESIGN_OPTION_IDS.stills as readonly string[]).indexOf(sha256);
  const lettering = LETTERINGS[index];
  if (!lettering || typeof document === 'undefined') return null;
  const held = painted.get(sha256);
  if (held !== undefined) return held;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  // jsdom's canvas has no context (it returns null, or throws without the canvas package).
  const context = (): Ctx | null => {
    try {
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  };
  const ctx = context();
  let still: { mimeType: 'image/jpeg'; dataBase64: string } | null = null;
  if (ctx) {
    street(ctx);
    ctx.save();
    lettering(ctx);
    ctx.restore();
    const url = canvas.toDataURL('image/jpeg', 0.82);
    const dataBase64 = url.slice(url.indexOf(',') + 1);
    if (url.startsWith('data:image/jpeg') && dataBase64) still = { mimeType: 'image/jpeg', dataBase64 };
  }
  painted.set(sha256, still);
  return still;
}

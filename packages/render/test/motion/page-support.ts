// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pages for the motion int tests: a flat PNG every visual shows (the pinned shell has no H.264 decoder), a
 * composition compiled and written as a bundle, a loopback file server for preview bundles (as main's app://
 * handler serves them), and the page expression that reads every animated element's state at a frame.
 */
import { createServer, type Server } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { deflateSync } from 'node:zlib';
import { RationalTime, type Timeline } from '@taalcut/core';
import {
  compileComposition,
  type CompileOptions,
  type CompositionBundle,
} from '../../src/compile/composition';
import { createCompositionFonts } from '../../src/captions/fonts';
import { layoutCue } from '../../src/captions/layout';
import { writeBundle } from '../../src/engine/bundle-writer';
import { presetFor } from '../../src/presets/presets.v1';
import { FONTS_DIR, testMeasurer } from '../support/fonts';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** A flat RGB PNG. */
export function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Compiles `timeline` with real fonts and caption layout, every visual a flat still, and writes the bundle. */
export async function writeMotionBundle(
  timeline: Timeline,
  dir: string,
  variant: 'export' | 'preview',
  extra: Partial<CompileOptions> = {},
): Promise<CompositionBundle> {
  const still = join(dir, '..', 'still.png');
  await writeFile(still, solidPng(16, 16, [0x3a, 0x6e, 0xa5]));
  const measurer = await testMeasurer();
  const rate = timeline.canvas.rate;
  const compiled = compileComposition(timeline, {
    variant,
    preset: presetFor('device'),
    burnCaptions: true,
    fonts: createCompositionFonts(FONTS_DIR, measurer),
    captionLayout: (text, style, safe, language, height) =>
      layoutCue(text, style, measurer, safe, language, height),
    media: () => ({ file: still, key: 'still', mediaStart: RationalTime.zero(rate), ext: 'png' }),
    ...extra,
  });
  if (!compiled.ok) throw new Error(compiled.error.code);
  await writeBundle(compiled.value, dir);
  return compiled.value;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** Serves `dir` on loopback, read only, as the preview handler does (no directory listings, nothing outside). */
export async function serveDir(dir: string): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(
      /^\/+/,
      '',
    );
    if (path.startsWith('..')) {
      response.writeHead(403).end();
      return;
    }
    const file = path || 'index.html';
    readFile(join(dir, file)).then(
      (body) =>
        response
          .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
          .end(body),
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/`, server };
}

/**
 * Every animated element's state as Chrome draws it, keyed by id (SplitText's units by their block's id and index):
 * opacity, transform, clip, filter, crop, origin, path data, stroke dash and visibility. A stroke DrawSVG draws
 * none of ('0px, 999999px') reads as 'undrawn': its offset then draws nothing, and DrawSVG nudges it by a
 * thousandth of a pixel against render artifacts, by which tween drew it last.
 */
export const MOTION_STATE = `(() => {
  const out = {};
  const read = (el, key) => {
    const s = getComputedStyle(el);
    const dash = s.strokeDasharray === '0px, 999999px' ? 'undrawn' : s.strokeDasharray + ' ' + s.strokeDashoffset;
    out[key] = [s.opacity, s.transform, s.clipPath, s.filter, s.objectPosition, s.transformOrigin, el.getAttribute('d') || '', dash, s.visibility].join(' | ');
  };
  for (const el of document.querySelectorAll('#root [id]')) read(el, el.id);
  const units = document.querySelectorAll('.tc-sw, .tc-sc');
  units.forEach((el, index) => read(el, (el.closest('[id]') || { id: 'root' }).id + '/' + el.className + index));
  return out;
})()`;

/** One element's inline style property as GSAP wrote it. */
export const inlineStyle = (id: string, property: string) =>
  `(() => { const el = document.getElementById(${JSON.stringify(id)}); return el ? el.style.getPropertyValue(${JSON.stringify(property)}) : null; })()`;

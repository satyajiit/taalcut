// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildInterfaceSounds } from './build-interface-sounds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const RENDERER = join(REPO, 'apps/renderer');
// Authoring reuses the renderer's pinned development dependencies, outside its Node-free source boundary.
const requireRenderer = createRequire(join(RENDERER, 'package.json'));
const { chromium } = requireRenderer('@playwright/test');
const { build } = await import(pathToFileURL(requireRenderer.resolve('vite')).href);
const MANIFEST = join(REPO, 'tools/audio-packs/interface-sounds.json');
const spec = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const { values } = parseArgs({ options: { out: { type: 'string' }, ffmpeg: { type: 'string' } } });
const ffmpeg = values.ffmpeg ?? process.env.TAALCUT_FFMPEG ?? join(REPO, 'tools/ffmpeg/dist/ffmpeg');
const out = resolve(values.out ?? join(RENDERER, 'src/features/sounds/assets'));
const scratch = mkdtempSync(join(tmpdir(), 'taalcut-tone-interface-'));
let browser;

try {
  process.stdout.write('Offline synthesis uses CPU: OfflineAudioContext exposes no GPU synthesis backend.\n');
  const bundle = await build({
    configFile: false,
    root: RENDERER,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: join(RENDERER, 'scripts/interface-sounds-browser.mjs'),
        formats: ['iife'],
        name: 'InterfaceSounds',
      },
    },
  });
  const built = Array.isArray(bundle) ? bundle[0] : bundle;
  const script = built.output.find((entry) => entry.type === 'chunk' && entry.isEntry);
  if (!script) throw new Error('No Tone authoring entry was built');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: script.code });
  const sources = [];
  for (const sound of spec.sounds) {
    const samples = await page.evaluate(
      ({ sound, authoring }) => globalThis.renderInterfaceSound(sound, authoring),
      { sound, authoring: spec.authoring },
    );
    if (samples.length !== Math.round((sound.lengthMs / 1000) * spec.authoring.sampleRate))
      throw new Error(`${sound.name}: unexpected sample count`);
    if (!samples.every(Number.isFinite) || !samples.some((sample) => Math.abs(sample) > 0.0001))
      throw new Error(`${sound.name}: invalid or silent offline render`);
    const pcm = Buffer.alloc(samples.length * 4);
    samples.forEach((sample, index) => pcm.writeFloatLE(sample, index * 4));
    const wav = join(scratch, `${sound.name}.wav`);
    execFileSync(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'f32le',
        '-ar',
        String(spec.authoring.sampleRate),
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-c:a',
        'pcm_f32le',
        wav,
      ],
      { input: pcm, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    sources.push({ name: sound.name, pcmSha256: createHash('sha256').update(pcm).digest('hex') });
  }
  const rows = buildInterfaceSounds({ ffmpeg, generated: scratch, out });
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'provenance.json'),
    `${JSON.stringify(
      {
        authoring: spec.authoring,
        chromium: browser.version(),
        ffmpeg: execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0],
        manifestSha256: createHash('sha256').update(readFileSync(MANIFEST)).digest('hex'),
        recipeSha256: createHash('sha256')
          .update(readFileSync(join(REPO, 'tools/audio-packs', spec.authoring.recipe)))
          .digest('hex'),
        sounds: rows.map((row) => ({ ...sources.find((source) => source.name === row.name), ...row })),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} finally {
  await browser?.close();
  rmSync(scratch, { recursive: true, force: true });
}

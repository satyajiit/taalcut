// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The P3-V5 manual check's files (SPEC, "P3-V5"): the 30-clip fixture on a 30 and a 29.97 fps canvas through every
 * registered writer, and beside each file the cut list another editor has to show, one row per cut.
 *
 *   pnpm --filter @taalcut/timeline run interchange:fixture <out-dir>
 *
 * The originals are `/Volumes/Shoot Day/<asset id>.mov`, so Resolve, Premiere and Final Cut import every clip
 * offline (one is marked offline on purpose): step through the cuts against `<canvas>-cuts.txt`. Relinking is
 * checked on a real project's export from the app.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FrameRates, type FrameRate } from '@taalcut/core';
import { EXPORTERS } from '../src/interchange/catalog';
import { cutList, type CutEntry } from '../src/interchange/cut-list';
import { originals, thirtyClipTimeline } from '../test/fixtures/interchange';

const CANVASES: readonly (readonly [string, FrameRate])[] = [
  ['30', FrameRates.fps30],
  ['29.97', FrameRates.fps29_97],
];

/** Non-drop-frame timecode on the canvas's nominal frame count (what the editors show for an NDF sequence). */
function timecode(frame: number, rate: FrameRate): string {
  const nominal = Math.round(rate.num / rate.den);
  const pad = (value: number) => String(value).padStart(2, '0');
  const seconds = Math.floor(frame / nominal);
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frame % nominal)}`;
}

function cutRows(entries: readonly CutEntry[], rate: FrameRate): string {
  const header = 'track\tkind\tstart\ttimecode\tframes\tasset\tin-point (s)';
  const rows = entries.map((entry) =>
    [
      entry.track,
      entry.kind,
      entry.start,
      timecode(entry.start, rate),
      entry.frames,
      entry.assetId ?? '-',
      entry.inPoint ?? '-',
    ].join('\t'),
  );
  return `${[header, ...rows].join('\n')}\n`;
}

function main(outDir: string | undefined): number {
  if (!outDir) {
    process.stderr.write('Usage: pnpm --filter @taalcut/timeline run interchange:fixture <out-dir>\n');
    return 2;
  }
  const target = resolve(outDir);
  mkdirSync(target, { recursive: true });
  for (const [label, rate] of CANVASES) {
    const timeline = thirtyClipTimeline(rate);
    const offline = timeline.tracks[0]?.items.find(
      (item) => item.type === 'clip' && item.media.kind === 'video',
    );
    const media = originals(timeline, new Set(offline?.type === 'clip' ? [offline.media.assetId] : []));
    writeFileSync(join(target, `${label}-cuts.txt`), cutRows(cutList(timeline), rate));
    for (const exporter of EXPORTERS) {
      const written = exporter.write(timeline, { media, pathStyle: 'fileUrl' });
      if (!written.ok) {
        process.stderr.write(
          `${exporter.id} on ${label} fps: ${written.error.code} ${written.error.detail ?? ''}\n`,
        );
        return 1;
      }
      const file = join(target, `${label}${exporter.fileExtension}`);
      writeFileSync(file, written.value.text);
      process.stdout.write(`Wrote ${file} (${written.value.warnings.length} warnings)\n`);
    }
  }
  return 0;
}

process.exitCode = main(process.argv[2]);

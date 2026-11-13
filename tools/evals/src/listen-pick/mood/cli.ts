// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `eval:listen-mood --manifest <manifest.json> --out <report.md>` (EAR1-B3): needs TAALCUT_EAR1_MODELS, FFmpeg
 * (tools/ffmpeg) and a CC0 manifest (manifest.ts has the format); the tracks are downloaded at run time into
 * ~/.cache/taalcut-ear1/listen-mood, checked by sha256, never committed. Exits 1 below the bar.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../../entry';
import { MOOD_BAR, readMoodManifest, runMood } from './run';

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { manifest: { type: 'string' }, out: { type: 'string' } },
      strict: true,
    });
    if (!values.manifest || !values.out)
      throw new Error('Usage: eval:listen-mood --manifest <file> --out <report.md>');
    const result = await runMood(readMoodManifest(resolve(values.manifest)));
    const out = resolve(values.out);
    mkdirSync(dirname(out), { recursive: true });
    const rows = result.cases.map(
      (c) => `| ${c.id} | ${c.mood} | ${c.hints.join(', ')} | ${c.hit ? 'yes' : 'no'} |`,
    );
    const detail = `mood in the top 3 hints ${result.rate.toFixed(3)} (need >= ${MOOD_BAR.top3MoodRate}; ${result.dtype})`;
    writeFileSync(
      out,
      [
        '# listen-mood eval (EAR1-B3)',
        '',
        detail,
        '',
        '| track | label | top 3 hints | hit |',
        '| --- | --- | --- | --- |',
        ...rows,
        '',
      ].join('\n'),
    );
    writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(result, null, 2));
    console.log(`${detail}. ${result.pass ? 'pass' : 'fail'}.`);
    return result.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) void main(process.argv.slice(2)).then((code) => process.exit(code));

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm --filter @taalcut/bench-footage generate -- --out DIR [--set ix-v1|fades-v1] [--force] [--verify]
 * [--stall-dir DIR] [--refinish .mp4]`: makes a footage set, or says the one in DIR already matches; `--refinish`
 * runs the finishing stream copy again over the files with that extension (a metadata fix, nothing re-encoded). Run it under the machine's
 * video-encoder lock: its HEVC is encoded with VideoToolbox. A stalled FFmpeg call is reported into the stall
 * folder (`--stall-dir`, else $TAALCUT_VT_STALL_DIR, else `vt-stalls` beside DIR) and left running.
 */
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ensureFootage } from './generate';
import { refinishSet } from './refinish';
import { footageSet } from './sets/index';
import { bundledFfmpeg, systemTools } from './tools';

const USAGE =
  'Usage: generate --out DIR [--set ix-v1|fades-v1] [--force] [--verify] [--ffmpeg PATH] [--stall-dir DIR] [--refinish .mp4]';

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : [...argv],
    strict: true,
    options: {
      out: { type: 'string' },
      set: { type: 'string' },
      force: { type: 'boolean' },
      verify: { type: 'boolean' },
      ffmpeg: { type: 'string' },
      'stall-dir': { type: 'string' },
      refinish: { type: 'string' },
    },
  });
  if (values.out === undefined) throw new Error(USAGE);
  const ffmpeg = values.ffmpeg ?? bundledFfmpeg();
  if (ffmpeg === undefined)
    throw new Error('No FFmpeg build: run tools/ffmpeg/build.sh (or set TAALCUT_FFMPEG_DIR).');
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const out = resolve(cwd, values.out);
  const stallDir = values['stall-dir'] ?? process.env.TAALCUT_VT_STALL_DIR?.trim();
  const reportDir = stallDir ? resolve(cwd, stallDir) : join(dirname(out), 'vt-stalls');
  const set = footageSet(values.set ?? 'ix-v1');
  if (values.refinish !== undefined) {
    const ext = values.refinish;
    const tools = systemTools(ffmpeg, { reportDir });
    const manifest = await refinishSet(set, out, tools, (file) => file.endsWith(ext));
    console.log(`[footage] ${manifest.set}: finished the ${ext} files again, manifest updated (${out})`);
    return 0;
  }
  const started = Date.now();
  const { manifest, generated } = await ensureFootage(set, out, systemTools(ffmpeg, { reportDir }), {
    force: values.force === true,
    checksums: values.verify === true,
    log: (line) => console.log(line),
  });
  const verb = generated ? `generated in ${((Date.now() - started) / 1000).toFixed(0)} s` : 'already there';
  console.log(
    `[footage] ${manifest.set}: ${manifest.clips.length} files, ${manifest.totalSeconds} s, ${verb} (${out})`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The LIB1-LANG spoken-language eval:
 *   pnpm --filter @taalcut/evals run eval:language fetch   --dir <folder> [--owner <folder with owner-clips.json>]
 *   pnpm --filter @taalcut/evals run eval:language predict --dir <folder>
 *   pnpm --filter @taalcut/evals run eval:language eval    --dir <folder> [--out report.md] [--tune]
 * The folder holds the fetched audio and the evidence; keep it outside the repo.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireMediaBinaries } from '../media-bin';
import { fetchLanguageSet } from './fetch';
import { predictLanguageSet, readClips, readEvidence } from './predict';
import { languageReport } from './report';
import { tune } from './tune';

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: readonly string[]): Promise<void> {
  const [command] = args;
  const dir = flag(args, 'dir');
  if (!dir) throw new Error('--dir <folder> is required');
  const log = (line: string) => console.log(line);
  if (command === 'fetch') {
    const binaries = await requireMediaBinaries();
    const owner = flag(args, 'owner');
    await fetchLanguageSet({
      dir: resolve(dir),
      ffmpeg: binaries.ffmpeg,
      ...(owner ? { ownerDir: resolve(owner) } : {}),
      log,
    });
    return;
  }
  if (command === 'predict') return predictLanguageSet({ dir: resolve(dir), log });
  if (command === 'eval') {
    const [rows, clips] = [readEvidence(resolve(dir)), readClips(resolve(dir))];
    const tuned = args.includes('--tune') ? tune(rows, clips) : undefined;
    const report = languageReport(rows, clips, tuned ? { tuned } : {});
    const out = flag(args, 'out');
    if (out) writeFileSync(resolve(out), report + '\n');
    console.log(report);
    return;
  }
  throw new Error(`unknown command ${command ?? ''}: fetch, predict or eval`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's web atlases (WEB2 lane L5): builds public/kaatu/kaatu-<sheet>.webp from the drawn sheets in
 * design/mascot/source/ and embeds each atlas's provenance.
 *
 *   node scripts/kaatu-atlas.mjs                     build, then embed provenance
 *   node scripts/kaatu-atlas.mjs --provenance-only   embed provenance into the atlases already there
 *   KAATU_PYTHON=<python with Pillow, NumPy, SciPy> node scripts/kaatu-atlas.mjs
 *
 * The build is design/mascot/web-atlas.py (build.py's registration at 480 px cells, so Kaatu stays sharp at 240 px on
 * a 2x screen), over the app's six sheets and the site's two (web-creator, web-story). Each sheet was drawn with
 * Codex's image tool (transparent background) from its prompt in design/mascot/prompts/<sheet>.txt; the provenance
 * names that prompt and quotes it whole. It runs `impeccable embed-prompt` when the CLI is found ($IMPECCABLE, else
 * `impeccable` on the PATH), and otherwise writes the same sidecar (`<file>.json`) itself.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const OUT = join(site, 'public/kaatu');

/** In the order of src/components/kaatu/kaatu-frames.ts › SHEETS. */
export const KAATU_ATLASES = ['directions', 'blinks', 'glances', 'reactions', 'antics', 'tricks', 'web-creator', 'web-story'];

/** The CLI's path: $IMPECCABLE when it names a file, else `impeccable` when it is on the PATH. */
function impeccable() {
  if (process.env.IMPECCABLE && existsSync(process.env.IMPECCABLE)) return process.env.IMPECCABLE;
  const found = spawnSync('which', ['impeccable'], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() || undefined : undefined;
}

function provenance(sheet) {
  const promptFile = join(repo, 'design/mascot/prompts', `${sheet}.txt`);
  const text = readFileSync(promptFile, 'utf8').trim();
  return (
    `Codex image tool, transparent_background: true, one call for the whole 3x3 sheet (${relative(repo, promptFile)}), ` +
    `registered on the directions sheet's centre cell into this atlas by design/mascot/web-atlas.py. Prompt: ${text}`
  );
}

if (!process.argv.includes('--provenance-only')) {
  const python = process.env.KAATU_PYTHON ?? 'python3';
  const built = spawnSync(python, [join(repo, 'design/mascot/web-atlas.py'), '--out', OUT], { stdio: 'inherit' });
  if (built.status !== 0) {
    console.error(`kaatu-atlas: ${python} design/mascot/web-atlas.py failed (it needs Pillow, NumPy and SciPy; set KAATU_PYTHON)`);
    process.exit(built.status ?? 1);
  }
}

const cli = impeccable();
for (const sheet of KAATU_ATLASES) {
  const file = join(OUT, `kaatu-${sheet}.webp`);
  if (!existsSync(file)) {
    console.error(`kaatu-atlas: ${relative(site, file)} is missing`);
    process.exit(1);
  }
  const prompt = provenance(sheet);
  if (cli) {
    const run = spawnSync(cli, ['embed-prompt', file, '--prompt', prompt], { encoding: 'utf8' });
    if (run.status !== 0) {
      console.error(run.stderr || run.stdout);
      process.exit(run.status ?? 1);
    }
  } else {
    writeFileSync(`${file}.json`, `${JSON.stringify({ prompt, createdAt: new Date().toISOString() }, null, 2)}\n`);
  }
  console.log(`kaatu-atlas: ${relative(site, file)} with its provenance`);
}

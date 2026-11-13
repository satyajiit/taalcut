// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Build time only: writes (or, with --check, verifies) the text-embedding banks the CLAP audio components ship, with
 * the TypeScript runner on the unpacked text builds. tools/components/listen/build-text-embeddings.mjs runs this
 * file with tsx; nothing in the app imports it.
 *
 *   tsx text-bank-cli.ts --models <dir> --out <dir> [--check]
 *
 * Both dtypes run on ONNX Runtime's CPU provider: deterministic here, and where the int8 build runs. The JSON index
 * is written the way Prettier formats it (`--prettier <bin>`), so a repository-wide format leaves pinned bytes alone.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createClapText } from '../models/clap-text';
import { directoryListenFiles } from '../models/files';
import { createListenSessions } from '../models/sessions';
import { decodeTextBank, textBankFiles, type TextBankIndex } from './text-bank';
import { buildTextBank } from './text-bank-build';

const DTYPES = ['int8', 'fp16'] as const;

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / Math.sqrt(na * nb);
}

/** Returns the process exit code. */
export async function main(
  argv: readonly string[],
  log: (line: string) => void = console.warn,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      models: { type: 'string' },
      out: { type: 'string' },
      prettier: { type: 'string' },
      check: { type: 'boolean' },
    },
  });
  if (!values.models || !values.out) {
    log('usage: text-bank-cli.ts --models <dir> --out <dir> [--prettier <bin>] [--check]');
    return 2;
  }
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  let failed = false;
  for (const dtype of DTYPES) {
    const sessions = createListenSessions({
      files: directoryListenFiles(resolve(values.models), dtype),
      plan: async () => ({
        devices: ['cpu'],
        cpuReason: { reason: 'disabled', detail: 'build time: deterministic CPU', wanted: [] },
      }),
    });
    const built = await buildTextBank(createClapText(sessions, 16), dtype);
    await sessions.release();
    if (!built.ok) throw new Error(`${dtype}: ${built.error.code} ${built.error.detail ?? ''}`);
    const files = textBankFiles(dtype);
    if (values.check) {
      const index = JSON.parse(await readFile(join(out, files.index), 'utf8')) as TextBankIndex;
      const committed = decodeTextBank(index, new Uint8Array(await readFile(join(out, files.data))));
      const fresh = decodeTextBank(built.value.index, built.value.data);
      if (!committed.ok || !fresh.ok) throw new Error(`${dtype}: a bank does not decode`);
      let worst = 1;
      committed.value.sets.forEach((set, s) =>
        set.rows.forEach(
          (row, r) => (worst = Math.min(worst, cosine(row, fresh.value.sets[s]?.rows[r] ?? row))),
        ),
      );
      log(`${dtype}: rebuilt rows against the committed ones, min cosine ${worst.toFixed(6)}`);
      if (worst < 0.9999) failed = true;
      continue;
    }
    await writeFile(join(out, files.data), built.value.data);
    const indexPath = join(out, files.index);
    await writeFile(indexPath, `${JSON.stringify(built.value.index)}\n`);
    if (values.prettier) execFileSync(values.prettier, ['--write', indexPath]);
    const rows = built.value.index.sets.reduce((sum, set) => sum + set.phrases.length, 0);
    log(`${dtype}: ${rows} rows in ${built.value.index.sets.length} sets → ${out}`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

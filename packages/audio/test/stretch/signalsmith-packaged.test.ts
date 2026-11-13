// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The packaged app has no node_modules for Signalsmith: tsdown inlines the vendored module into the utility bundle
 * inside app.asar (it isn't one of the desktop's external dependencies). That only works because the module is one
 * self-contained file, its WebAssembly inlined as a data URI, with no sibling file, path or `require` to resolve.
 * These checks keep it that way: the file alone, copied somewhere else, loads in plain Node.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const MODULE = join(
  import.meta.dirname,
  '../../../../third_party/signalsmith-stretch/src/signalsmith-stretch.mjs',
);
const run = promisify(execFile);
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the vendored Signalsmith module, as the packaged app loads it', () => {
  it('carries its WebAssembly inline and reads no file, path or require', async () => {
    const text = await readFile(MODULE, 'utf8');
    expect(text).toContain('data:application/octet-stream;base64,');
    expect(text).not.toMatch(/import\.meta\.url|\brequire\(|\.wasm["'`]/);
  });

  it('loads and configures from a copy alone in another folder, in plain Node', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-signalsmith-'));
    dirs.push(dir);
    const copy = join(dir, 'bundle.mjs');
    await copyFile(MODULE, copy);
    const script = [
      `const { default: load } = await import(${JSON.stringify(pathToFileURL(copy).href)});`,
      'const m = await load();',
      'm._presetDefault(2, 48000);',
      'process.stdout.write(JSON.stringify({ input: m._inputLatency(), output: m._outputLatency() }));',
    ].join('\n');
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { cwd: dir });
    expect(JSON.parse(stdout)).toEqual({ input: 2880, output: 2880 });
  });
});

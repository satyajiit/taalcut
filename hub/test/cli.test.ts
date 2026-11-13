// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The workflows start each script with `node scripts/<name>.mjs …`; the other tests run them in this
// process (cli.ts). Here each runs once as its own process: a refused run reaches stderr and the exit code,
// and a run that passes exits 0 with nothing on stderr.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SCRIPTS, STARTS_PROCESSES, withHub, writeRel } from './cli';
import { template, templateRel } from './fixture';

function node(name: string, args: string[]): { status: number | null; stderr: string } {
  const script = join(import.meta.dirname, '..', 'scripts', name);
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

describe('each script as its own process', STARTS_PROCESSES, () => {
  it.for(Object.keys(SCRIPTS))('%s exits 1 and says why when it refuses the run', (name) => {
    const result = node(name, ['--bogus']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('unknown argument --bogus\n');
  });

  it('validate.mjs exits 0 and writes nothing when the template passes', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify(template()));
      const result = node('validate.mjs', ['--root', root, '--files', templateRel()]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
    });
  });
});

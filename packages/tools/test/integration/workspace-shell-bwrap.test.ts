// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell under bubblewrap (AGT2 sbx), on a Linux machine with /usr/bin/bwrap that may make user
 * namespaces (Ubuntu 23.10 and later: with Taalcut's AppArmor profile loaded). Skipped elsewhere, saying why.
 * The macOS suites' probes, for bwrap: no network but the shell's own loopback, no home folder, no writes outside
 * the folder or into its inputs and manifest, the seccomp filter in force, and the processes gone afterwards.
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeBwrapHost, bwrapBackendFor } from '../../src/shell/bwrap-host';
import { shellEnv, SHELL_DIRS } from '../../src/shell/folder';
import { shellLimits } from '../../src/shell/limits';
import { freeLoopbackPorts } from '../../src/shell/loopback';
import { runShell } from '../../src/shell/run-shell';
import { skipMessage } from '../helpers/sandbox';
import { nodeToolchain, shellFolder } from '../helpers/shell';

const probed = process.platform === 'linux' ? await probeBwrapHost() : null;
const skip =
  process.platform !== 'linux'
    ? 'not Linux'
    : probed && !probed.ok
      ? (probed.error.detail ?? 'no bwrap')
      : '';
skipMessage('workspace shell under bubblewrap', skip);

let shell: Awaited<ReturnType<typeof shellFolder>>;
beforeEach(async () => {
  shell = await shellFolder();
});
afterEach(() => shell.cleanup());

async function run(command: string) {
  const toolchain = nodeToolchain();
  const ports = await freeLoopbackPorts();
  const backend = await bwrapBackendFor()(shell.folder, toolchain, ports);
  if (!backend.ok) throw new Error(backend.error.detail ?? backend.error.code);
  const limits = shellLimits({ wallMs: 60_000 });
  const result = await runShell({
    backend: backend.value.backend,
    command,
    cwd: join(shell.folder, SHELL_DIRS.work),
    env: shellEnv(shell.folder, toolchain, ports),
    limits,
    watch: { dir: shell.folder, maxBytes: limits.diskBytes },
    output: { stdoutBytes: 16 * 1024, stderrBytes: 16 * 1024 },
    fileBlockBytes: backend.value.fileBlockBytes,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe.skipIf(skip !== '')('the workspace shell under bubblewrap', { timeout: 120_000 }, () => {
  it('writes in work/ and out/, and nowhere else', async () => {
    writeFileSync(join(shell.folder, SHELL_DIRS.inputs, 'clip.txt'), 'frames');
    const result = await run(
      [
        'echo hi > note.txt && echo ok > ../out/o.txt && echo "work=0"',
        'echo x > ../inputs/clip.txt 2>/dev/null; echo "inputs=$?"',
        'echo x > ../shell.json 2>/dev/null; echo "manifest=$?"',
        'echo x > ../../escape.txt 2>/dev/null; echo "parent=$?"',
        `ls ${homedir()} >/dev/null 2>&1; echo "home=$?"`,
        'cat ../inputs/clip.txt',
      ].join('; '),
    );
    expect(result.stdout).toMatch(/work=0/);
    for (const name of ['inputs', 'manifest', 'parent', 'home'])
      expect(result.stdout).toMatch(new RegExp(`${name}=[1-9]`));
    expect(result.stdout).toMatch(/frames/);
  });

  it("has no network but its own loopback, and the filter's refusals hold", async () => {
    const result = await run(
      [
        `node -e "fetch('https://example.com').then(()=>console.log('net=0'),()=>console.log('net=1'))"`,
        `node -e "const n=require('net'),s=n.createServer(c=>c.end('hi')).listen(0,'127.0.0.1',()=>n.connect(s.address().port,'127.0.0.1').on('data',d=>{console.log('own='+(String(d)==='hi'?0:1));s.close()}))"`,
        'unshare -U true 2>/dev/null; echo "userns=$?"',
        'ls /run/user /sys 2>/dev/null | head -1; echo "listed"',
      ].join('; '),
    );
    expect(result.stdout).toMatch(/net=1/);
    expect(result.stdout).toMatch(/own=0/);
    expect(result.stdout).toMatch(/userns=[1-9]/);
  });
});

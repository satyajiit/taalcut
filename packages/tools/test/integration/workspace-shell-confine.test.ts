// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's confinement is macOS's (AGT2 sbx): a real `sh -c` under workspace.sb, deny by default.
 * Each probe runs what an agent could type and shows the kernel refusing it: the network (a local server sees no
 * connection), the home folder (no listing, no read, no write, not through a symlink either), the clipboard,
 * LaunchServices' `open`, Apple Events, and any write outside the shell folder or into its inputs and manifest.
 * Then what must work: files in work/ and out/, Node with child processes, a headless screenshot. The watchdog's
 * and the clean-up's tests are in workspace-shell-limits.test.ts. Run on every new macOS.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { confined, findHeadlessShell, nodeToolchain, shellFolder, shellSkipReason } from '../helpers/shell';
import { skipMessage } from '../helpers/sandbox';

const skip = shellSkipReason();
skipMessage('workspace shell confinement', skip);

let folder: string;
let root: string;
let cleanup: () => void;
beforeEach(async () => {
  ({ folder, root, cleanup } = await shellFolder());
  writeFileSync(join(folder, 'inputs', 'clip.txt'), 'input');
  chmodSync(join(folder, 'inputs', 'clip.txt'), 0o444);
});
afterEach(() => cleanup());

const out = async (command: string, toolchain = nodeToolchain()) => {
  const result = await confined(folder, command, { toolchain });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
  return result.value;
};

describe.skipIf(skip !== '')('workspace.sb', { timeout: 120_000 }, () => {
  it('runs a shell that writes in work/ and out/ and reads its inputs', async () => {
    const result = await out('echo made > made.txt && echo clip > ../out/clip.txt && cat ../inputs/clip.txt');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('input');
    expect(readFileSync(join(folder, 'work', 'made.txt'), 'utf8')).toBe('made\n');
    expect(readFileSync(join(folder, 'out', 'clip.txt'), 'utf8')).toBe('clip\n');
  });

  it('refuses writes into inputs/ and the manifest, and outside the folder', async () => {
    const manifest = readFileSync(join(folder, 'shell.json'), 'utf8');
    const outside = join(root, 'escaped.txt');
    const result = await out(
      [
        'echo x > ../inputs/new.txt; echo "inputs=$?"',
        'chmod 644 ../inputs/clip.txt; echo "chmod=$?"',
        'rm -f ../inputs/clip.txt; echo "rm=$?"',
        'echo x > ../shell.json; echo "manifest=$?"',
        `echo x > '${outside}'; echo "outside=$?"`,
        'echo x > /private/tmp/taalcut-shell-escape.txt; echo "tmp=$?"',
        'echo x > /Users/Shared/taalcut-shell-escape.txt; echo "shared=$?"',
      ].join('; '),
    );
    for (const name of ['inputs', 'chmod', 'rm', 'manifest', 'outside', 'tmp', 'shared'])
      expect(result.stdout).toMatch(new RegExp(`${name}=[1-9]`));
    expect(result.stderr).toMatch(/Operation not permitted/);
    expect(existsSync(join(folder, 'inputs', 'new.txt'))).toBe(false);
    expect(readFileSync(join(folder, 'inputs', 'clip.txt'), 'utf8')).toBe('input');
    expect(readFileSync(join(folder, 'shell.json'), 'utf8')).toBe(manifest);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync('/private/tmp/taalcut-shell-escape.txt')).toBe(false);
    expect(existsSync('/Users/Shared/taalcut-shell-escape.txt')).toBe(false);
  });

  it("can't list, read or write the home folder, nor read it through a symlink", async () => {
    const home = homedir();
    const prefs = join(home, 'Library', 'Preferences', '.GlobalPreferences.plist');
    const probe = join(home, `.taalcut-shell-probe-${process.pid}`);
    try {
      const result = await out(
        [
          `ls '${home}' > /dev/null; echo "list=$?"`,
          `cat '${prefs}' > /dev/null; echo "read=$?"`,
          `echo x > '${probe}'; echo "write=$?"`,
          `ln -s '${home}' homelink && cat homelink/Library/Preferences/.GlobalPreferences.plist > /dev/null; echo "link=$?"`,
          `node -e "require('fs').readdirSync(process.argv[1])" '${home}' 2> /dev/null; echo "node=$?"`,
        ].join('; '),
      );
      for (const name of ['list', 'read', 'write', 'link', 'node'])
        expect(result.stdout).toMatch(new RegExp(`${name}=[1-9]`));
      expect(existsSync(probe)).toBe(false);
    } finally {
      execFileSync('/bin/rm', ['-f', probe]);
    }
  });

  it("has no network: a local server sees no connection, and only the run's own loopback ports listen", async () => {
    let connections = 0;
    const server: Server = createServer((_req, res) => res.end('ok'));
    server.on('connection', () => (connections += 1));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await out(
        [
          `curl -sS -m 5 http://127.0.0.1:${port}/ > /dev/null; echo "curl=$?"`,
          `node -e "fetch('http://127.0.0.1:${port}/').then(()=>console.log('fetch=0'),()=>console.log('fetch=1'))"`,
          `node -e "require('net').createServer().listen(0,'127.0.0.1',()=>console.log('listen=0')).on('error',()=>console.log('listen=1'))"`,
          'curl -sS -m 5 https://example.com > /dev/null; echo "dns=$?"',
          // One of the run's ports (TAALCUT_SHELL_PORTS): a server there answers the shell's own processes.
          `node -e "const p=+process.env.TAALCUT_SHELL_PORTS.split(',')[0],n=require('net'),s=n.createServer(c=>c.end('hi')).listen(p,'127.0.0.1',()=>n.connect(p,'127.0.0.1').on('data',d=>{console.log('own='+(String(d)==='hi'?0:1));s.close()}).on('error',()=>{console.log('own=2');s.close()}))"`,
        ].join('; '),
      );
      for (const name of ['curl', 'fetch', 'listen', 'dns'])
        expect(result.stdout).toMatch(new RegExp(`${name}=[1-9]`));
      expect(result.stdout).toMatch(/own=0/);
      expect(connections).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("can't reach the clipboard, LaunchServices or Apple Events", async () => {
    // Compared by length only: the person's clipboard is never printed, and never written.
    const outside = execFileSync('/usr/bin/pbpaste').length;
    const result = await out(
      [
        'echo taalcut | pbcopy; echo "pbcopy=$?"',
        'echo "pbpaste=$(pbpaste | wc -c | tr -d " ")"',
        'open -g -j -a Finder 2> /dev/null; echo "open=$?"',
        // An application's name is answered without an event; its version needs one (27.2 outside the sandbox).
        `osascript -e 'tell application "Finder" to get version' > /dev/null 2>&1; echo "osascript=$?"`,
        `osascript -e 'get the clipboard' > /dev/null 2>&1; echo "clipboard=$?"`,
      ].join('; '),
    );
    expect(result.stdout).toMatch(/pbcopy=[1-9]/);
    expect(result.stdout).toMatch(/pbpaste=0\b/);
    expect(result.stdout).toMatch(/open=[1-9]/);
    expect(result.stdout).toMatch(/osascript=[1-9]/);
    expect(result.stdout).toMatch(/clipboard=[1-9]/);
    if (outside === 0)
      console.warn('workspace shell confinement: the clipboard is empty, so its read proves less.');
  });

  it('runs Node with child processes and a pipe between them', async () => {
    const result = await out(
      `node -e "const cp=require('child_process'); console.log(cp.execFileSync('sh',['-c','echo piped | tr a-z A-Z']).toString().trim())"`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('PIPED');
  });

  const shell = findHeadlessShell();
  if (!shell)
    console.warn('workspace shell confinement: no chrome-headless-shell, the screenshot is skipped.');
  it.skipIf(shell === null)('takes a headless screenshot with --no-sandbox inside the profile', async () => {
    writeFileSync(
      join(folder, 'work', 'index.html'),
      '<html><body style="margin:0;background:#e33;font:40px sans-serif">Taalcut</body></html>',
    );
    const toolchain = { roots: [shell!], bin: [shell!], env: {}, programs: [] };
    const result = await out(
      'chrome-headless-shell --no-sandbox --headless --disable-gpu --user-data-dir="$TMPDIR/chrome" ' +
        '--window-size=320,180 --screenshot=../out/shot.png "file://$PWD/index.html"',
      toolchain,
    );
    expect(result.exitCode).toBe(0);
    const png = readFileSync(join(folder, 'out', 'shot.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.length).toBeGreaterThan(1000);
  });
});

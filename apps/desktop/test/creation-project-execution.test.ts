// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ok } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCreationProject } from '../src/utility/creation/project-execution';
import { creationRegistry } from '../src/utility/creation/project-registry';
import { freeLoopbackPorts } from '@taalcut/tools';
import { projectExecutionResources } from '../packaging/project-execution-resources';

const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-project-capture-'));
  roots.push(root);
  const source = join(root, 'source');
  await mkdir(source);
  await writeFile(join(root, 'private.txt'), 'private-canary');
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ name: 'capture-fixture', version: '1.0.0', scripts: { dev: 'node server.cjs' } }),
  );
  await writeFile(
    join(source, 'server.cjs'),
    `
const fs = require('node:fs');
let outside = false;
try { fs.readFileSync(${JSON.stringify(join(root, 'private.txt'))}); outside = true; } catch {}
fs.writeFileSync('executed.txt', 'inside snapshot');
require('node:http').createServer((req, res) => res.end(JSON.stringify({title:'Actual running project',outside,pid:process.pid})))
  .listen(Number(process.env.PORT), '127.0.0.1');
`,
  );
  const nodeBin = dirname(realpathSync(process.execPath));
  return {
    root,
    source,
    toolchain: {
      roots: [dirname(nodeBin)],
      bin: [nodeBin],
      env: {},
      programs: [{ name: 'node', version: process.version }],
    },
    packageManagers: {
      npm: realpathSync(dirname(require.resolve('npm/package.json'))),
      pnpm: realpathSync(dirname(require.resolve('pnpm'))),
    },
  };
}

describe('managed project preview', () => {
  it.skipIf(process.platform !== 'darwin').each(['npm', 'pnpm'] as const)(
    'executes real %s and a server in confinement, captures it and preserves the source',
    async (packageManager) => {
      const f = await fixture();
      let pid = 0;
      const result = await runCreationProject(
        {
          snapshotId: 'fixture',
          packageManager,
          script: 'dev',
          buildScript: null,
          install: true,
          timeoutMs: 15_000,
        },
        {
          snapshotRoot: f.source,
          scratchRoot: join(f.root, 'sessions'),
          toolchain: f.toolchain,
          packageManagers: f.packageManagers,
          signal: new AbortController().signal,
          capture: async (url, signal) => {
            const facts = (await fetch(url, { signal }).then((response) => response.json())) as {
              title: string;
              outside: boolean;
              pid: number;
            };
            expect(facts.outside).toBe(false);
            pid = facts.pid;
            return ok({ title: facts.title, text: facts.title, url, assets: [] });
          },
        },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.ok && result.value.title).toBe('Actual running project');
      expect(await readdir(f.source)).toEqual(['package.json', 'server.cjs']);
      expect(await readFile(join(f.root, 'private.txt'), 'utf8')).toBe('private-canary');
      expect(await readdir(join(f.root, 'sessions'))).toEqual([]);
      expect(() => process.kill(pid, 0)).toThrow();
    },
    25_000,
  );

  it('refuses arbitrary registry requests and packages both managers with the app', async () => {
    const f = await fixture();
    const [port] = await freeLoopbackPorts(1);
    const registry = await creationRegistry(f.source, port!, new AbortController().signal);
    try {
      expect((await fetch(`${registry.base}/not-a-dependency`)).status).toBe(403);
      expect((await fetch(`${registry.base}/example?secret=bad`)).status).toBe(403);
    } finally {
      await registry.close();
    }
    const resources = projectExecutionResources(join(import.meta.dirname, '..'));
    expect(resources.map((entry) => entry.to)).toEqual(['project-tools/npm', 'project-tools/pnpm']);
  });

  it.skipIf(process.platform !== 'darwin').each(['npm', 'pnpm'] as const)(
    'launches an actual offline Vite application through %s with the assigned port',
    async (packageManager) => {
      const f = await fixture();
      const viteRequire = createRequire(require.resolve('vitest/package.json'));
      const vite = viteRequire.resolve('vite');
      const viteRoot = dirname(viteRequire.resolve('vite/package.json'));
      await writeFile(
        join(f.source, 'package.json'),
        JSON.stringify({ name: 'vite-fixture', scripts: { dev: 'node vite-fixture.mjs' } }),
      );
      await writeFile(
        join(f.source, 'index.html'),
        '<div id="app">Real Vite product</div><script type="module" src="/main.ts"></script>',
      );
      await writeFile(
        join(f.source, 'main.ts'),
        'const launch: string = "verified-product"; document.querySelector("#app").textContent = launch;',
      );
      await writeFile(
        join(f.source, 'vite-fixture.mjs'),
        `
import { createServer } from ${JSON.stringify(vite)};
const args = process.argv.slice(2);
if (args[0] !== '--host' || args[2] !== '--port') throw new Error('Package manager did not forward server flags');
const server = await createServer({configFile:false, server:{host:args[1],port:Number(args[3]),strictPort:true}});
await server.listen();
`,
      );
      const result = await runCreationProject(
        {
          snapshotId: 'vite',
          packageManager,
          script: 'dev',
          buildScript: null,
          install: false,
          timeoutMs: 20_000,
        },
        {
          snapshotRoot: f.source,
          scratchRoot: join(f.root, 'sessions'),
          packageManagers: f.packageManagers,
          toolchain: {
            ...f.toolchain,
            roots: [...f.toolchain.roots, realpathSync(join(viteRoot, '../../..'))],
          },
          signal: new AbortController().signal,
          capture: async (url, signal) => {
            const page = await fetch(url, { signal }).then((response) => response.text());
            const module = await fetch(`${url}/main.ts`, { signal }).then((response) => response.text());
            expect(page).toContain('Real Vite product');
            expect(module).toContain('verified-product');
            expect(module).not.toContain('launch: string');
            return ok({ title: 'Real Vite product', text: page, url, assets: [] });
          },
        },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    },
    30_000,
  );
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Explicit public-registry smoke: CI is offline unless TAALCUT_TEST_CREATION_NETWORK=1 is set. */
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { runCreationProject } from '../src/utility/creation/project-execution';

const require = createRequire(import.meta.url);
const enabled = process.env.TAALCUT_TEST_CREATION_NETWORK === '1' && process.platform === 'darwin';

describe.skipIf(!enabled)('creation public-registry dependency installation', () => {
  it.each(['npm', 'pnpm'] as const)(
    'installs fresh and frozen Vite snapshots with %s, builds native dependencies, and captures the server',
    async (packageManager) => {
      const root = await mkdtemp(join(tmpdir(), 'taalcut-creation-network-'));
      const source = join(root, 'source');
      const sessions = join(root, 'sessions');
      await mkdir(source);
      const viteRequire = createRequire(require.resolve('vitest/package.json'));
      const viteVersion = JSON.parse(await readFile(viteRequire.resolve('vite/package.json'), 'utf8'))
        .version as string;
      const esbuildVersion = JSON.parse(await readFile(viteRequire.resolve('esbuild/package.json'), 'utf8'))
        .version as string;
      const manifest = JSON.stringify({
        name: 'creation-network-smoke',
        version: '1.0.0',
        private: true,
        scripts: { dev: 'vite', build: 'node verify-native.cjs && vite build', preview: 'vite preview' },
        devDependencies: { vite: viteVersion, esbuild: esbuildVersion },
      });
      await writeFile(join(source, 'package.json'), manifest);
      await writeFile(
        join(source, 'index.html'),
        '<div id="app">Fresh dependency capture</div><script type="module" src="/main.ts"></script>',
      );
      await writeFile(
        join(source, 'main.ts'),
        'const marker: string = "fresh-native-build"; document.querySelector("#app").textContent = marker;',
      );
      await writeFile(
        join(source, 'verify-native.cjs'),
        'const result = require("esbuild").transformSync("const value: number = 42", {loader:"ts"}); if (!result.code.includes("42")) process.exit(1);',
      );
      const originalFiles = await readdir(source);
      const nodeBin = dirname(realpathSync(process.execPath));
      const lockName = packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml';
      let lock = '';
      try {
        for (const frozen of [false, true]) {
          if (frozen)
            await writeFile(
              join(source, lockName),
              lock.replaceAll(/http:\/\/127\.0\.0\.1:\d+/g, 'https://registry.npmjs.org'),
            );
          const result = await runCreationProject(
            {
              snapshotId: 'network-fixture',
              packageManager,
              script: frozen ? 'preview' : 'dev',
              buildScript: 'build',
              install: true,
              timeoutMs: 180_000,
            },
            {
              snapshotRoot: source,
              scratchRoot: sessions,
              packageManagers: {
                npm: realpathSync(dirname(require.resolve('npm/package.json'))),
                pnpm: realpathSync(dirname(require.resolve('pnpm'))),
              },
              toolchain: {
                roots: [dirname(nodeBin)],
                bin: [nodeBin],
                env: {},
                programs: [{ name: 'node', version: process.version }],
              },
              signal: AbortSignal.timeout(185_000),
              capture: async (url, signal) => {
                const html = await fetch(url, { signal }).then((response) => response.text());
                expect(html).toContain('Fresh dependency capture');
                const script = frozen ? /src="([^"]+\.js)"/.exec(html)?.[1] : '/main.ts';
                expect(script).toBeDefined();
                const compiled = await fetch(new URL(script!, url), { signal }).then((response) =>
                  response.text(),
                );
                expect(compiled).toContain('fresh-native-build');
                expect(compiled).not.toContain('marker: string');
                const session = (await readdir(sessions))[0]!;
                const work = join(sessions, session, 'work');
                const installed = JSON.parse(
                  await readFile(join(work, 'node_modules/vite/package.json'), 'utf8'),
                ) as { version: string };
                expect(installed.version).toBe(viteVersion);
                lock = await readFile(join(work, lockName), 'utf8');
                expect(lock.length).toBeGreaterThan(100);
                return ok({ title: 'Fresh dependency capture', text: compiled, url, assets: [] });
              },
            },
          );
          expect(result.ok, JSON.stringify({ packageManager, frozen, result })).toBe(true);
          expect(await readFile(join(source, 'package.json'), 'utf8')).toBe(manifest);
          expect(await readdir(source)).toEqual([...originalFiles, ...(frozen ? [lockName] : [])].sort());
          expect(await readdir(sessions)).toEqual([]);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    390_000,
  );
});

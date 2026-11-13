// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The crash reports' SDK (P2-X5) runs without Sentry's build-time tools. @sentry/node 11 declares
 * @sentry/bundler-plugins as a dependency, and they depend on the Sentry CLI (`sentry`, FSL-1.1, not open source);
 * pnpm-workspace.yaml's overrides leave both out of the tree and so out of the packaged app (UX2 round 3). This
 * bundles sentry-entry.ts as main's build inlines it, static and lazy imports alike: a module of those packages in
 * the graph, or an import that no longer resolves because they're gone, fails here before an app ships without
 * crash reports.
 */
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { rolldown, type RolldownLog } from 'rolldown';
import { describe, expect, it } from 'vitest';

const desktop = join(import.meta.dirname, '..');
const BUILD_TIME = /[\\/]node_modules[\\/](?:@sentry[\\/]bundler-plugins|sentry|@sentry[\\/]cli)[\\/]/;
const BUILD_TIME_NAMES = /^(?:@sentry\/bundler-plugins|sentry|@sentry\/cli)(?:\/|$)/;

describe("the crash reports' SDK as main bundles it", () => {
  it('loads none of Sentry’s build-time packages, and every import resolves without them', async () => {
    const unresolved: string[] = [];
    const bundle = await rolldown({
      input: join(desktop, 'src', 'main', 'crash', 'sentry-entry.ts'),
      platform: 'node',
      // What main leaves external (tsdown.config.ts): Electron and Node's own modules.
      external: ['electron', /^node:/, ...builtinModules],
      onLog(level, log: RolldownLog) {
        if (log.code === 'UNRESOLVED_IMPORT') unresolved.push(log.message);
        else if (level === 'warn' && log.code !== 'EVAL' && log.code !== 'CIRCULAR_DEPENDENCY')
          unresolved.push(`${log.code ?? 'warning'}: ${log.message}`);
      },
    });
    try {
      const { output } = await bundle.generate({ format: 'esm' });
      const modules = output.flatMap((item) => (item.type === 'chunk' ? item.moduleIds : []));
      expect(modules.some((id) => id.includes(join('@sentry', 'electron')))).toBe(true);
      expect(modules.filter((id) => BUILD_TIME.test(id))).toEqual([]);
      // Everything but Electron and Node is inlined, as in main's build: nothing is left to load from node_modules.
      const imports = output.flatMap((item) =>
        item.type === 'chunk' ? [...item.imports, ...item.dynamicImports] : [],
      );
      const node = new Set(builtinModules);
      expect(imports.filter((id) => id !== 'electron' && !id.startsWith('node:') && !node.has(id))).toEqual(
        [],
      );
      expect(unresolved).toEqual([]);
    } finally {
      await bundle.close();
    }
  });

  it('is installed without them: the lockfile names neither the bundler plugins nor the CLI', () => {
    const lockfile = readFileSync(join(desktop, '..', '..', 'pnpm-lock.yaml'), 'utf8');
    const packages = [...lockfile.matchAll(/^ {2}'?(@?[^@\s']+)@[^:\s]+'?:\s*$/gm)].map((match) => match[1]);
    expect(packages).toContain('@sentry/node');
    expect(packages.filter((name) => name && BUILD_TIME_NAMES.test(name))).toEqual([]);
  });
});

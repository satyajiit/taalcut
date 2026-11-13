// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Crash reports' SDK lives only in main's bundle (UX2 round 4): app.asar leaves out the @sentry and
 * @opentelemetry copies electron-builder would collect. These fail when something would load them at run
 * time again: an import a bundle leaves external (the build runs the same check, bundle-imports.ts), or a
 * shipped package that depends on them.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_FILES, INLINED_SCOPES } from '../packaging/app-files';
import { runtimeImportsOf } from '../packaging/bundle-imports';

const desktop = join(import.meta.dirname, '..');

interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

const inScope = (name: string) => INLINED_SCOPES.some((scope) => name.startsWith(`${scope}/`));

/** Node's lookup: `node_modules/<name>` in this folder or the nearest folder above it that has one. */
function packageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return realpathSync(dirname(manifest));
    if (dirname(dir) === dir) return undefined;
  }
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

/** What electron-builder collects into app.asar: the production dependencies, all the way down. */
function shippedPackages(): { manifests: Manifest[]; missing: string[] } {
  const seen = new Set<string>();
  const manifests: Manifest[] = [];
  const missing: string[] = [];
  const queue: Array<{ name: string; from: string; optional: boolean }> = Object.keys(
    manifestOf(desktop).dependencies ?? {},
  ).map((name) => ({ name, from: desktop, optional: false }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (inScope(next.name)) continue;
    const dir = packageDir(next.name, next.from);
    if (!dir) {
      if (!next.optional) missing.push(`${next.name} (from ${next.from})`);
      continue;
    }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const manifest = manifestOf(dir);
    manifests.push(manifest);
    for (const name of Object.keys(manifest.dependencies ?? {}))
      queue.push({ name, from: dir, optional: false });
    for (const name of Object.keys(manifest.optionalDependencies ?? {}))
      queue.push({ name, from: dir, optional: true });
  }
  return { manifests, missing };
}

describe("the crash SDK's copies stay out of app.asar", () => {
  it('app.asar leaves out every inlined scope', () => {
    for (const scope of INLINED_SCOPES) expect(APP_FILES).toContain(`!**/node_modules/${scope}/**`);
  });

  it('no shipped package depends on them, so nothing in node_modules loads them', () => {
    const { manifests, missing } = shippedPackages();
    expect(missing).toEqual([]);
    expect(manifests.map((manifest) => manifest.name)).toContain('onnxruntime-node');
    const dependents = manifests.flatMap((manifest) =>
      (['dependencies', 'optionalDependencies', 'peerDependencies'] as const).flatMap((field) =>
        Object.keys(manifest[field] ?? {})
          .filter(inScope)
          .map((name) => `${manifest.name} ${field} ${name}`),
      ),
    );
    expect(dependents).toEqual([]);
  });
});

describe('the build refuses a bundle that loads them at run time', () => {
  const chunk = (fileName: string, extra: Partial<{ code: string; imports: string[] }>) => ({
    type: 'chunk',
    fileName,
    ...extra,
  });

  it('finds an external import, a dynamic import, a require and a bundled __require', () => {
    const found = runtimeImportsOf([
      chunk('main/index.mjs', { imports: ['electron', '@sentry/electron/main'] }),
      chunk('main/lazy.mjs', { code: 'const m = await import("@sentry/node");' }),
      chunk('utility/agent.mjs', { code: "const api = require('@opentelemetry/api');" }),
      chunk('utility/jobs.mjs', { code: 'var otel = __require("@opentelemetry/api");' }),
      chunk('main/static.mjs', { code: 'import { init } from "@sentry/core";' }),
    ]);
    expect(found).toEqual([
      'main/index.mjs: @sentry/electron/main',
      'main/lazy.mjs: @sentry/node',
      'main/static.mjs: @sentry/core',
      'utility/agent.mjs: @opentelemetry/api',
      'utility/jobs.mjs: @opentelemetry/api',
    ]);
  });

  it('passes inlined code, other packages and assets', () => {
    const found = runtimeImportsOf([
      chunk('main/index.mjs', {
        imports: ['electron', 'node:fs', 'sqlite-vec'],
        code: 'const sdk = { name: "sentry.javascript.electron" }; import("./chunk.mjs");',
      }),
      { type: 'asset', fileName: 'main/notes.txt', code: 'require("@sentry/node")' },
    ]);
    expect(found).toEqual([]);
  });
});

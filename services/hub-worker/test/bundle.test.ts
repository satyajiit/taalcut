// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function workerScript(dir: string): string | null {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.js')) files.push(path);
    }
  };
  walk(dir);
  const script = files.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  return script ? readFileSync(script, 'utf8') : null;
}

describe('bundle', () => {
  it('stays under 1 MiB gzip, imports no Node built-in and runs no error registry', () => {
    const out = mkdtempSync(join(tmpdir(), 'taalcut-hub-bundle-'));
    let text: string | null;
    try {
      execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', out], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
        timeout: 120_000,
      });
      text = workerScript(out);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'wrangler dry-run failed';
      throw new Error(`wrangler deploy --dry-run failed: ${message}`, { cause: error });
    }
    expect(text).toBeTruthy();
    if (!text) return;
    expect(gzipSync(text).length).toBeLessThan(1024 * 1024);
    expect(text).not.toMatch(/from ["']node:/);
    expect(text).not.toMatch(/require\(["'](?:node:|fs|crypto|path)["']\)/);
    // @taalcut/core/hub is side-effect free since contract round P3-2: core's defineError (and its registry,
    // whose duplicate check is this message) must not reach the Worker.
    expect(text).not.toContain('is defined twice');
    expect(text).not.toMatch(/\bdefineError\b/);
  }, 180_000);
});

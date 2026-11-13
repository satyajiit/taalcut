// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3: `pnpm dev` builds the renderer again when its build is older than its sources (scripts/renderer-freshness.mjs),
 * so a pull or a merge doesn't leave the window as it was before them.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RENDERER_INPUTS, staleRenderer } from '../scripts/renderer-freshness.mjs';

const INPUTS = ['apps/renderer/src', 'packages/ui/src', 'design/tokens'];

describe('the renderer build against its sources', () => {
  let root = '';
  const dist = () => join(root, 'apps/renderer/dist');
  const write = (path: string, seconds: number) => {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, path);
    utimesSync(file, seconds, seconds);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'taalcut-renderer-freshness-'));
    write('apps/renderer/src/app.tsx', 1_000);
    write('packages/ui/src/templates/views.tsx', 1_000);
    write('design/tokens/tokens.css', 1_000);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is current when it was built after every source', () => {
    write('apps/renderer/dist/index.html', 2_000);
    expect(staleRenderer({ root, dist: dist(), inputs: INPUTS })).toBeNull();
  });

  it('is behind when a source changed after it, and names that source', () => {
    write('apps/renderer/dist/index.html', 2_000);
    write('packages/ui/src/templates/views.tsx', 3_000);
    expect(staleRenderer({ root, dist: dist(), inputs: INPUTS })).toBe('packages/ui/src/templates/views.tsx');
  });

  it('looks past node_modules, and says nothing without a build (the placeholder shows then)', () => {
    write('apps/renderer/dist/index.html', 2_000);
    write('packages/ui/src/node_modules/.vite/deps.js', 3_000);
    expect(staleRenderer({ root, dist: dist(), inputs: INPUTS })).toBeNull();
    rmSync(dist(), { recursive: true });
    expect(staleRenderer({ root, dist: dist(), inputs: INPUTS })).toBeNull();
  });

  it('reads the renderer, the ui kit, core and the design tokens by default', () => {
    expect(RENDERER_INPUTS).toEqual(
      expect.arrayContaining(['apps/renderer/src', 'packages/ui/src', 'packages/core/src', 'design/tokens']),
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADLESS_SHELL as RENDER_SHELL } from '@taalcut/render';

describe('the browser used by Electron journeys', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'taalcut-e2e-shell-'));
    vi.stubEnv('TAALCUT_HEADLESS_SHELL', undefined);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps the lightweight Playwright pin and default cache aligned with render', async () => {
    const { HEADLESS_SHELL, DOWNLOADED_SHELL, SHELL_BINARY } = await import('../e2e/headless-shell');
    expect(HEADLESS_SHELL.version).toBe(RENDER_SHELL.version);
    if (HEADLESS_SHELL.supported) {
      expect(HEADLESS_SHELL.binary).toBe(RENDER_SHELL.binary);
      expect(DOWNLOADED_SHELL.endsWith(RENDER_SHELL.developmentCache)).toBe(true);
      expect(SHELL_BINARY).toBe(join(DOWNLOADED_SHELL, RENDER_SHELL.binary));
    }
  });

  it('passes an explicit executable to the journey instead of the user cache', async () => {
    const binary = join(root, 'chrome-headless-shell');
    writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    vi.stubEnv('TAALCUT_HEADLESS_SHELL', binary);
    const { HEADLESS_SHELL, SHELL_BINARY, shellAvailable } = await import('../e2e/headless-shell');
    expect(SHELL_BINARY).toBe(binary);
    expect(shellAvailable()).toBe(HEADLESS_SHELL.supported);
  });

  it.each(['missing', 'directory', 'not-executable'])('rejects an explicit %s path', async (kind) => {
    const path = kind === 'directory' ? root : join(root, 'chrome-headless-shell');
    if (kind === 'not-executable') {
      writeFileSync(path, 'not an executable');
      chmodSync(path, 0o644);
    }
    vi.stubEnv('TAALCUT_HEADLESS_SHELL', path);
    const { shellAvailable } = await import('../e2e/headless-shell');
    expect(shellAvailable).toThrow(`TAALCUT_HEADLESS_SHELL is not an executable file: ${path}`);
  });
});

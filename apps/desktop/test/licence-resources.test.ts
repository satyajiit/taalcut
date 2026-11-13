// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AfterPackContext } from 'electron-builder';
import { expect, it } from 'vitest';
import { prepareLicenceResources } from '../packaging/licence-resources';

it('makes the packaged vendor licence updateable without changing its bytes or source mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-licences-'));
  try {
    const source = join(root, 'vendor-LICENSE');
    const licences = join(root, 'Taalcut.app', 'Contents', 'Resources', 'licences');
    mkdirSync(licences, { recursive: true });
    writeFileSync(source, 'Vendor terms preserved exactly.\n');
    chmodSync(source, 0o444);
    const copy = join(licences, 'vendor-LICENSE');
    copyFileSync(source, copy);
    prepareLicenceResources({
      appOutDir: root,
      electronPlatformName: 'darwin',
      packager: { appInfo: { productFilename: 'Taalcut' } },
    } as unknown as AfterPackContext);
    expect(statSync(copy).mode & 0o777).toBe(0o644);
    expect(statSync(source).mode & 0o777).toBe(0o444);
    expect(readFileSync(copy)).toEqual(readFileSync(source));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

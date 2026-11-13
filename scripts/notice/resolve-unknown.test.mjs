// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { rowsFromReport } from '../licence-scan.mjs';
import { fillMissingLicences } from './resolve-unknown.mjs';

const APACHE = 'Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n';

function install(root, name, version, files) {
  const dir = join(
    root,
    'node_modules',
    '.pnpm',
    `${name.replace('/', '+')}@${version}`,
    'node_modules',
    ...name.split('/'),
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
}

describe('fill missing licence fields from the installed package', () => {
  test('uses an Apache LICENSE file and a Readme MIT heading, and leaves a stated FSL id alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'notice-licence-'));
    try {
      install(root, '@example/core', '1.2.3', { LICENSE: APACHE });
      install(root, 'combine-errors', '3.0.3', { 'Readme.md': '# combine-errors\n\n## License\n\nMIT\n' });
      install(root, 'sentry', '0.45.0', {
        'LICENSE.md': 'Functional Source License, Version 1.1, Apache 2.0 Future License\n',
      });
      const report = {
        Unknown: [
          { name: '@example/core', versions: ['1.2.3'], license: 'Unknown' },
          { name: 'combine-errors', versions: ['3.0.3'], license: 'Unknown' },
        ],
        'FSL-1.1-Apache-2.0': [{ name: 'sentry', versions: ['0.45.0'], license: 'FSL-1.1-Apache-2.0' }],
      };
      fillMissingLicences(report, root);
      const { rows, failures } = rowsFromReport(report);
      const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
      assert.equal(byName['@example/core'].license, 'Apache-2.0');
      assert.equal(byName['@example/core'].ok, true);
      assert.match(byName['@example/core'].note, /LICENSE is the Apache-2.0 text/);
      assert.equal(byName['combine-errors'].license, 'MIT');
      assert.equal(byName['combine-errors'].ok, true);
      assert.equal(byName.sentry.license, 'FSL-1.1-Apache-2.0');
      assert.equal(failures.map((row) => row.name).join(','), 'sentry');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

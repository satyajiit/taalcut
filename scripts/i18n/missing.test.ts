// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatFinding } from './finding.ts';
import { checkMissing } from './missing.ts';
import { repoRoot } from './paths.ts';

function draftTree(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-missing-'));
  const dir = join(root, 'locales');
  mkdirSync(join(dir, 'hi'), { recursive: true });
  writeFileSync(
    join(dir, 'hi', 'messages.po'),
    'msgid ""\nmsgstr ""\n"Language: hi\\n"\n\nmsgid "Hello"\nmsgstr ""\n',
  );
  return { root, dir };
}

describe('missing translations', () => {
  it('fails a signed-off locale with an empty msgstr', () => {
    const { root, dir } = draftTree();
    const result = checkMissing(root, JSON.stringify({ hi: 'signed-off' }), dir);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.id).toBe('Hello');
    expect(result.errors[0]?.line).toBe(5);
    expect(formatFinding(result.errors[0] ?? { file: '', line: 0, id: '', message: '' })).toMatch(
      /messages\.po:5: Hello: missing translation/,
    );
  });

  it('warns for a draft locale and the process exits 0', () => {
    const { root, dir } = draftTree();
    const status = JSON.stringify({ hi: 'draft' });
    const result = checkMissing(root, status, dir);
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toBe('missing translation');

    const script = [
      `import { checkMissing } from ${JSON.stringify(join(repoRoot(), 'scripts/i18n/missing.ts'))};`,
      `const result = checkMissing(${JSON.stringify(root)}, ${JSON.stringify(status)}, ${JSON.stringify(dir)});`,
      `if (result.warnings.length !== 1) process.exit(2);`,
      `process.exit(result.exitCode);`,
    ].join('\n');
    const proc = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(proc.status).toBe(0);
  });
});

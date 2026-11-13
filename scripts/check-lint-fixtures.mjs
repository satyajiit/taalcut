// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'fixtures', 'lint-violations');
const skipDirs = new Set(['node_modules', 'dist', 'out', 'coverage', '.turbo']);
const spdxPrefix = 'taalcut-__lint_fixture_spdx-';

let failed = false;

// A killed run can leave __lint_fixture_* copies. The next start removes them.
function sweepTree(dir, removed) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!skipDirs.has(ent.name)) sweepTree(path, removed);
      continue;
    }
    if (ent.isFile() && ent.name.startsWith('__lint_fixture_')) {
      unlinkSync(path);
      removed.push(path);
    }
  }
}

function sweepCopies() {
  const removed = [];
  sweepTree(join(root, 'packages'), removed);
  sweepTree(join(root, 'apps'), removed);
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(spdxPrefix) || !name.endsWith('.ts')) continue;
    const path = join(tmpdir(), name);
    unlinkSync(path);
    removed.push(path);
  }
  return removed;
}

function stripAnsi(text) {
  const esc = String.fromCharCode(0x1b);
  return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '');
}

function runTool(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    status: result.status === null ? 1 : result.status,
    stdout,
    stderr,
    text: stripAnsi(`${stdout}\n${stderr}`),
    error: result.error,
  };
}

function oneLine(text, ruleId) {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.includes(ruleId));
  return (line ?? '').replace(/\s+/g, ' ');
}

function assertCaught(name, ruleId, result, acceptStatus = (code) => code !== 0, needles = [ruleId]) {
  const missing = needles.filter((needle) => !result.text.includes(needle));
  if (!acceptStatus(result.status) || missing.length > 0) {
    failed = true;
    console.error(`FAIL ${name}  ${ruleId}`);
    console.error(result.stdout);
    console.error(result.stderr);
    if (result.error) console.error(result.error.message);
    return;
  }
  console.log(`PASS ${name}  ${ruleId}  ${oneLine(result.text, ruleId)}`);
}

function withCopies(pairs, fn) {
  const copied = [];
  try {
    for (const [from, destRel] of pairs) {
      const dest = join(root, destRel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(from, dest);
      copied.push(dest);
    }
    fn();
  } finally {
    for (const dest of copied) {
      if (existsSync(dest)) unlinkSync(dest);
    }
  }
}

function fixture(name) {
  return join(fixtureRoot, name);
}

function checkEslint(name, ruleId, from, destRel, needles) {
  withCopies([[fixture(from), destRel]], () => {
    assertCaught(name, ruleId, runTool('pnpm', ['exec', 'eslint', destRel]), (code) => code !== 0, needles);
  });
}

function checkCruise(name, ruleId, pairs, args) {
  withCopies(pairs, () => {
    assertCaught(
      name,
      ruleId,
      runTool('pnpm', ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', ...args]),
    );
  });
}

function checkSpdx() {
  // The checker skips ^fixtures/lint-violations/, so this copy lives outside the repo.
  const dest = join(tmpdir(), `${spdxPrefix}${process.pid}.ts`);
  try {
    copyFileSync(fixture('missing-spdx/no-header.ts'), dest);
    const result = runTool('node', ['scripts/check-spdx.mjs', dest]);
    const sawHeaderError =
      result.text.includes('no licence header') ||
      result.text.includes('SPDX-License-Identifier: AGPL-3.0-or-later');
    if (result.status !== 1 || !sawHeaderError) {
      failed = true;
      console.error('FAIL missing-spdx  no licence header');
      console.error(result.stdout);
      console.error(result.stderr);
      if (result.error) console.error(result.error.message);
      return;
    }
    const label = result.text.includes('no licence header')
      ? 'no licence header'
      : 'SPDX-License-Identifier: AGPL-3.0-or-later';
    console.log(`PASS missing-spdx  ${label}  ${oneLine(result.text, label)}`);
  } finally {
    if (existsSync(dest)) unlinkSync(dest);
  }
}

/** Core's hub entry is an allowed public path; the files behind it are still refused. */
function checkHubEntry() {
  withCopies(
    [
      [fixture('deep-import/hub-deep.ts'), 'packages/agent/src/__lint_fixture_hub_deep.ts'],
      [fixture('deep-import/hub-entry.ts'), 'packages/agent/src/__lint_fixture_hub_entry.ts'],
    ],
    () => {
      const deep = 'packages/agent/src/__lint_fixture_hub_deep.ts';
      const entry = 'packages/agent/src/__lint_fixture_hub_entry.ts';
      assertCaught(
        'deep-import (hub)',
        'no-restricted-imports',
        runTool('pnpm', ['exec', 'eslint', deep]),
        (code) => code !== 0,
        ['no-restricted-imports', 'never a path inside it'],
      );
      assertCaught(
        'deep-import (hub)',
        'public-api-only',
        runTool('pnpm', ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', deep]),
      );
      assertCaught(
        'hub entry allowed',
        'eslint',
        runTool('pnpm', ['exec', 'eslint', entry]),
        (code) => code === 0,
        [],
      );
      assertCaught(
        'hub entry allowed',
        'depcruise',
        runTool('pnpm', ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', entry]),
        (code) => code === 0,
        [],
      );
    },
  );
}

function main() {
  const stale = sweepCopies();
  if (stale.length > 0) console.log(`removed ${stale.length} stale fixture copies`);

  try {
    checkEslint(
      'max-lines',
      'max-lines',
      'max-lines/over-400.ts',
      'packages/core/src/__lint_fixture_max_lines.ts',
    );

    withCopies([[fixture('deep-import/deep.ts'), 'packages/agent/src/__lint_fixture_deep.ts']], () => {
      const dest = 'packages/agent/src/__lint_fixture_deep.ts';
      assertCaught(
        'deep-import',
        'no-restricted-imports',
        runTool('pnpm', ['exec', 'eslint', dest]),
        (code) => code !== 0,
        ['no-restricted-imports', 'never a path inside it'],
      );
      assertCaught(
        'deep-import',
        'public-api-only',
        runTool('pnpm', ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', dest]),
      );
    });

    checkHubEntry();

    checkCruise(
      'import-cycle',
      'no-circular',
      [
        [fixture('import-cycle/cycle-a.ts'), 'packages/tools/src/__lint_fixture_cycle_a.ts'],
        [fixture('import-cycle/cycle-b.ts'), 'packages/tools/src/__lint_fixture_cycle_b.ts'],
      ],
      ['packages/tools/src/__lint_fixture_cycle_a.ts', 'packages/tools/src/__lint_fixture_cycle_b.ts'],
    );

    checkCruise(
      'layering',
      'layering-core',
      [[fixture('layering/layer.ts'), 'packages/core/src/__lint_fixture_layer.ts']],
      ['packages/core/src/__lint_fixture_layer.ts'],
    );

    checkEslint(
      'provider-sdk',
      'no-restricted-imports',
      'provider-sdk/sdk.ts',
      'packages/agent/src/__lint_fixture_sdk.ts',
      ['no-restricted-imports', 'Only packages/models may import pi-ai or a provider SDK'],
    );

    checkCruise(
      'node-builtin',
      'sandboxed-code-has-no-node',
      [[fixture('node-builtin/node.ts'), 'apps/renderer/src/__lint_fixture_node.ts']],
      ['apps/renderer/src/__lint_fixture_node.ts'],
    );

    checkEslint(
      'hardcoded-string',
      'lingui/no-unlocalized-strings',
      'hardcoded-string/string.tsx',
      'apps/renderer/src/__lint_fixture_string.tsx',
    );

    checkEslint(
      'electron-launch',
      'no-restricted-imports',
      'electron-launch/launch.ts',
      'apps/desktop/e2e/__lint_fixture_launch.ts',
      ['no-restricted-imports', 'no-restricted-syntax', 'launchElectron from e2e/launch.ts'],
    );

    checkSpdx();
  } finally {
    const left = sweepCopies();
    if (left.length > 0) {
      failed = true;
      console.error(`leftover fixture copies:\n${left.join('\n')}`);
    }
  }

  if (failed) process.exit(1);
}

main();

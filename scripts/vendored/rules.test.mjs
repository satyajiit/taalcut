// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globCovers, vendoredViolations, workspaceGlobs } from './rules.mjs';

const YAML = `# header
packages:
  - apps/*
  - 'hub'
  - third_party/*   # vendored

allowBuilds:
  electron: true
`;

const mascot = { dir: 'third_party/page-mascot', name: '@taalcut-vendor/page-mascot' };
const linkedLock = `importers:
  packages/ui:
    dependencies:
      '@taalcut-vendor/page-mascot':
        specifier: workspace:*
        version: link:../../third_party/page-mascot
packages:
  temp-file@3.4.0:
    resolution: {integrity: sha512-x}
`;

function repo(overrides = {}) {
  return {
    globs: ['apps/*', 'packages/*', 'third_party/*'],
    manifests: [
      { path: 'package.json', json: { devDependencies: { vitest: '5.0.4' } } },
      {
        path: 'packages/ui/package.json',
        json: {
          dependencies: { '@taalcut-vendor/page-mascot': 'workspace:*', '@taalcut/core': 'workspace:*' },
        },
      },
    ],
    vendored: [mascot],
    lockfile: linkedLock,
    ...overrides,
  };
}

describe('workspaceGlobs', () => {
  it('reads only the packages list, quoted or not, ignoring comments', () => {
    assert.deepEqual(workspaceGlobs(YAML), ['apps/*', 'hub', 'third_party/*']);
  });
});

describe('globCovers', () => {
  it('matches one level under a /* glob, or the exact directory', () => {
    assert.equal(globCovers('third_party/*', 'third_party/react-bits'), true);
    assert.equal(globCovers('third_party/*', 'third_party/react-bits/src'), false);
    assert.equal(globCovers('hub', 'hub'), true);
    assert.equal(globCovers('packages/*', 'third_party/react-bits'), false);
  });
});

describe('vendoredViolations', () => {
  it('passes a vendored package linked with workspace:*', () => {
    assert.deepEqual(vendoredViolations(repo()), []);
  });

  it('fails a file: dependency anywhere in the workspace', () => {
    const manifests = [
      {
        path: 'packages/audio/package.json',
        json: { dependencies: { stretch: 'file:../../third_party/x' } },
      },
    ];
    const problems = vendoredViolations(repo({ manifests }));
    assert.equal(problems.length, 1);
    assert.match(
      problems[0] ?? '',
      /packages\/audio\/package\.json dependencies\.stretch .*file: dependency is a copy/,
    );
  });

  it('fails a vendored package depended on other than with workspace:', () => {
    const manifests = [
      {
        path: 'packages/ui/package.json',
        json: { devDependencies: { '@taalcut-vendor/page-mascot': 'link:../x' } },
      },
    ];
    assert.match(
      vendoredViolations(repo({ manifests }))[0] ?? '',
      /depend on vendored code with "workspace:\*"/,
    );
  });

  it('fails a third_party package that no workspace glob covers', () => {
    const problems = vendoredViolations(repo({ globs: ['apps/*', 'packages/*'] }));
    assert.deepEqual(problems, [
      "third_party/page-mascot (@taalcut-vendor/page-mascot) is not a workspace package: add it to pnpm-workspace.yaml's packages",
    ]);
  });

  it('fails an install that still points at a copy, and passes one linked to third_party', () => {
    const path = 'packages/ui/node_modules/@taalcut-vendor/page-mascot';
    const linked = [{ path, target: 'third_party/page-mascot' }];
    assert.deepEqual(vendoredViolations(repo({ installed: linked })), []);
    const copy = 'node_modules/.pnpm/@taalcut-vendor+page-mascot@file+third_party+page-mascot/node_modules/x';
    assert.deepEqual(vendoredViolations(repo({ installed: [{ path, target: copy }] })), [
      `${path} is ${copy}, not the vendored source: a stale install, run pnpm install`,
    ]);
  });

  it('fails a lockfile that still resolves a file: copy, and only that', () => {
    const lockfile = `${linkedLock}
  '@taalcut-vendor/page-mascot@file:third_party/page-mascot':
    resolution: {directory: third_party/page-mascot, type: directory}
`;
    const problems = vendoredViolations(repo({ lockfile }));
    assert.equal(problems.length, 2);
    assert.ok(problems.every((problem) => problem.startsWith('pnpm-lock.yaml:')));
  });
});

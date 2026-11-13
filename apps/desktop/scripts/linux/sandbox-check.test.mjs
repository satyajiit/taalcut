// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** node --test apps/desktop/scripts/linux/sandbox-check.test.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEV_PROFILE, INSTALL_COMMAND, RESTRICT_SYSCTL, sandboxHint } from './sandbox-check.mjs';

const sysctl = (value) => (path) => {
  assert.equal(path, RESTRICT_SYSCTL);
  if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return `${value}\n`;
};

test('says what to install when the kernel restricts user namespaces and the profile is missing', () => {
  const hint = sandboxHint({ platform: 'linux', read: sysctl(1), exists: () => false });
  assert.match(hint, /apparmor_restrict_unprivileged_userns=1/);
  assert.ok(hint.includes(INSTALL_COMMAND));
});

test('says nothing once the profile is installed, without the restriction, or off Linux', () => {
  assert.equal(sandboxHint({ platform: 'linux', read: sysctl(1), exists: (p) => p === DEV_PROFILE }), null);
  assert.equal(sandboxHint({ platform: 'linux', read: sysctl(0), exists: () => false }), null);
  assert.equal(sandboxHint({ platform: 'linux', read: sysctl(undefined), exists: () => false }), null);
  assert.equal(sandboxHint({ platform: 'darwin', read: sysctl(1), exists: () => false }), null);
});

test('the profile parses', { skip: !hasParser() && 'apparmor_parser not installed' }, () => {
  const profile = fileURLToPath(new URL('./taalcut-dev.apparmor', import.meta.url));
  execFileSync('apparmor_parser', ['--skip-kernel-load', '--skip-cache', '--skip-read-cache', profile]);
});

function hasParser() {
  try {
    execFileSync('apparmor_parser', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

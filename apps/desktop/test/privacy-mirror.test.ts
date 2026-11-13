// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readPrivacyMirror,
  reconcilePrivacyMirror,
  writePrivacyMirror,
  type PrivacyMirror,
} from '../src/main/crash/privacy-mirror';

const roots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-privacy-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('privacy mirror', () => {
  it('is off when the file is missing, invalid or unreadable', () => {
    const dir = scratch();
    const file = join(dir, 'privacy.json');
    expect(readPrivacyMirror(file)).toEqual({ crashReports: false, localOnly: false, changedAt: 0 });
    writeFileSync(file, '{', { mode: 0o600 });
    expect(readPrivacyMirror(file).crashReports).toBe(false);
    writeFileSync(file, JSON.stringify({ crashReports: 'yes', localOnly: false, changedAt: 1 }));
    expect(readPrivacyMirror(file).crashReports).toBe(false);
    rmSync(file);
    mkdirSync(file);
    expect(readPrivacyMirror(file).crashReports).toBe(false);
    rmSync(file, { recursive: true });
    writeFileSync(file, '{"crashReports":true,"localOnly":false,"changedAt":1}');
    chmodSync(file, 0o000);
    expect(readPrivacyMirror(file)).toEqual({ crashReports: false, localOnly: false, changedAt: 0 });
    chmodSync(file, 0o600);
  });

  it('writes mode 0600 and reads the same mirror back', () => {
    const file = join(scratch(), 'privacy.json');
    const mirror: PrivacyMirror = { crashReports: true, localOnly: false, changedAt: 9 };
    writePrivacyMirror(file, mirror);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readPrivacyMirror(file)).toEqual(mirror);
  });

  it('lets the settings store win and rewrites the file', () => {
    const file = join(scratch(), 'nested', 'privacy.json');
    writePrivacyMirror(file, { crashReports: false, localOnly: false, changedAt: 0 });
    const written = reconcilePrivacyMirror(
      { crashReports: { enabled: true, changedAt: 40 }, localOnly: true },
      file,
    );
    expect(written).toEqual({ crashReports: true, localOnly: true, changedAt: 40 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(written);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

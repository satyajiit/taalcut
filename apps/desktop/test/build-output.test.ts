// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a build's output is (packaging/build-output.ts), and what scripts/verify-signature.mjs checks after a
 * package: the app the build just made, in its flavour's output directory, never a release app left from before.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtFlavour, outputDir, packagedArtifacts } from '../packaging/build-output';
import { builderConfig } from '../packaging/builder-config';

const desktopDir = join(import.meta.dirname, '..');
let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'taalcut-build-output-'));
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function built(flavour: string): void {
  mkdirSync(join(project, 'out'), { recursive: true });
  writeFileSync(join(project, 'out', 'build-info.json'), JSON.stringify({ flavour }));
}

function app(output: string): string {
  const path = join(project, output, 'mac-arm64', 'Taalcut.app');
  mkdirSync(join(path, 'Contents'), { recursive: true });
  return path;
}

function dmg(output: string, name: string): string {
  const path = join(project, output, name);
  writeFileSync(path, '');
  return path;
}

describe('packagedArtifacts', () => {
  it("names the test build's app after a test package, not a release app left from before", () => {
    built('test');
    app('release');
    dmg('release', 'Taalcut-0.0.0-arm64.dmg');
    const testApp = app(join('release', 'test'));
    expect(packagedArtifacts(project, {}, { appOnly: true })).toEqual([testApp]);
  });

  it('follows TAALCUT_PACKAGE_OUTPUT, as electron-builder does', () => {
    built('test');
    const next = app(join('release', 'update'));
    const env = { TAALCUT_PACKAGE_OUTPUT: join('release', 'update') };
    expect(packagedArtifacts(project, env, { appOnly: true })).toEqual([next]);
  });

  it('takes an absolute TAALCUT_PACKAGE_OUTPUT as it is, as electron-builder does', () => {
    built('release');
    const elsewhere = mkdtempSync(join(tmpdir(), 'taalcut-build-output-elsewhere-'));
    try {
      const path = join(elsewhere, 'mac-arm64', 'Taalcut.app');
      mkdirSync(join(path, 'Contents'), { recursive: true });
      expect(packagedArtifacts(project, { TAALCUT_PACKAGE_OUTPUT: elsewhere }, { appOnly: true })).toEqual([
        path,
      ]);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("adds the output directory's DMGs unless only the app was built", () => {
    built('release');
    const releaseApp = app('release');
    const image = dmg('release', 'Taalcut-0.0.0-arm64.dmg');
    expect(packagedArtifacts(project)).toEqual([releaseApp, image]);
    expect(packagedArtifacts(project, {}, { appOnly: true })).toEqual([releaseApp]);
  });

  it('is empty when nothing was packaged, and needs the build info to know the flavour', () => {
    expect(() => packagedArtifacts(project)).toThrow(/build-info\.json not found: run the desktop build/);
    built('test');
    expect(packagedArtifacts(project)).toEqual([]);
    built('debug');
    expect(() => builtFlavour(project)).toThrow(/flavour must be 'release' or 'test', got "debug"/);
  });
});

describe('one output directory for electron-builder and the signature check', () => {
  const settings = {
    flavour: 'test',
    updateFeedUrl: undefined,
    updateChannel: undefined,
    crashDsn: undefined,
    telemetryUrl: undefined,
  } as const;

  it('is where builderConfig sends electron-builder', () => {
    const env = { TAALCUT_PACKAGE_OUTPUT: join('release', 'beta-1') };
    expect(builderConfig({}, project, settings).directories?.output).toBe(outputDir(settings));
    expect(builderConfig(env, project, settings).directories?.output).toBe(outputDir(settings, env));
  });

  it('is what package:dir verifies: the app it built, whatever the flavour', () => {
    const { scripts } = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(scripts['package:dir']).toMatch(
      /--dir --publish never && node scripts\/verify-signature\.mjs --built-app$/,
    );
    expect(scripts.package).toMatch(/&& node scripts\/verify-signature\.mjs$/);
  });

  it('loads in plain Node, which is how verify-signature.mjs imports it', () => {
    const url = pathToFileURL(join(desktopDir, 'packaging', 'build-output.ts')).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(url)}); console.log(typeof m.packagedArtifacts)`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.stdout.trim(), result.stderr).toBe('function');
  });
});

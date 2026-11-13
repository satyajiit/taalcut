// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseChannelYml, renderChannelYml, type ChannelEntry } from './channel-yml.ts';
import { run } from './cli.ts';
import { testKeyPem } from './key-commands.ts';
import { publishRelease, type PublishInput } from './publish.ts';
import { notesProblems, releaseNotesJson } from './release-notes.ts';
import { dirReleaseStore, ghReleaseStore, type ReleaseStore } from './release-store.ts';
import { promoteRelease, pullRelease } from './rollout.ts';
import { compareVersions } from './versions.ts';

const REPO = 'https://github.com/taalcut/taalcut';
const BASE = `${REPO}/releases/download`;
const SHA = `${'A'.repeat(86)}==`;

let work: string;
let store: ReleaseStore;
let root: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'taalcut-release-'));
  root = join(work, 'github');
  store = dirReleaseStore(root);
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

/** release.yml's artefacts for `version`, and its notes. */
function build(version: string, notes: Record<string, string> = { en: `- ${version} is out` }) {
  const artifacts = join(work, `artifacts-${version}`);
  const notesDir = join(work, `notes-${version}`);
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(join(artifacts, `Taalcut-${version}-arm64-mac.zip`), `zip of ${version}`);
  writeFileSync(join(artifacts, `Taalcut-${version}-arm64-mac.zip.blockmap`), `blockmap of ${version}`);
  writeFileSync(join(artifacts, `Taalcut-${version}-arm64.dmg`), `dmg of ${version}`);
  for (const [locale, text] of Object.entries(notes)) writeFileSync(join(notesDir, `${locale}.md`), text);
  return { artifacts, notes: notesDir };
}

function publish(channel: 'stable' | 'beta', version: string, stage = 10, extra: Partial<PublishInput> = {}) {
  return publishRelease(store, {
    channel,
    version,
    ...build(version),
    stage,
    downloadBase: BASE,
    repoUrl: REPO,
    now: () => new Date('2026-10-14T10:00:00.000Z'),
    ...extra,
  });
}

const served = async (channel: 'stable' | 'beta') => {
  const text = await store.readText(
    `channel-${channel}`,
    channel === 'stable' ? 'latest-mac.yml' : 'beta-mac.yml',
  );
  return text ? parseChannelYml(text) : undefined;
};
const file = (tag: string, name: string) => readFileSync(join(root, tag, name), 'utf8');

describe('channel yml', () => {
  const entry: ChannelEntry = {
    version: '1.3.0-beta.4',
    url: `${BASE}/v1.3.0-beta.4/Taalcut-1.3.0-beta.4-arm64-mac.zip`,
    sha512: SHA,
    size: 12,
    blockMapSize: 3,
    releaseDate: '2026-10-14T10:00:00.000Z',
    releaseNotes: JSON.stringify({ v: 1, notes: { en: "- It's new\n- **Bold**" } }),
    stagingPercentage: 10,
  };

  it("round-trips the one shape electron-updater reads, with the website's version line first", () => {
    const text = renderChannelYml(entry);
    expect(text.split('\n')[0]).toBe('version: 1.3.0-beta.4');
    expect(text).toContain('releaseNotes: \'{"v":1,"notes":{"en":"- It\'\'s new\\n- **Bold**"}}\'');
    expect(parseChannelYml(text)).toEqual(entry);
  });

  it('refuses what it would not write: other keys, two files, a URL without the version, a bad stage', () => {
    expect(() => parseChannelYml(`${renderChannelYml(entry)}evil: true\n`)).toThrow(/unexpected line/);
    const two = renderChannelYml(entry).replace('path:', `  - url: '${entry.url}'\npath:`);
    expect(() => parseChannelYml(two)).toThrow(/exactly one file/);
    expect(() => renderChannelYml({ ...entry, url: `${BASE}/v1/Taalcut-arm64-mac.zip` })).toThrow(
      /must name/,
    );
    expect(() => renderChannelYml({ ...entry, stagingPercentage: 100 })).toThrow(/1–99/);
    expect(() =>
      renderChannelYml({ ...entry, url: 'http://evil.example/Taalcut-1.3.0-beta.4-arm64-mac.zip' }),
    ).toThrow(/https/);
  });

  it('orders versions as semver does', () => {
    expect(compareVersions('1.3.0', '1.3.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0-beta.10', '1.3.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.9', '1.3.0-beta.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('release notes', () => {
  it('turns the four languages into the JSON the app reads, English required', () => {
    const { notes } = build('1.0.0', { en: '- One\r\n- **Two**', hi: '- एक' });
    expect(JSON.parse(releaseNotesJson(notes, REPO))).toEqual({
      v: 1,
      notes: { en: '- One\n- **Two**', hi: '- एक' },
    });
    const missing = join(work, 'empty-notes');
    mkdirSync(missing);
    expect(() => releaseNotesJson(missing, REPO)).toThrow(/en\.md is required/);
  });

  it('refuses HTML, images and links outside the project', () => {
    expect(notesProblems(`See ${REPO}/issues/1`, REPO)).toEqual([]);
    expect(notesProblems('<b>x</b> ![a](b) https://evil.example/x', REPO)).toEqual([
      'has HTML (notes are plain text)',
      'has an image',
      `links to https://evil.example/x (only ${REPO}/… is allowed)`,
    ]);
    const { notes } = build('1.0.1', { en: '<script>alert(1)</script>' });
    expect(() => releaseNotesJson(notes, REPO)).toThrow(/en\.md has HTML/);
  });
});

describe('publish', () => {
  it('creates v<version>, points the channel at it at 10%, keeps a history entry, replaces the DMG', async () => {
    const written = await publish('beta', '1.3.0-beta.1');
    expect(written).toHaveLength(2);
    const release = await store.release('v1.3.0-beta.1');
    expect(release).toMatchObject({ title: 'Taalcut 1.3.0-beta.1', prerelease: true });
    expect(release?.assets).toEqual([
      'SHA256SUMS',
      'Taalcut-1.3.0-beta.1-arm64-mac.zip',
      'Taalcut-1.3.0-beta.1-arm64-mac.zip.blockmap',
      'Taalcut-1.3.0-beta.1-arm64.dmg',
      'release-notes-en.md',
    ]);
    // The website's download page will print the DMG's digest from this file (website/SPEC.md, open items).
    const sums = file('v1.3.0-beta.1', 'SHA256SUMS');
    expect(sums).toMatch(/^[0-9a-f]{64} {2}Taalcut-1\.3\.0-beta\.1-arm64-mac\.zip$/m);
    expect(sums).toMatch(/^[0-9a-f]{64} {2}Taalcut-1\.3\.0-beta\.1-arm64\.dmg$/m);
    expect(await served('beta')).toMatchObject({
      version: '1.3.0-beta.1',
      url: `${BASE}/v1.3.0-beta.1/Taalcut-1.3.0-beta.1-arm64-mac.zip`,
      size: 'zip of 1.3.0-beta.1'.length,
      blockMapSize: 'blockmap of 1.3.0-beta.1'.length,
      stagingPercentage: 10,
    });
    expect(
      parseChannelYml(file('channel-beta', 'history-1.3.0-beta.1-mac.yml')).stagingPercentage,
    ).toBeUndefined();
    expect(file('channel-beta', 'Taalcut-beta-mac-arm64.dmg')).toBe('dmg of 1.3.0-beta.1');
    expect(await served('stable')).toBeUndefined();
  });

  it('never publishes a version twice, below what the channel serves, or on the wrong channel', async () => {
    await publish('beta', '1.3.0-beta.2');
    await expect(publish('beta', '1.3.0-beta.2')).rejects.toThrow(/never published twice/);
    await expect(publish('beta', '1.3.0-beta.1')).rejects.toThrow(/isn't newer/);
    await expect(publish('stable', '1.3.0-beta.3')).rejects.toThrow(/plain version/);
    await expect(publish('beta', '1.3.0')).rejects.toThrow(/x\.y\.z-beta\.N/);
  });

  it('gives beta testers a stable release only while it is newer than the beta', async () => {
    await publish('beta', '1.3.0-beta.4');
    await publish('stable', '1.3.0', 100);
    expect((await served('beta'))?.version).toBe('1.3.0');
    expect((await served('stable'))?.stagingPercentage).toBeUndefined();
    expect(file('channel-stable', 'Taalcut-mac-arm64.dmg')).toBe('dmg of 1.3.0');
    // The beta's fixed DMG stays the beta build.
    expect(file('channel-beta', 'Taalcut-beta-mac-arm64.dmg')).toBe('dmg of 1.3.0-beta.4');
    await publish('beta', '1.4.0-beta.1');
    await publish('stable', '1.3.1');
    expect((await served('beta'))?.version).toBe('1.4.0-beta.1');
  });
});

describe('promote', () => {
  it('raises the rollout 10 → 50 → 100 (no field at 100), never down, only for the version served', async () => {
    await publish('beta', '1.3.0-beta.1');
    await promoteRelease(store, { channel: 'beta', version: '1.3.0-beta.1', stage: 50 });
    expect((await served('beta'))?.stagingPercentage).toBe(50);
    await expect(
      promoteRelease(store, { channel: 'beta', version: '1.3.0-beta.1', stage: 10 }),
    ).rejects.toThrow(/only goes up/);
    await expect(
      promoteRelease(store, { channel: 'beta', version: '1.3.0-beta.9', stage: 100 }),
    ).rejects.toThrow(/serves 1\.3\.0-beta\.1/);
    await promoteRelease(store, { channel: 'beta', version: '1.3.0-beta.1', stage: 100 });
    expect((await served('beta'))?.stagingPercentage).toBeUndefined();
  });

  it("takes beta's copy of a stable release along", async () => {
    await publish('stable', '1.3.0');
    expect((await served('beta'))?.stagingPercentage).toBe(10);
    await promoteRelease(store, { channel: 'stable', version: '1.3.0', stage: 100 });
    expect((await served('beta'))?.stagingPercentage).toBeUndefined();
  });
});

describe('pull (P3-B9: a broken build at 10% is pulled and clients stay on the last good version)', () => {
  it('re-points the channel at the last good version, marks the bad release and restores the DMG', async () => {
    await publish('beta', '1.3.0-beta.1', 100);
    await publish('beta', '1.3.0-beta.2', 10);
    const written = await pullRelease(store, {
      channel: 'beta',
      badVersion: '1.3.0-beta.2',
      toVersion: '1.3.0-beta.1',
      reason: 'It does not start on some Macs.',
    });
    expect(written).toContain('v1.3.0-beta.2: marked (pulled)');
    expect(await served('beta')).toMatchObject({ version: '1.3.0-beta.1' });
    expect((await served('beta'))?.stagingPercentage).toBeUndefined();
    expect(await store.release('v1.3.0-beta.2')).toMatchObject({ title: 'Taalcut 1.3.0-beta.2 (pulled)' });
    expect((await store.release('v1.3.0-beta.2'))?.notes).toMatch(/^Pulled: It does not start/);
    expect(file('channel-beta', 'Taalcut-beta-mac-arm64.dmg')).toBe('dmg of 1.3.0-beta.1');
    // Its files stay for the people who have it.
    expect((await store.release('v1.3.0-beta.2'))?.assets).toContain('Taalcut-1.3.0-beta.2-arm64-mac.zip');
  });

  it('only goes back to an older version the channel served and that was not pulled itself', async () => {
    await publish('beta', '1.3.0-beta.1', 100);
    await publish('beta', '1.3.0-beta.2', 100);
    await publish('beta', '1.3.0-beta.3', 10);
    const pull = (badVersion: string, toVersion: string) =>
      pullRelease(store, { channel: 'beta', badVersion, toVersion, reason: 'broken' });
    await expect(pull('1.3.0-beta.3', '1.3.0-beta.4')).rejects.toThrow(/older version/);
    await expect(pull('1.3.0-beta.2', '1.3.0-beta.1')).rejects.toThrow(/doesn't serve/);
    await expect(pull('1.3.0-beta.3', '1.2.0-beta.1')).rejects.toThrow(/no release/);
    await pull('1.3.0-beta.3', '1.3.0-beta.2');
    await publish('beta', '1.3.0-beta.4', 10);
    await store.editRelease('v1.3.0-beta.2', { title: 'Taalcut 1.3.0-beta.2 (pulled)' });
    await expect(pull('1.3.0-beta.4', '1.3.0-beta.2')).rejects.toThrow(/pulled itself/);
    await expect(
      pullRelease(store, {
        channel: 'beta',
        badVersion: '1.3.0-beta.4',
        toVersion: '1.3.0-beta.1',
        reason: ' ',
      }),
    ).rejects.toThrow(/reason/);
  });
});

describe('the gh store and the command line', () => {
  it('drives GitHub Releases through gh: a never-latest prerelease, clobbering uploads, a missing release', async () => {
    const calls: string[][] = [];
    const gh = ghReleaseStore('taalcut/taalcut', async (_command, args) => {
      calls.push([...args]);
      if (args[1] === 'view') throw Object.assign(new Error('failed'), { stderr: 'release not found' });
      return { stdout: '' };
    });
    expect(await gh.release('channel-beta')).toBeUndefined();
    await gh.ensure('channel-beta', { title: 'Taalcut beta channel', notes: 'n', prerelease: true });
    await gh.upload('channel-beta', ['/tmp/x/beta-mac.yml']);
    expect(calls.slice(1)).toEqual([
      [
        'release',
        'view',
        'channel-beta',
        '--json',
        'name,body,isPrerelease,assets',
        '--repo',
        'taalcut/taalcut',
      ],
      [
        'release',
        'create',
        'channel-beta',
        '--title',
        'Taalcut beta channel',
        '--notes',
        'n',
        '--prerelease',
        '--latest=false',
        '--repo',
        'taalcut/taalcut',
      ],
      ['release', 'upload', 'channel-beta', '/tmp/x/beta-mac.yml', '--clobber', '--repo', 'taalcut/taalcut'],
    ]);
    expect(() => ghReleaseStore('not a repo')).toThrow(/not a repository/);
    await expect(gh.readText('../etc', 'passwd')).rejects.toThrow(/unsafe/);
  });

  it('runs publish, promote and pull from the command line against a folder', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) };
    const env = { TAALCUT_UPDATE_SIGNING_KEY: testKeyPem() };
    const built = build('2.0.0-beta.1');
    const args = ['--dir', root, '--channel', 'beta', '--version', '2.0.0-beta.1'];
    expect(
      await run(
        [
          'publish',
          ...args,
          '--artifacts',
          built.artifacts,
          '--notes',
          built.notes,
          '--download-base',
          BASE,
          '--repo-url',
          REPO,
        ],
        io,
        env,
      ),
    ).toBe(0);
    expect(await run(['promote', ...args, '--stage', '100'], io, env)).toBe(0);
    expect(
      await run(
        [
          'pull',
          '--dir',
          root,
          '--channel',
          'beta',
          '--bad-version',
          '2.0.0-beta.1',
          '--to-version',
          '2.0.0-beta.2',
          '--reason',
          'x',
        ],
        io,
        env,
      ),
    ).toBe(1);
    expect(err.join('')).toMatch(/older version/);
    expect(await run(['nonsense', '--dir', root], io)).toBe(2);
    expect(await run(['promote', '--channel', 'beta'], io)).toBe(1);
    expect(out.join('')).toContain('channel-beta/beta-mac.yml: 2.0.0-beta.1 at 100%');
  });
});

const workflowText = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', '..', '.github', 'workflows', name), 'utf8');

describe('release.yml', () => {
  it('builds the taalcut tool before packaging and refuses to package a release without it', () => {
    const workflow = workflowText('release.yml');
    const build = workflow.indexOf('run: native/taalcut-cli/build.sh');
    const packaging = workflow.indexOf('- name: Package, sign, notarise and staple');
    expect(build).toBeGreaterThan(-1);
    expect(packaging).toBeGreaterThan(build);
    expect(workflow.slice(packaging)).toContain('export TAALCUT_REQUIRE_CLI=1');
  });

  it('signs only inside the release environment, which holds the secrets (SB-41)', () => {
    const workflow = workflowText('release.yml');
    const job = workflow.indexOf('\n  dmg:\n');
    const steps = workflow.indexOf('\n    steps:\n', job);
    expect(job).toBeGreaterThan(-1);
    expect(workflow.slice(job, steps + 1)).toContain('\n    environment: release\n');
  });
});

describe('the channel workflows', () => {
  it('all wait for the release environment', () => {
    for (const name of ['publish-release.yml', 'promote-release.yml', 'pull-release.yml']) {
      expect(workflowText(name), name).toContain('\n    environment: release\n');
    }
  });

  it('publish only a green Release run built from main (SB-41)', () => {
    expect(workflowText('publish-release.yml')).toContain(
      'select(.workflowName == "Release" and .conclusion == "success" and .headBranch == "main")',
    );
  });
});

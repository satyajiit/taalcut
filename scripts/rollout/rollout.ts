// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * promote-release.yml and pull-release.yml (docs/release.md, "Staged rollout", "Pulling a bad build").
 *
 * Promote raises the rollout of the version a channel serves (10 → 50 → 100; at 100 the field goes): raising
 * only adds people, because electron-updater's cohort is a fixed id per install. It refuses any other version, so
 * a stale run can't re-point the channel.
 *
 * Pull re-points the channel at an older, unpulled version's history entry (at 100%). People who haven't taken
 * the bad build see nothing newer and stay; people who have it stay on it until a higher version ships (no client
 * ever downgrades). The bad release is marked "(pulled)" with the reason and never deleted (its notes still
 * matter to whoever has it), and the channel's fixed-name DMG goes back to the good version. A stable pull also
 * re-points beta-mac.yml when that served the same bad version.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChannelYml, renderChannelYml } from './channel-yml.ts';
import { stageField } from './publish.ts';
import type { ReleaseStore } from './release-store.ts';
import { channelAssets, compareVersions, PULLED_MARK, versionAssets, type PublicChannel } from './versions.ts';

export async function promoteRelease(
  store: ReleaseStore,
  input: { readonly channel: PublicChannel; readonly version: string; readonly stage: number },
): Promise<string[]> {
  const written: string[] = [];
  const channels: PublicChannel[] = input.channel === 'stable' ? ['stable', 'beta'] : ['beta'];
  for (const channel of channels) {
    const files = channelAssets(channel);
    const text = await store.readText(files.tag, files.yml);
    const served = text ? parseChannelYml(text) : undefined;
    if (served?.version !== input.version) {
      // Beta carries a stable release only while it is the newest; anything else there is beta's own.
      if (channel !== input.channel) continue;
      throw new Error(`${files.yml} serves ${served?.version ?? 'nothing'}, not ${input.version}`);
    }
    const current = served.stagingPercentage ?? 100;
    if (input.stage < current) throw new Error(`${input.version} is at ${current}%; a rollout only goes up`);
    const { stagingPercentage: _old, ...entry } = served;
    await uploadText(store, files.tag, files.yml, renderChannelYml({ ...entry, ...stageField(input.stage) }));
    written.push(`${files.tag}/${files.yml}: ${input.version} at ${input.stage}%`);
  }
  return written;
}

export async function pullRelease(
  store: ReleaseStore,
  input: {
    readonly channel: PublicChannel;
    readonly badVersion: string;
    readonly toVersion: string;
    readonly reason: string;
  },
): Promise<string[]> {
  if (compareVersions(input.toVersion, input.badVersion) >= 0) {
    throw new Error(`pull goes back to an older version: ${input.toVersion} isn't older than ${input.badVersion}`);
  }
  if (!input.reason.trim()) throw new Error('a pull needs a reason (it goes into the release notes)');
  const bad = versionAssets(input.badVersion);
  const good = versionAssets(input.toVersion);
  const goodRelease = await store.release(good.tag);
  if (!goodRelease) throw new Error(`no release ${good.tag}`);
  if (goodRelease.title.includes(PULLED_MARK)) throw new Error(`${good.tag} was pulled itself`);
  const badRelease = await store.release(bad.tag);
  if (!badRelease) throw new Error(`no release ${bad.tag}`);

  const written: string[] = [];
  const channels: PublicChannel[] = input.channel === 'stable' ? ['stable', 'beta'] : ['beta'];
  for (const channel of channels) {
    const files = channelAssets(channel);
    const text = await store.readText(files.tag, files.yml);
    if (!text || parseChannelYml(text).version !== input.badVersion) {
      if (channel !== input.channel) continue;
      throw new Error(`${files.yml} doesn't serve ${input.badVersion}`);
    }
    const history = await store.readText(files.tag, files.history(input.toVersion));
    if (!history) throw new Error(`${files.tag} never served ${input.toVersion} (no ${files.history(input.toVersion)})`);
    const entry = parseChannelYml(history);
    if (entry.version !== input.toVersion) throw new Error(`${files.history(input.toVersion)} names ${entry.version}`);
    await uploadText(store, files.tag, files.yml, renderChannelYml(entry));
    written.push(`${files.tag}/${files.yml}: back to ${input.toVersion}`);
    if (channel === input.channel) written.push(...(await restoreDmg(store, channel, good.tag, good.dmg)));
  }
  if (!badRelease.title.includes(PULLED_MARK)) {
    await store.editRelease(bad.tag, {
      title: `${badRelease.title} ${PULLED_MARK}`,
      notes: `Pulled: ${input.reason.trim()}\n\nUpdates went back to ${input.toVersion}; a fixed version follows.\n\n${badRelease.notes}`,
    });
    written.push(`${bad.tag}: marked ${PULLED_MARK}`);
  }
  return written;
}

async function restoreDmg(store: ReleaseStore, channel: PublicChannel, tag: string, dmg: string): Promise<string[]> {
  const files = channelAssets(channel);
  const work = mkdtempSync(join(tmpdir(), 'taalcut-pull-'));
  try {
    const fixed = join(work, files.dmg);
    if (!(await store.download(tag, dmg, fixed))) throw new Error(`${tag} has no ${dmg}`);
    await store.upload(files.tag, [fixed]);
    return [`${files.tag}/${files.dmg}: from ${tag}`];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function uploadText(store: ReleaseStore, tag: string, name: string, text: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'taalcut-yml-'));
  try {
    const file = join(work, name);
    writeFileSync(file, text);
    await store.upload(tag, [file]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

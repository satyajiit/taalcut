// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * publish-release.yml's work (docs/release.md, "Workflows"): a signed build becomes release v<version> (zip,
 * blockmap, DMG, SHA256SUMS, the notes per language), the channel's yml points at it at the first stage of the
 * rollout, history-<version>-mac.yml keeps that entry for a later pull, and the channel's fixed-name DMG is
 * replaced. A stable release is also written into beta-mac.yml when it is newer than the current beta, so beta
 * testers get stable releases too (electron-updater reads one file per channel). A version is never published
 * twice, and never below what the channel serves.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChannelYml, renderChannelYml, type ChannelEntry } from './channel-yml.ts';
import { NOTES_LOCALES, releaseNotesJson } from './release-notes.ts';
import type { ReleaseStore } from './release-store.ts';
import { sourceArtifacts } from './source-artifacts.ts';
import {
  channelAssets,
  checkChannelVersion,
  compareVersions,
  versionAssets,
  type PublicChannel,
} from './versions.ts';

export interface PublishInput {
  readonly channel: PublicChannel;
  readonly version: string;
  /** Holds Taalcut-<version>-arm64-mac.zip, its .blockmap and Taalcut-<version>-arm64.dmg (release.yml's artefacts). */
  readonly artifacts: string;
  /** GitHub publications require the verified FFmpeg source archive; isolated test feeds may omit it. */
  readonly requireSource?: boolean;
  /** release-notes/<version>/ with en.md (required), hi.md, es.md, pt-BR.md. */
  readonly notes: string;
  /** First stage, 1–100 (100: everyone). */
  readonly stage: number;
  /** https://github.com/<owner>/<repo>/releases/download (or a test feed's root). */
  readonly downloadBase: string;
  /** https://github.com/<owner>/<repo>: the only place notes may link to. */
  readonly repoUrl: string;
  readonly now: () => Date;
}

export function stageField(stage: number): { stagingPercentage?: number } {
  if (!Number.isInteger(stage) || stage < 1 || stage > 100)
    throw new Error(`stage must be 1–100, got ${stage}`);
  return stage < 100 ? { stagingPercentage: stage } : {};
}

function sha(algorithm: 'sha256' | 'sha512', file: string, encoding: 'hex' | 'base64'): string {
  return createHash(algorithm).update(readFileSync(file)).digest(encoding);
}

export async function publishRelease(store: ReleaseStore, input: PublishInput): Promise<string[]> {
  const { channel, version } = input;
  checkChannelVersion(channel, version);
  const assets = versionAssets(version);
  const sources = sourceArtifacts(input.artifacts, input.requireSource);
  const channelFiles = channelAssets(channel);
  if (await store.release(assets.tag))
    throw new Error(`${assets.tag} exists: a version is never published twice`);
  const current = await store.readText(channelFiles.tag, channelFiles.yml);
  if (current && compareVersions(version, parseChannelYml(current).version) <= 0) {
    throw new Error(`${channel} serves ${parseChannelYml(current).version}; ${version} isn't newer`);
  }
  const zip = join(input.artifacts, assets.zip);
  const dmg = join(input.artifacts, assets.dmg);
  const blockmap = join(input.artifacts, assets.blockmap);
  for (const file of [zip, dmg]) if (!existsSync(file)) throw new Error(`missing ${file}`);
  const notes = releaseNotesJson(input.notes, input.repoUrl);

  const work = mkdtempSync(join(tmpdir(), 'taalcut-publish-'));
  try {
    const shipped = [zip, dmg, ...(existsSync(blockmap) ? [blockmap] : []), ...sources];
    const sums = join(work, assets.sums);
    writeFileSync(
      sums,
      shipped
        .map((file) => `${sha('sha256', file, 'hex')}  ${file.slice(file.lastIndexOf('/') + 1)}`)
        .join('\n') + '\n',
    );
    const noteFiles = NOTES_LOCALES.filter((locale) => existsSync(join(input.notes, `${locale}.md`))).map(
      (locale) => {
        const copy = join(work, assets.notes(locale));
        copyFileSync(join(input.notes, `${locale}.md`), copy);
        return copy;
      },
    );
    await store.ensure(assets.tag, {
      title: `Taalcut ${version}`,
      notes: readFileSync(join(input.notes, 'en.md'), 'utf8'),
      prerelease: channel !== 'stable',
    });
    await store.upload(assets.tag, [...shipped, sums, ...noteFiles]);

    const entry: ChannelEntry = {
      version,
      url: `${input.downloadBase.replace(/\/+$/, '')}/${assets.tag}/${assets.zip}`,
      sha512: sha('sha512', zip, 'base64'),
      size: statSync(zip).size,
      ...(existsSync(blockmap) ? { blockMapSize: statSync(blockmap).size } : {}),
      releaseDate: input.now().toISOString(),
      releaseNotes: notes,
    };
    const written = await pointChannel(store, channel, entry, input.stage, dmg, work);
    if (channel === 'stable') {
      const beta = await store.readText(channelAssets('beta').tag, channelAssets('beta').yml);
      if (!beta || compareVersions(version, parseChannelYml(beta).version) > 0) {
        written.push(...(await pointChannel(store, 'beta', entry, input.stage, undefined, work)));
      }
    }
    return [
      `${assets.tag}: ${[...shipped, sums, ...noteFiles].map((file) => file.slice(file.lastIndexOf('/') + 1)).join(', ')}`,
      ...written,
    ];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Writes the channel yml at `stage`, its history copy at 100%, and (with a DMG) the fixed-name DMG. */
async function pointChannel(
  store: ReleaseStore,
  channel: PublicChannel,
  entry: ChannelEntry,
  stage: number,
  dmg: string | undefined,
  work: string,
): Promise<string[]> {
  const files = channelAssets(channel);
  await store.ensure(files.tag, {
    title: `Taalcut ${channel} channel`,
    notes: `The ${channel} channel's update feed and download. Releases are tagged v<version>.`,
    prerelease: true,
  });
  const dir = mkdtempSync(join(work, `${channel}-`));
  const yml = join(dir, files.yml);
  const history = join(dir, files.history(entry.version));
  writeFileSync(yml, renderChannelYml({ ...entry, ...stageField(stage) }));
  writeFileSync(history, renderChannelYml(entry));
  const upload = [yml, history];
  if (dmg) {
    const fixed = join(dir, files.dmg);
    copyFileSync(dmg, fixed);
    upload.push(fixed);
  }
  await store.upload(files.tag, upload);
  return [`${files.tag}: ${upload.map((file) => file.slice(file.lastIndexOf('/') + 1)).join(', ')}`];
}

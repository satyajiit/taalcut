// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Wires the update pipeline to electron-updater and Electron's native autoUpdater. index.ts loads this module
 * only in builds that can have a feed, so release builds without one don't ship electron-updater at all.
 *
 * P3-B9 on top of Phase 1 and 2: a public build reads the person's channel (channel-setting.ts) and follows it
 * when it changes; versions this Mac rolled back from are refused (blocked.ts); the offer's release notes reach
 * the host in the person's language (release-notes.ts); once Squirrel has staged an update the rollback clone
 * and guard are prepared, and the guard starts when the app quits or the person restarts now (staging-tracker.ts,
 * install-prep.ts); a quit by signal still gets there (quit-signals.ts). What each event does is
 * update-event-sink.ts. Every check first verifies the channel file's signature against the key baked into this
 * build, and the update library is held to that signed file (security review SB-19, manifest-gate.ts); a build
 * without a key doesn't update at all.
 */
import { join } from 'node:path';
import {
  LOCALE_SETTING,
  type AppLocale,
  type EventBus,
  type PublicUpdateChannel,
  type SettingsStore,
} from '@taalcut/core';
import { app, autoUpdater as nativeUpdater } from 'electron';
import { autoUpdater } from 'electron-updater';
import { libraryPath } from '../../shared/library-path';
import { localeState } from '../locale/locale-host';
import { blockedVersions, rolledBackBlock } from './blocked';
import { createBundleOps } from './bundle-ops';
import { channelSetting, effectiveFeed } from './channel-setting';
import { resolveUpdateChannel, UPDATE_CHANNEL_SWITCH } from './feed';
import { registeredUpdateHost, type UpdateHost } from './host';
import { createInstallPrep, type InstallPrep } from './install-prep';
import { spawnDetached } from './launch-guard';
import { bakedManifestGate } from './manifest-wiring';
import { quitSignals } from './quit-signals';
import { serveToSquirrel } from './squirrel-feed';
import { armAtQuit, createStagingTracker } from './staging-tracker';
import { updateEventSink } from './update-event-sink';
import { readUpdateFile, rolledBackSchema, updatePaths, type UpdatePaths } from './update-files';
import {
  DEFAULT_SCHEDULE,
  startUpdates,
  type UpdateEvent,
  type Updates,
  type UpdateSchedule,
} from './updater';
import { appBundleOf, createDownloadVerifier, runExec } from './verify-download';

/**
 * The channel the build runs on. Release builds use only the baked channel. Test builds may pass
 * --taalcut-update-channel (index.ts stays as it is).
 */
function bakedChannel() {
  const testChannel =
    __TAALCUT_FLAVOUR__ === 'test' ? app.commandLine.getSwitchValue(UPDATE_CHANNEL_SWITCH) : '';
  return resolveUpdateChannel({
    flavour: __TAALCUT_FLAVOUR__,
    bakedChannel: __TAALCUT_UPDATE_CHANNEL__,
    testChannel,
  });
}

export interface AutoUpdateOptions {
  readonly schedule?: UpdateSchedule;
  readonly onEvent?: (event: UpdateEvent) => void;
  readonly host?: UpdateHost;
  readonly settings: SettingsStore;
  readonly events: EventBus;
}

/** Release notes follow the same explicit choice or English beta default as the app and native menus. */
async function notesLocale(settings: SettingsStore): Promise<AppLocale> {
  const stored = await settings.get(LOCALE_SETTING);
  return localeState(stored.ok ? stored.value : 'system', []).resolved;
}

/** The versions this Mac refuses: the ones it blocked (blocked.ts) and the one it last rolled back from. */
async function refusedVersions(
  settings: SettingsStore,
  paths: UpdatePaths,
  version: string,
): Promise<() => string[]> {
  const blocked = blockedVersions(settings);
  const loaded = await blocked.load(version);
  if (!loaded.ok) console.warn(`[update] blocked versions not read: ${loaded.error.code}`);
  const lastRollback = readUpdateFile(paths.lastRollback, rolledBackSchema);
  const rolledBack = rolledBackBlock(lastRollback.ok ? lastRollback.value?.to : undefined, version);
  return () => [...blocked.list(), ...rolledBack];
}

/** The rollback copy of the running bundle and its guard (install-prep.ts). */
function installPrep(paths: UpdatePaths, appPath: string, version: string): InstallPrep {
  return createInstallPrep({
    paths,
    appPath,
    version,
    library: libraryPath(app.getPath('userData')),
    guardSource: join(process.resourcesPath, 'bin', 'taalcut'),
    bundles: createBundleOps(runExec),
    spawnDetached,
    now: Date.now,
  });
}

/** A build without an update key doesn't update (build-settings.ts refuses a release build with a feed and none). */
function updatesOff(host: UpdateHost | undefined, version: string): undefined {
  console.warn('[update] this build has no update key: updates are off');
  host?.configure({ version, channel: null, enabled: false, choice: null });
  return undefined;
}

export async function startAutoUpdate(
  feedUrl: string,
  options: AutoUpdateOptions,
): Promise<Updates | undefined> {
  const host = options.host ?? registeredUpdateHost();
  const version = app.getVersion();
  const paths = updatePaths(app.getPath('userData'));
  const manifest = bakedManifestGate(paths.dir);
  if (!manifest) return updatesOff(host, version);
  const baked = bakedChannel();
  const stored = await channelSetting(options).read();
  let feed = effectiveFeed({ feed: feedUrl, baked, setting: stored.ok ? stored.value : null });
  host?.configure({ version, channel: feed.channel, enabled: true, choice: feed.choice });
  const refused = await refusedVersions(options.settings, paths, version);
  const appPath = appBundleOf(process.execPath);
  const staging = createStagingTracker(installPrep(paths, appPath, version), () => feed.channel);
  // Once staged, a SIGTERM would end the app before will-quit (quit-signals.ts): quit the normal way instead.
  const signals = quitSignals(process, (signal) => {
    console.warn(`[update] ${signal}: quitting so the update guard starts`);
    app.quit();
  });

  const updates = startUpdates({
    updater: autoUpdater,
    native: nativeUpdater,
    verifyDownload: createDownloadVerifier({ runningApp: appPath, runningVersion: version }),
    serveToSquirrel,
    feedUrl: feed.feedUrl,
    channel: feed.updaterChannel,
    blocked: refused,
    manifest,
    schedule: options.schedule ?? DEFAULT_SCHEDULE,
    onEvent: updateEventSink({
      ...(host ? { host } : {}),
      staging,
      signals,
      notesLocale: () => notesLocale(options.settings),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    }),
  });

  // A public build follows the person's channel at once (re-pointed, then checked).
  channelSetting(options).watch((choice: PublicUpdateChannel | null) => {
    const next = effectiveFeed({ feed: feedUrl, baked, setting: choice });
    if (next.feedUrl === feed.feedUrl && next.updaterChannel === feed.updaterChannel) return;
    feed = next;
    host?.configure({ version, channel: feed.channel, enabled: true, choice: feed.choice });
    void updates.repoint(feed.feedUrl, feed.updaterChannel);
  });

  // ShipIt installs a staged update when the app quits: the guard must be running by then.
  app.on('will-quit', (event) => armAtQuit(staging, event, () => app.quit()));
  host?.attach({
    checkNow: () => updates.checkNow(),
    installNow: () => {
      void staging.ready().then(() => {
        staging.arm();
        updates.installNow();
      });
    },
  });
  return updates;
}

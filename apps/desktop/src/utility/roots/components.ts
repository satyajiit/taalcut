// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The component manager over the signed manifest (packages/jobs SPEC,
 * "Signed manifest"). The jobs process is the only manager of
 * `<userData>/components` (there is no cross-process lock); the agent's local
 * runtime installs through it (componentInstallerContract, via main).
 *
 * The manifest is loaded on first use: loadSignedManifest checks the pinned
 * keys, signature, expiry and sequence. A refused or missing manifest is
 * logged and the manager runs with no components, so the app still starts;
 * every install then returns the refusal itself, so the window can say why
 * nothing downloads (UX2-MODELS: it said "component unknown", which the
 * window showed as "Something went wrong").
 *
 * The shipped manifest is signed with the release key, the key every build
 * pins. A packaged release build also refuses to run on the development key if
 * that is ever pinned; a build run from a checkout (`pnpm dev`) is a
 * development build whatever its flavour, and may (refusesDevelopmentKey).
 *
 * UX2-DOWNLOADER: the download of everything this Mac needs runs over the
 * same manager (`downloads`): installs it makes wake the indexing pipeline
 * like any other, and a refused manifest is its reason too. close() (the
 * process going away) stops the download, then the manager, and resolves once
 * nothing under `<userData>/components` is still being written.
 */
import { join } from 'node:path';
import { err, ok, type AsyncResult, type Result, type TaalcutError } from '@taalcut/core';
import {
  createComponentManager,
  createDownloadSet,
  loadSignedManifest,
  type ComponentManager,
  type ComponentManifest,
  type DownloadSet,
  type DownloadSetStatus,
  type InstalledComponent,
  type InstallOptions,
  type MachineFit,
  type TermsBook,
} from '@taalcut/jobs';

/**
 * Whether this build refuses to run while the development key is pinned: a packaged release build only. The
 * development key's private half is in the repository, so a shipped app must never trust it. trusted-keys.ts pins
 * only the release key; this is the guard for a checkout that pins the development key again to try a manifest it
 * signed. `pnpm dev` bundles the release flavour too (packaging/build-settings.ts defaults to it) but runs
 * unpackaged from the checkout, so it may (UX2-MODELS: refusing there left the PO's dev app with no components).
 */
export function refusesDevelopmentKey(build: {
  readonly flavour: 'release' | 'test';
  readonly packaged: boolean;
}): boolean {
  return build.flavour === 'release' && build.packaged;
}

/** No components: a refused manifest, or tests. */
export const NO_COMPONENTS: ComponentManifest = { schemaVersion: 1, components: [] };

export interface SignedComponentsOptions {
  /** userData/components. */
  readonly root: string;
  /** The shipped manifest.signed.json. */
  readonly manifestPath: string;
  /** A release build: the development key is refused. */
  readonly release: boolean;
  /**
   * Replaces the signed manifest: tests, and a development run's local release (dev-components.ts, never in a
   * packaged app), whose manifest is read at first use like the signed one.
   */
  readonly manifest?: ComponentManifest | (() => AsyncResult<ComponentManifest>);
  readonly fetch?: typeof globalThis.fetch;
  readonly log?: (message: string) => void;
  /** After every install that worked (the indexing pipeline re-queues the stages waiting for a model). */
  readonly onInstalled?: (installed: InstalledComponent) => void;
  /** This Mac's tier and what runs on it: what the download of everything it needs is about. */
  readonly machine: () => AsyncResult<MachineFit>;
  /**
   * The person's acceptance of a component owner's terms (LNX1-TRM: NVIDIA's for the CUDA runtime), read from the
   * library's acknowledgements. Absent: no such component downloads or installs.
   */
  readonly terms?: TermsBook;
  /** The download moved (`progress`) or changed (`state`): the jobs process sends its event. */
  readonly onDownloadsChange?: (kind: 'progress' | 'state') => void;
  /** Test seam: the platform key components are chosen for (default this process's, e.g. 'linux-x64'). */
  readonly platform?: string;
}

/** The download of everything this Mac needs; with a refused manifest, every call says why. */
export interface SignedDownloads {
  status(): Promise<DownloadSetStatus>;
  start(options?: { readonly first?: readonly string[] }): AsyncResult<DownloadSetStatus>;
  pause(): Promise<DownloadSetStatus>;
  cancel(): Promise<DownloadSetStatus>;
  /** At start: goes on with an unfinished download (downloads.json says whether there is one). */
  restore(): Promise<void>;
  /**
   * Stops the downloads where they are, changing nothing that was asked; resolves once they have let go and
   * `downloads.json` is written. close() does this first.
   */
  stop(): Promise<void>;
}

export interface SignedComponents extends ComponentManager {
  /**
   * Installs the member of `id`'s variant group the download takes here (its `variantOf`: an accelerator build that
   * fits and whose owner's terms are accepted, else the next, else `id`), for a caller that wants the build that
   * runs here (the local runtime's llama.cpp). With a refused manifest, the refusal.
   */
  installVariant(id: string, options?: InstallOptions): AsyncResult<InstalledComponent>;
  /** The member `installVariant` would install, installing nothing (EAR1-G2: a warm-up checks it is here). */
  variantOf(id: string): AsyncResult<string>;
  /**
   * Loads the manifest now (at start), so a refusal is logged then rather than at first use, and the registry, which
   * starts fetching the licence notices the manifest has replaced (UX2-DOWNLOADER round 4) without waiting for them.
   */
  ready(): Promise<void>;
  readonly downloads: SignedDownloads;
}

/**
 * An install as another process asks for it through main (core's ComponentInstallOptions): with `variant`, the build
 * that runs here (installVariant; the agent's local runtime asks so for llama.cpp), else `id` itself.
 */
export function installAsAsked(components: SignedComponents) {
  return (id: string, options: InstallOptions & { readonly variant?: boolean } = {}) =>
    options.variant ? components.installVariant(id, options) : components.install(id, options);
}

/** The state when no manifest could be trusted: the reason, and nothing to list. */
function refusedStatus(error: TaalcutError): DownloadSetStatus {
  return {
    state: 'failed',
    entries: [],
    bytesTotal: 0,
    bytesDone: 0,
    bytesPerSecond: 0,
    requiredBytes: 0,
    error,
    awaitingTerms: [],
  };
}

/** The manifest to install from: the one given (or its loader's), else the signed file's. */
async function manifestFor(
  options: SignedComponentsOptions,
  log: (message: string) => void,
): AsyncResult<{ readonly manifest: ComponentManifest }> {
  if (typeof options.manifest === 'function') {
    const given = await options.manifest();
    return given.ok ? ok({ manifest: given.value }) : given;
  }
  if (options.manifest) return ok({ manifest: options.manifest });
  return loadSignedManifest({
    path: options.manifestPath,
    statePath: join(options.root, 'manifest-state.json'),
    release: options.release,
    log,
  });
}

export function signedComponentManager(options: SignedComponentsOptions): SignedComponents {
  const log = options.log ?? ((message: string) => console.warn(message));
  let loaded: Promise<{ manager: ComponentManager; set: DownloadSet }> | undefined;
  /** Why the manifest was refused: what every install returns then. */
  let refused: TaalcutError | undefined;

  async function load(): Promise<{ manager: ComponentManager; set: DownloadSet }> {
    const signed = await manifestFor(options, log);
    // loadSignedManifest has logged why; say what it means for the app.
    if (!signed.ok) {
      refused = signed.error;
      log('[components] no trusted manifest: on-device models and runtimes cannot be installed');
    }
    const fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const manifest = signed.ok ? signed.value.manifest : NO_COMPONENTS;
    const platform = options.platform ? { platform: options.platform } : {};
    const terms = options.terms ? { terms: options.terms } : {};
    const base = createComponentManager({ root: options.root, manifest, fetch, log, ...platform, ...terms });
    // Installs the download makes go through here too, so they wake the stages waiting for a model.
    const manager: ComponentManager = {
      list: () => base.list(),
      get: (id) => base.get(id),
      plan: (ids) => base.plan(ids),
      install: async (id, installOptions) => {
        if (refused) return err(refused);
        const installed = await base.install(id, installOptions);
        if (installed.ok) options.onInstalled?.(installed.value);
        return installed;
      },
      updateAll: (installOptions) => base.updateAll(installOptions),
      refreshNotices: () => base.refreshNotices(),
      remove: (id, removeOptions) => base.remove(id, removeOptions),
      cleanup: () => base.cleanup(),
      checkSpace: (ids) => base.checkSpace(ids),
      discardDownloads: (id) => base.discardDownloads(id),
      settled: (id) => base.settled(id),
      close: () => base.close(),
    };
    const set = createDownloadSet({
      manager,
      manifest,
      root: options.root,
      machine: options.machine,
      log,
      ...platform,
      ...terms,
      ...(options.onDownloadsChange ? { onChange: options.onDownloadsChange } : {}),
    });
    return { manager, set };
  }
  const loadOnce = () => (loaded ??= load());
  const manager = async () => (await loadOnce()).manager;
  /** The set, or why there is none (a refused manifest). */
  const downloadSet = async (): Promise<Result<DownloadSet>> => {
    const { set } = await loadOnce();
    return refused ? err(refused) : ok(set);
  };

  return {
    ready: async () => {
      const { manager: loaded } = await loadOnce();
      // In the background: a notice that doesn't arrive is that part's last error, and close() waits for the fetch.
      void loaded.refreshNotices().catch((cause: unknown) => log(`[components] notices: ${String(cause)}`));
    },
    list: async () => (await manager()).list(),
    get: async (id) => (await manager()).get(id),
    plan: async (ids) => (await manager()).plan(ids),
    install: async (id, installOptions) => (await manager()).install(id, installOptions),
    async variantOf(id) {
      const set = await downloadSet();
      return set.ok ? set.value.variantOf(id) : set;
    },
    async installVariant(id, installOptions) {
      const set = await downloadSet();
      if (!set.ok) return set;
      const chosen = await set.value.variantOf(id);
      if (!chosen.ok) return chosen;
      if (chosen.value !== id)
        log(`[components] ${id}: installing ${chosen.value}, the build that runs here`);
      return (await manager()).install(chosen.value, installOptions);
    },
    updateAll: async (installOptions) => (await manager()).updateAll(installOptions),
    refreshNotices: async () => (await manager()).refreshNotices(),
    remove: async (id, removeOptions) => (await manager()).remove(id, removeOptions),
    cleanup: async () => (await manager()).cleanup(),
    checkSpace: async (ids) => (await manager()).checkSpace(ids),
    discardDownloads: async (id) => (await manager()).discardDownloads(id),
    settled: async (id) => (await manager()).settled(id),
    // The download first (it stops its passes, which wait for their installs), then whatever else installs.
    close: async () => {
      if (!loaded) return;
      const { manager: loadedManager, set } = await loaded;
      await set.stop();
      await loadedManager.close();
    },
    downloads: {
      async status() {
        const set = await downloadSet();
        return set.ok ? set.value.status() : refusedStatus(set.error);
      },
      async start(startOptions) {
        const set = await downloadSet();
        return set.ok ? set.value.start(startOptions) : set;
      },
      async pause() {
        const set = await downloadSet();
        return set.ok ? set.value.pause() : refusedStatus(set.error);
      },
      async cancel() {
        const set = await downloadSet();
        return set.ok ? set.value.cancel() : refusedStatus(set.error);
      },
      async restore() {
        const set = await downloadSet();
        if (set.ok) await set.value.restore();
      },
      async stop() {
        if (!loaded) return;
        await (await loaded).set.stop();
      },
    },
  };
}

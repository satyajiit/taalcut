// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Component installs across processes. One component manager owns
 * `<userData>/components` (the jobs process: it has no cross-process lock);
 * the agent process's local runtime installs its runtime and models through
 * it, via main. `install` is idempotent and resolves once the component is
 * in place; cancelling the call cancels the install (the partial download
 * stays for next time). `list` is Settings → About's component list.
 *
 * UX2-DOWNLOADER: everything this Mac's tier lists is required, so one
 * download fetches the whole set: `startDownloads` (bounded parallel,
 * resumable across restarts, verified), `pauseDownloads`, `cancelDownloads`
 * and `downloads`, its state. The commands below are how a window or the
 * agent asks for them.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc, type RpcClient } from '../ipc/contract';
import { callRpc, unwrapRpc } from '../ipc/errors';
import {
  componentSchema,
  downloadsSchema,
  type Component,
  type Downloads,
} from '../settings/component-schema';

const componentIdSchema = z.string().min(1).max(100);

export const installedComponentRefSchema = z.object({
  id: componentIdSchema,
  version: z.string().min(1).max(100),
  /** Absolute path of the component's folder. */
  path: z.string().min(1),
  /** Absolute path of the file, for single-file components. */
  file: z.string().min(1).optional(),
  /**
   * Absolute path of its licence notice, saved in its folder at install and verified against the manifest's
   * `licence.notice` (UX2-DOWNLOADER round 3). Settings opens it with `files.openNotice`.
   */
  notice: z.string().min(1),
});
export type InstalledComponentRef = z.output<typeof installedComponentRefSchema>;

/** Component ids to put at the front of the download, each once (a clip's models). */
const firstSchema = z
  .array(componentIdSchema)
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'A component is named twice' });

/**
 * The download of everything this Mac needs, through the jobs process (UX2-DOWNLOADER). Write, app-wide, no
 * inverse (a download isn't undoable); registered on the agent's bus; the state shows in `system.downloads` and
 * the `components.downloads` event.
 * - `download`: starts it, or picks it up again after a pause or a failure (failed components try again). `first`
 *   puts those components, and what they need, at the front; an id this Mac doesn't need is core.validation
 *   (field `first`). Resolves once it has started, after the disk-space check, with the state.
 * - `pauseDownloads`: stops every download where it is; partial files stay, and it stays paused after a restart.
 * - `resumeDownloads`: `download` with no `first`, named for the palette.
 * - `cancelDownloads`: stops them and deletes the partial files; what is installed stays.
 */
export const COMPONENT_COMMANDS = {
  download: 'components.download',
  pauseDownloads: 'components.pauseDownloads',
  resumeDownloads: 'components.resumeDownloads',
  cancelDownloads: 'components.cancelDownloads',
} as const;
/**
 * UX2-DOWNLOADER: the `ui.action` main sends when the person clicks its notification that the download stopped:
 * the window opens Settings › Models at that job's row (`args.job`, one of COMPONENT_JOBS), or at the download as a
 * whole when it names none (a disk too full stops everything).
 */
export const DOWNLOADS_SHOW_ACTION = 'downloads.show';

export const componentCommandPayloads = {
  [COMPONENT_COMMANDS.download]: z.object({ first: firstSchema.optional() }),
  [COMPONENT_COMMANDS.pauseDownloads]: z.object({}),
  [COMPONENT_COMMANDS.resumeDownloads]: z.object({}),
  [COMPONENT_COMMANDS.cancelDownloads]: z.object({}),
};

export const componentInstallerContract = {
  /**
   * Installs with dependencies (or does nothing when installed). Not in the manifest: core.not_found. `variant`
   * (LNX1-TRM): installs the member of `id`'s variant group the download of everything this machine needs picks
   * here (an accelerator build where it fits and its owner's terms are accepted, else the next, else `id`); the
   * reference says which.
   */
  install: ipc
    .input(z.object({ id: componentIdSchema, variant: z.boolean().optional() }))
    .output(installedComponentRefSchema),
  /** The installed component, or null. */
  get: ipc.input(z.object({ id: componentIdSchema })).output(installedComponentRefSchema.nullable()),
  /** Every component in the manifest and its state, for Settings → About. */
  list: ipc.output(z.array(componentSchema)),
  /** The download of everything this Mac needs. */
  downloads: ipc.output(downloadsSchema),
  /** Starts it (or picks it up again), `first` at the front; an error when it can't start (disk space, manifest). */
  startDownloads: ipc.input(z.object({ first: firstSchema.optional() })).output(downloadsSchema),
  pauseDownloads: ipc.output(downloadsSchema),
  cancelDownloads: ipc.output(downloadsSchema),
};

/** What serves the contract (the jobs process's ComponentManager has this shape). */
export interface ComponentInstallOptions {
  readonly signal?: AbortSignal;
  /** The member of `id`'s variant group that runs here, as the download picks it (componentInstallerContract). */
  readonly variant?: boolean;
}

export interface ComponentInstallerPort {
  install(id: string, options?: ComponentInstallOptions): AsyncResult<InstalledComponentRef>;
  get(id: string): Promise<InstalledComponentRef | undefined>;
}

/** The serving side also lists the components, as Settings shows them, and runs the download of the set. */
export interface ComponentsPort extends ComponentInstallerPort {
  list(): Promise<readonly Component[]>;
  downloads(): Promise<Downloads>;
  startDownloads(options: { readonly first?: readonly string[] }): AsyncResult<Downloads>;
  pauseDownloads(): Promise<Downloads>;
  cancelDownloads(): Promise<Downloads>;
}

const ref = ({ id, version, path, file, notice }: InstalledComponentRef): InstalledComponentRef => ({
  id,
  version,
  path,
  ...(file !== undefined ? { file } : {}),
  notice,
});

export function componentInstallerRouter(installer: ComponentsPort) {
  const os = implementContract(componentInstallerContract);
  return os.router({
    install: os.install.handler(async ({ input, signal }) =>
      ref(
        unwrapRpc(
          await installer.install(input.id, {
            ...(signal ? { signal } : {}),
            ...(input.variant ? { variant: true } : {}),
          }),
        ),
      ),
    ),
    get: os.get.handler(async ({ input }) => {
      const installed = await installer.get(input.id);
      return installed ? ref(installed) : null;
    }),
    list: os.list.handler(async () => [...(await installer.list())]),
    downloads: os.downloads.handler(() => installer.downloads()),
    startDownloads: os.startDownloads.handler(async ({ input }) =>
      unwrapRpc(await installer.startDownloads(input.first ? { first: input.first } : {})),
    ),
    pauseDownloads: os.pauseDownloads.handler(() => installer.pauseDownloads()),
    cancelDownloads: os.cancelDownloads.handler(() => installer.cancelDownloads()),
  });
}

/** The installer in another process (resolved per call: the client changes when that process restarts). */
export function componentInstallerOverRpc(
  client: () => RpcClient<typeof componentInstallerContract>,
): ComponentInstallerPort {
  return {
    install: (id, options = {}) =>
      callRpc(
        client().install(
          { id, ...(options.variant ? { variant: true } : {}) },
          options.signal ? { signal: options.signal } : {},
        ),
      ),
    async get(id) {
      const found = await callRpc(client().get({ id }));
      return found.ok ? (found.value ?? undefined) : undefined;
    },
  };
}

/** The download of everything this Mac needs, served in another process (the agent's commands, system.downloads). */
export interface ComponentDownloadsPort {
  status(): AsyncResult<Downloads>;
  start(options?: { readonly first?: readonly string[] }): AsyncResult<Downloads>;
  pause(): AsyncResult<Downloads>;
  cancel(): AsyncResult<Downloads>;
}

/** The download over RPC (resolved per call: the client changes when the jobs process restarts). */
export function componentDownloadsOverRpc(
  client: () => RpcClient<typeof componentInstallerContract>,
): ComponentDownloadsPort {
  return {
    status: () => callRpc(client().downloads()),
    start: (options = {}) =>
      callRpc(client().startDownloads(options.first ? { first: [...options.first] } : {})),
    pause: () => callRpc(client().pauseDownloads()),
    cancel: () => callRpc(client().cancelDownloads()),
  };
}

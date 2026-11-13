// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The experiment sandbox in the jobs process (P2-T2, exec mode): children
 * start here, under sandbox-exec with the Seatbelt profiles. Programs are the
 * app's own FFmpeg and ffprobe (the same resolution as the media kinds), the
 * mac helper, and the reference fetcher's yt-dlp and Deno from their
 * components. Scratch is `<userData>/scratch`, never inside a library source;
 * the jobs root's experiment sweep clears expired experiments at start and hourly.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { err, ok, type AsyncResult, type ExperimentSandbox } from '@taalcut/core';
import { hardwareSessionsFor, type HardwareSessionGate, type MediaService } from '@taalcut/media';
import { DENO_COMPONENT, REFERENCE_FETCHER_COMPONENT } from '@taalcut/templates';
import {
  createExperimentSandbox,
  defaultProfilesDir,
  SandboxUnavailable,
  type FetcherBinaries,
  type SandboxPrograms,
} from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { SANDBOX_PROFILES_RESOURCE } from '../../shared/sandbox-profiles';
import { macHelperResolver } from './mac-helper-resolver';
import type { ComponentLookup } from './template-audio';

export const SCRATCH_DIR = 'scratch';

/**
 * `<userData>/scratch`: the experiments' root, for the jobs process and the agent's job-mode sandbox alike. The
 * jobs root's experiment sweep (experiment-sweep.ts) clears expired experiments there at start and hourly.
 */
export const scratchRoot = (userData: string): string => join(userData, SCRATCH_DIR);

/**
 * offline.sb and fetcher.sb: Resources/sandbox/profiles when packaged (packaging/sandbox-resources.ts copies
 * them there); in a checkout the tools package's own folder (next to its source under Vitest, found from
 * out/utility in the unpackaged build).
 */
export function sandboxProfilesDir(config: Pick<UtilityConfig, 'packaged' | 'resourcesPath'>): string {
  if (config.packaged) return join(config.resourcesPath, SANDBOX_PROFILES_RESOURCE);
  const candidates = [
    defaultProfilesDir(),
    join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'tools', 'src', 'sandbox', 'profiles'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'offline.sb'))) ?? candidates[0]!;
}

export interface JobsSandboxDeps {
  readonly config: UtilityConfig;
  readonly media: MediaService;
  readonly components: () => ComponentLookup;
  readonly hardwareSessions?: HardwareSessionGate;
  readonly log?: (message: string) => void;
}

export function createJobsSandbox(deps: JobsSandboxDeps): ExperimentSandbox {
  const { config } = deps;
  // Programs are read when a run is checked, after `ready` filled them in.
  const paths: { ffmpeg: string; ffprobe: string; macHelper?: string } = { ffmpeg: '', ffprobe: '' };
  const programs: SandboxPrograms = {
    get ffmpeg() {
      return paths.ffmpeg;
    },
    get ffprobe() {
      return paths.ffprobe;
    },
    get macHelper() {
      return paths.macHelper;
    },
    ytDlp: () => fetcherBinaries(deps),
  };
  const helper = macHelperResolver(config);
  let resolved: AsyncResult<void> | undefined;
  const ready = () =>
    (resolved ??= (async () => {
      const binaries = await deps.media.binaries();
      if (!binaries.ok) {
        resolved = undefined;
        return binaries;
      }
      paths.ffmpeg = binaries.value.ffmpeg;
      paths.ffprobe = binaries.value.ffprobe;
      const mac = await helper.resolve();
      if (mac.ok) paths.macHelper = mac.value.path;
      return ok(undefined);
    })());

  const sandbox = createExperimentSandbox({
    root: scratchRoot(config.userData),
    programs,
    profilesDir: sandboxProfilesDir(config),
    ...(deps.hardwareSessions ? { hardwareSessions: hardwareSessionsFor(deps.hardwareSessions) } : {}),
  });
  return {
    ...sandbox,
    async run(id, request, options) {
      const found = await ready();
      if (!found.ok) return found;
      return sandbox.run(id, request, options);
    },
  };
}

/** yt-dlp and Deno from their components; the bundled FFmpeg's folder for merging. */
async function fetcherBinaries(deps: JobsSandboxDeps): AsyncResult<FetcherBinaries> {
  const fetcher = await deps.components().get(REFERENCE_FETCHER_COMPONENT);
  const deno = await deps.components().get(DENO_COMPONENT);
  if (!fetcher || !deno)
    return err(SandboxUnavailable(undefined, { detail: 'the reference fetcher is not installed' }));
  const binaries = await deps.media.binaries();
  if (!binaries.ok) return binaries;
  return ok({
    binary: fetcher.file ?? join(fetcher.path, 'yt-dlp'),
    deno: join(deno.path, 'deno'),
    ffmpegDir: dirname(binaries.value.ffmpeg),
    componentDirs: [fetcher.path, deno.path],
  });
}

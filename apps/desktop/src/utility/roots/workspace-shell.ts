// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 sbx: the agent's workspace shell. Children start in the jobs process (as the experiment sandbox's do):
 * there the shell runner confines `sh -c` with workspace.sb on macOS (bubblewrap on Linux, workspace-shell-linux.ts)
 * over the toolchain the components give (Node, Python, the HyperFrames CLI), the app's FFmpeg and render's
 * chrome-headless-shell, installing what's missing when the agent opens the workspace. The agent process has the
 * tools (job mode) and, on its bus, `workspace.importMedia` over the generated sink. Shell folders live in
 * `<userData>/shell`.
 */
import { dirname, join } from 'node:path';
import {
  err,
  ExperimentSandboxToken,
  GeneratedAssetSinkToken,
  JobRunnerToken,
  NotFoundError,
  ok,
  TemplateMediaStoreToken,
  WorkspaceStoreToken,
  type AnyCommand,
  type AssetId,
  type Container,
  type ExperimentId,
  type JobRegistration,
  type TemplateId,
  type ToolSpec,
} from '@taalcut/core';
import { createAssetLocationRepository } from '@taalcut/library';
import type { MediaService } from '@taalcut/media';
import { HEADLESS_SHELL, resolveHeadlessShell } from '@taalcut/render';
import {
  assembleToolchain,
  createShellJobs,
  createShellRunner,
  createToolchainJobs,
  SHELL_ROOT_DIR,
  WORKSPACE_TOOLCHAIN,
  workspaceImportCommand,
  workspaceShellTools,
  workspaceToolchainJob,
  type ShellToolchain,
  type ToolchainPart,
  type ToolchainParts,
  type ToolchainReport,
} from '@taalcut/tools';
import { hostPlatform } from '../../platform';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { ComponentManagerToken, LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import { installedShellDir } from './render-jobs';
import { sandboxProfilesDir } from './template-sandbox';
import { linuxShellBackend } from './workspace-shell-linux';

/** `<userData>/shell`: every project's shell folder. */
export const shellRoot = (userData: string): string => join(userData, SHELL_ROOT_DIR);

interface ToolchainDeps {
  readonly config: UtilityConfig;
  readonly container: Container;
  readonly media: MediaService;
}

/** What is installed (installing what isn't, when asked), and what couldn't be. */
async function toolchainParts(
  deps: ToolchainDeps,
  install: boolean,
  signal?: AbortSignal,
): Promise<{ parts: ToolchainParts; missing: ToolchainReport['missing'] }> {
  const missing: { name: string; reason: string }[] = [];
  const manager = deps.container.has(ComponentManagerToken)
    ? deps.container.resolve(ComponentManagerToken)
    : null;
  const components: { -readonly [K in ToolchainPart]?: { path: string; version: string } } = {};
  for (const key of Object.keys(WORKSPACE_TOOLCHAIN) as ToolchainPart[]) {
    const part = WORKSPACE_TOOLCHAIN[key];
    let found = manager ? await manager.get(part.componentId).catch(() => undefined) : undefined;
    if (!found && manager && install) {
      const installed = await manager
        .install(part.componentId, signal ? { signal } : {})
        .catch(() => null);
      if (installed?.ok) found = installed.value;
      else missing.push({ name: part.program, reason: installed ? installed.error.code : 'install failed' });
    } else if (!found) missing.push({ name: part.program, reason: 'not installed' });
    if (found) components[key] = { path: found.path, version: found.version };
  }
  const binaries = await deps.media.binaries();
  if (!binaries.ok) missing.push({ name: 'ffmpeg', reason: binaries.error.code });
  const shellSources = () => ({
    componentDir: installedShellDir(deps.config.userData),
    development: !deps.config.packaged,
    packageDir: join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'render'),
  });
  let shell = resolveHeadlessShell(shellSources());
  if (!shell.ok && manager && install) {
    const installed = await manager
      .install(HEADLESS_SHELL.componentId, signal ? { signal } : {})
      .catch(() => null);
    if (installed?.ok) shell = resolveHeadlessShell(shellSources());
    else
      missing.push({
        name: 'chrome-headless-shell',
        reason: installed ? installed.error.code : 'install failed',
      });
  }
  return {
    parts: {
      components,
      // Linux's FFmpeg loads its libraries from ../lib (resources/ffmpeg/{bin,lib}): the shell reads both.
      ...(binaries.ok
        ? {
            ffmpegDir: dirname(binaries.value.ffmpeg),
            ...(hostPlatform().workspaceShell === 'bwrap'
              ? { ffmpegRoot: dirname(dirname(binaries.value.ffmpeg)) }
              : {}),
          }
        : {}),
      ...(shell.ok ? { headlessShell: shell.value, headlessShellVersion: HEADLESS_SHELL.version } : {}),
    },
    missing,
  };
}

function isToolchainComplete(parts: ToolchainParts, missing: ToolchainReport['missing']): boolean {
  return (
    missing.length === 0 &&
    Boolean(
      parts.components.node &&
        parts.components.python &&
        parts.components.hyperframes &&
        parts.ffmpegDir &&
        parts.headlessShell,
    )
  );
}

/** The jobs process: `workspace.shell` and `workspace.toolchain`. */
export function workspaceShellJobs(
  config: UtilityConfig,
  container: Container,
  media: MediaService,
): JobRegistration[] {
  const deps = { config, container, media };
  let cachedToolchain: ShellToolchain | null = null;
  let cachedReport: ToolchainReport | null = null;
  const runner = createShellRunner({
    root: shellRoot(config.userData),
    toolchain: async () => {
      if (cachedToolchain) return cachedToolchain;
      let resolved = await toolchainParts(deps, false);
      if (!isToolchainComplete(resolved.parts, resolved.missing) && container.has(ComponentManagerToken)) {
        resolved = await toolchainParts(deps, true).catch(() => resolved);
      }
      const assembled = assembleToolchain(resolved.parts);
      if (isToolchainComplete(resolved.parts, resolved.missing)) {
        cachedToolchain = assembled;
        cachedReport = { programs: [...assembled.programs], missing: [] };
      }
      return assembled;
    },
    seatbelt: { profilesDir: sandboxProfilesDir(config) },
    ...(hostPlatform().workspaceShell === 'bwrap' ? { backend: linuxShellBackend() } : {}),
  });
  return [
    ...createShellJobs(runner),
    ...createToolchainJobs({
      async report({ install, signal }) {
        if (cachedReport) return ok(cachedReport);
        const { parts, missing } = await toolchainParts(deps, install, signal);
        const assembled = assembleToolchain(parts);
        const report = { programs: [...assembled.programs], missing };
        if (isToolchainComplete(parts, missing)) {
          cachedToolchain = assembled;
          cachedReport = report;
        }
        return ok(report);
      },
    }),
  ];
}

/** A library asset's media file, where a copy is present (or a template's kept reference reel by templateId). */
function resolveInput(container: Container) {
  return async (assetId: AssetId) => {
    const found = createAssetLocationRepository(container.resolve(LibraryDatabaseToken))
      .listByAsset(assetId)
      .find((location) => location.state === 'present' && location.absolutePathCached);
    if (found?.absolutePathCached) return ok(found.absolutePathCached);
    if (container.has(TemplateMediaStoreToken)) {
      const reel = await container.resolve(TemplateMediaStoreToken).get(assetId as unknown as TemplateId);
      if (reel.ok && reel.value) return ok(reel.value.path);
    }
    if (container.has(ExperimentSandboxToken)) {
      const sandbox = container.resolve(ExperimentSandboxToken);
      const exp = await sandbox.get(assetId as unknown as ExperimentId);
      const listed = exp.ok ? await sandbox.list(exp.value.id) : null;
      const ref = listed?.ok
        ? listed.value.find((f) => f.kind === 'file' && /^reference\.[a-z0-9]+$/i.test(f.path))
        : undefined;
      if (exp.ok && ref) return ok(join(exp.value.dir, ref.path));
    }
    return err(NotFoundError({ entity: 'asset', id: assetId }));
  };
}

/** Whether this process can offer the shell: the workspace store, jobs to run it in, the library, its folders. */
export const canShell = (container: Container): boolean =>
  container.has(WorkspaceStoreToken) &&
  container.has(JobRunnerToken) &&
  container.has(LibraryDatabaseToken) &&
  container.has(UtilityConfigToken);

/** The agent process: the shell's tools, for render's `workspace` module (agent-workspace-tools.ts). */
export function workspaceShellToolsOf(container: Container): ToolSpec[] {
  if (!canShell(container)) return [];
  const config = container.resolve(UtilityConfigToken);
  const jobs = container.resolve(JobRunnerToken);
  return workspaceShellTools({
    store: container.resolve(WorkspaceStoreToken),
    root: shellRoot(config.userData),
    runner: createShellRunner({ jobs }),
    resolveInput: resolveInput(container),
    toolchain: (signal) => jobs.run(workspaceToolchainJob, { install: true }, { signal }),
  });
}

/** The agent process's bus: `workspace.importMedia`, where the generated sink is. */
export function workspaceShellCommands(
  container: Container,
  config: Pick<UtilityConfig, 'userData'>,
): AnyCommand[] {
  if (!container.has(GeneratedAssetSinkToken)) return [];
  return [
    workspaceImportCommand({
      root: shellRoot(config.userData),
      sink: container.resolve(GeneratedAssetSinkToken),
    }),
  ];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's job kinds in the jobs process: `render.export` runs through the
 * render process's worker, reached through main (MAIN_SERVICE_CONTRACTS.jobs
 * .render), and `render.purge` clears render's caches.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClockToken,
  ok,
  RenderStoreToken,
  renderWorkerOverRpc,
  type AsyncResult,
  type Container,
  type JobRegistration,
  type PortLike,
} from '@taalcut/core';
import { installedComponentDirSync } from '@taalcut/jobs';
import {
  C2PA_SIDECAR,
  createRenderJobs,
  HEADLESS_SHELL,
  HEADLESS_SHELL_DELIVERY,
  resolveHeadlessShell,
} from '@taalcut/render';
import { renderPaths } from '../../shared/render-paths';
import { registerRenderPorts } from '../../shared/render-ports';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { ComponentManagerToken } from '../../shared/tokens';
import { mainServices } from './main-services';
import { renderPhase3Jobs } from './render-phase3-agent';

/** <userData>/components/installed/<id>/<version>-<sha12>: the shell's installed folder, if any. */
export function installedShellDir(userData: string): string | undefined {
  const root = join(userData, 'components', 'installed', HEADLESS_SHELL.componentId);
  try {
    const found = readdirSync(root).find((name) => name.startsWith(`${HEADLESS_SHELL.version}-`));
    return found ? join(root, found) : undefined;
  } catch {
    return undefined;
  }
}

export function renderJobs(
  config: UtilityConfig,
  container: Container,
  main: PortLike | undefined,
): readonly JobRegistration[] {
  registerRenderPorts(container);
  const services = mainServices(main);
  const desktopDir = join(import.meta.dirname, '..', '..');
  return [
    ...renderExportJobs(config, container, services, desktopDir),
    ...renderPhase3Jobs(config, container),
  ];
}

/** Installs a component the export needs before it runs, unless it is on disk or there is no component manager. */
async function ensureComponent(
  container: Container,
  componentId: string,
  present: () => boolean,
  signal: AbortSignal | undefined,
): AsyncResult<void> {
  if (!container.has(ComponentManagerToken) || present()) return ok(undefined);
  const installed = await container
    .resolve(ComponentManagerToken)
    .install(componentId, signal ? { signal } : {});
  return installed.ok ? ok(undefined) : installed;
}

function renderExportJobs(
  config: UtilityConfig,
  container: Container,
  services: ReturnType<typeof mainServices>,
  desktopDir: string,
): readonly JobRegistration[] {
  const remote = renderWorkerOverRpc(() => {
    if (!services) throw new Error('No port to main: the render worker is unreachable');
    return services.render;
  });
  const shellPresent = () =>
    HEADLESS_SHELL_DELIVERY !== 'component' ||
    resolveHeadlessShell({
      ...(!config.packaged && process.env.TAALCUT_HEADLESS_SHELL
        ? { explicit: process.env.TAALCUT_HEADLESS_SHELL }
        : {}),
      componentDir: installedShellDir(config.userData),
      development: !config.packaged,
      packageDir: join(desktopDir, '..', '..', 'packages', 'render'),
    }).ok;
  const components = join(config.userData, 'components');
  const sidecarPresent = () => installedComponentDirSync(components, C2PA_SIDECAR.componentId) !== undefined;
  return createRenderJobs({
    worker: {
      ...remote,
      async export(input, options) {
        const shell = await ensureComponent(
          container,
          HEADLESS_SHELL.componentId,
          shellPresent,
          options?.signal,
        );
        if (!shell.ok) return shell;
        // P3-V7: the c2pa sidecar is installed the first time an export asks for Content Credentials.
        if (input.request.contentCredentials?.add === true) {
          const sidecar = await ensureComponent(
            container,
            C2PA_SIDECAR.componentId,
            sidecarPresent,
            options?.signal,
          );
          if (!sidecar.ok) return sidecar;
        }
        return remote.export(input, options);
      },
    },
    folders: renderPaths(config.userData),
    clock: container.resolve(ClockToken),
    store: container.resolve(RenderStoreToken),
  });
}

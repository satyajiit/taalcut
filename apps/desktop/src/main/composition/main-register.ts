// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What main's container holds: the library (opened and migrated here, with
 * the crash-recovery report), the keychain vault, models' AuthBroker and the
 * accounts service over it, power state, and the utility host with main's
 * services on each process's second port. Everything is lazy; main-root.ts
 * resolves it in order.
 */
import { join } from 'node:path';
import {
  AcknowledgementStoreToken,
  callRpc,
  ClockToken,
  CloudCallSinkToken,
  createEventBus,
  createToken,
  EventBusToken,
  PluginServiceToken,
  serveRpc,
  SettingsStoreToken,
  systemClock,
  type Container,
  type ProductId,
  type RpcServer,
  type SignInEvent,
} from '@taalcut/core';
import { createRenderStore, openDatabase, presentOriginal } from '@taalcut/library';
import {
  createAuthBroker,
  createModelRuntime,
  type AuthBroker,
  type ModelRuntime,
  type ModelRuntimeOptions,
  type SecretStore,
} from '@taalcut/models';
import { app, MessageChannelMain, safeStorage, shell, utilityProcess } from 'electron';
import { componentManifestPath } from '../../shared/component-manifest';
import { libraryPath } from '../../shared/library-path';
import { registerLibraryPorts } from '../../shared/library-ports';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { attachUtilityStderr } from '../debug/log-ring';
import { PlatformServicesToken, type PlatformServices } from '../../platform';
import type { GpuInfo } from '../gpu/gpu-info';
import { electronPowerState } from '../power/electron-power';
import { UtilityHost } from '../rpc/utility-host';
import type { Runtime } from '../runtime';
import { utilityProcessTable } from '../utility/process-table';
import { createMainAccounts, modelsAcknowledgements, type MainAccounts } from './accounts';
import { mainServicesRouter } from './main-routers';
import { ImportRuntimeToken } from '../imports/runtime';
import { PowerStateToken, UtilityHostToken } from './main-wiring';
import { createVaultSecretStore } from './secret-store';
import { registerVoiceCapture, VoiceCaptureStoreToken } from '../voice/register';
import { mcpConnectConfig, registerMcpMain } from '../mcp/mcp-main';
import { utilityForkEnv } from './fork-env';
import { withAcceleratorEnv } from '../../utility/accelerator-env';
import { managedNativesOnly } from '../../utility/roots/dev-components';
import { createHubInstallKey, MainHubInstallKeyToken, withHubInstallKey } from '../hub/hub-install-key';
import {
  createMainInstagramAuth,
  MainInstagramAuthToken,
  withInstagramCredential,
} from '../instagram/instagram-login';
import { preMigrationSnapshotFor } from '../update/pre-migration';
import { updatePaths } from '../update/update-files';
import { electronShotModelHost } from '../shot-model/register';
import { createDesktopPlugins } from '../plugins/plugin-host';
import {
  createPluginMediaPathResolver,
  createPluginUploadReader,
  type PluginUploadMedia,
} from '../plugins/plugin-uploads';
import { ProductBackgroundToken } from '../background/product-background';
import { productBackgroundControlRouter } from '../background/router';

export interface MainRootOptions {
  /** A saved inbox notification opens its product, including from a windowless launch. */
  readonly openProduct?: (productId: ProductId) => void;
  readonly runtime: Runtime;
  /** This OS's services (platform/), chosen once in main's entry. */
  readonly platform: PlatformServices;
  readonly userData: string;
  /** out/utility: one bundled entry per utility process, named after it. */
  readonly utilityDir: string;
  /** The app's Resources folder (sidecar binaries in bin/). */
  readonly resourcesPath: string;
  /** Test builds only: providers and Sign in with ChatGPT at local mock servers (see main/index.ts). */
  readonly modelRuntime?: ModelRuntimeOptions;
  /** Test builds only: the title-bar double-click setting, instead of macOS's (--taalcut-double-click). */
  readonly doubleClick?: () => string | null;
  /** The GPU report for the debug bundle's environment section. */
  readonly gpu?: GpuInfo;
  /** Crash and feedback address for this launch (a test build may override the baked DSN). */
  readonly crashDsn?: string;
}

const utilityChildren = new Map<string, { postMessage(message: unknown): void }>();

/** A message to a running utility process. A dead child is ignored. */
export function postToUtility(name: string, message: unknown): void {
  try {
    utilityChildren.get(name)?.postMessage(message);
  } catch {
    // The process has already exited.
  }
}

export const SecretStoreToken = createToken<SecretStore>('desktop.secretStore');
export const MainModelRuntimeToken = createToken<ModelRuntime>('desktop.mainModelRuntime');
export const AuthBrokerToken = createToken<AuthBroker>('desktop.authBroker');
export const AccountsToken = createToken<MainAccounts>('desktop.accounts');

export { libraryPath } from '../../shared/library-path';

function registerAccounts(
  container: Container,
  userData: string,
  runtimeOptions?: ModelRuntimeOptions,
): void {
  const signInListeners = new Set<(event: SignInEvent) => void>();
  container.factory(
    SecretStoreToken,
    ({ platform }) =>
      createVaultSecretStore(join(userData, 'vault', 'secrets.json'), safeStorage, platform.secretStore),
    { deps: { platform: PlatformServicesToken } },
  );
  container.factory(
    MainModelRuntimeToken,
    ({ secrets }) => createModelRuntime({ ...runtimeOptions, secrets }),
    {
      deps: { secrets: SecretStoreToken },
    },
  );
  container.factory(
    AuthBrokerToken,
    ({ runtime, acknowledgements, callLog }) =>
      createAuthBroker({
        runtime,
        openExternal: (url) => shell.openExternal(url),
        acknowledgements: modelsAcknowledgements(acknowledgements),
        onSignInEvent: (event) => {
          for (const listener of [...signInListeners]) listener(event);
        },
        callLog,
      }),
    {
      deps: {
        runtime: MainModelRuntimeToken,
        acknowledgements: AcknowledgementStoreToken,
        callLog: CloudCallSinkToken,
      },
    },
  );
  container.factory(
    MainInstagramAuthToken,
    ({ secrets, acknowledgements }) =>
      createMainInstagramAuth({
        secrets,
        acknowledgements,
      }),
    {
      deps: {
        secrets: SecretStoreToken,
        acknowledgements: AcknowledgementStoreToken,
      },
    },
  );
  container.factory(
    AccountsToken,
    ({ broker, settings, acknowledgements, runtime, callLog, host, instagram }) => {
      const accounts = createMainAccounts({
        broker,
        runtime,
        settings,
        acknowledgements,
        callLog,
        instagram,
        // The agent drops its cached credential (and re-reads the user's servers).
        notify: (provider) =>
          void callRpc(host.client('agent').credentials.forget({ provider })).then((forgot) => {
            if (!forgot.ok && forgot.error.code !== 'core.process_restarted')
              console.warn(`[accounts] agent not told about ${provider}: ${forgot.error.code}`);
          }),
      });
      signInListeners.add((event) => accounts.signInEvents.emit(event));
      return accounts;
    },
    {
      deps: {
        broker: AuthBrokerToken,
        settings: SettingsStoreToken,
        acknowledgements: AcknowledgementStoreToken,
        runtime: MainModelRuntimeToken,
        callLog: CloudCallSinkToken,
        host: UtilityHostToken,
        instagram: MainInstagramAuthToken,
      },
      dispose: (accounts) => accounts.dispose(),
    },
  );
}

export function registerMain(container: Container, options: MainRootOptions): void {
  const dbPath = libraryPath(options.userData);
  container.value(PlatformServicesToken, options.platform);
  container.value(ClockToken, systemClock);
  container.factory(EventBusToken, ({ clock }) => createEventBus({ clock }), { deps: { clock: ClockToken } });
  container.factory(
    LibraryDatabaseToken,
    () => {
      // At start, before any utility process runs: every job left running goes back to the queue. The
      // quit counts as a free restart (library's default 2, the jobs engine's), so a one-attempt job resumes.
      // An update's first launches clone the library before migrating it, for the rollback guard (P3-B9).
      const snapshot = preMigrationSnapshotFor(updatePaths(options.userData), app.getVersion(), dbPath);
      const opened = openDatabase({
        path: dbPath,
        recovery: { reclaimJobs: 'all' },
        ...(snapshot ? { preMigrationSnapshot: snapshot } : {}),
      });
      if (!opened.ok)
        throw new Error(`${opened.error.code}: ${opened.error.detail ?? ''}`, { cause: opened.error });
      return opened.value;
    },
    { dispose: (db) => db.close() },
  );
  // Library's stores by their tokens (SettingsStoreToken, AcknowledgementStoreToken, …), lazy.
  registerLibraryPorts(container);
  registerAccounts(container, options.userData, options.modelRuntime);
  container.factory(
    PluginServiceToken,
    ({ secrets, settings, db }) => {
      const pluginMedia: PluginUploadMedia = {
        assetPath: (id) => presentOriginal(db, id)?.path,
        renders: createRenderStore(db),
      };
      return createDesktopPlugins(
        secrets,
        settings,
        createPluginUploadReader(pluginMedia),
        createPluginMediaPathResolver(pluginMedia),
      );
    },
    {
      deps: { secrets: SecretStoreToken, settings: SettingsStoreToken, db: LibraryDatabaseToken },
      dispose: (plugins) => plugins.dispose(),
    },
  );
  // The hub's install key (P3-B12): made on first use in the vault, served to the agent process only.
  container.factory(MainHubInstallKeyToken, ({ secrets }) => createHubInstallKey(secrets), {
    deps: { secrets: SecretStoreToken },
  });
  registerMcpMain(container, () => container.resolve(UtilityHostToken));
  container.factory(PowerStateToken, () => electronPowerState(), { dispose: (power) => power.dispose() });
  registerVoiceCapture(container, options.userData);

  const specs = utilityProcessTable('').map((spec) => ({
    ...spec,
    modulePath: join(options.utilityDir, `${spec.name}.mjs`),
  }));
  const channel = () => {
    const { port1, port2 } = new MessageChannelMain();
    return { local: port1, remote: port2 };
  };
  const shotModels = electronShotModelHost({ ...options, packaged: options.runtime.packaged });
  const host = new UtilityHost({
    specs,
    fork: (spec) => {
      // stderr is piped so the debug bundle can keep each process's last lines.
      const child = utilityProcess.fork(spec.modulePath, [], {
        serviceName: spec.serviceName,
        stdio: 'pipe',
        ...withAcceleratorEnv(utilityForkEnv(spec.name), join(options.userData, 'components'), {
          managedOnly: managedNativesOnly(options.runtime.packaged),
        }),
      });
      let readerPid = child.pid;
      child.once('spawn', () => {
        readerPid = child.pid;
      });
      child.once('exit', () => {
        if (readerPid !== undefined) {
          const driver = container.resolve(LibraryDatabaseToken).driver;
          driver.prepare('DELETE FROM import_volume_readers WHERE pid = ?').run(readerPid);
          driver.prepare('DELETE FROM import_space_reservations WHERE pid = ?').run(readerPid);
        }
      });
      attachUtilityStderr(spec.name, child.stderr);
      shotModels.attach(spec.name, child); // the jobs process may ask for TransNetV2's process (IX2-S2)
      utilityChildren.set(spec.name, child);
      return child;
    },
    createChannel: channel,
    config: (process) => ({
      process,
      dbPath,
      userData: options.userData,
      resourcesPath: options.resourcesPath,
      packaged: options.runtime.packaged,
      componentManifest: componentManifestPath({
        packaged: options.runtime.packaged,
        resourcesPath: options.resourcesPath,
        utilityDir: options.utilityDir,
      }),
      appVersion: app.getVersion(),
      ...mcpConnectConfig(container, process),
    }),
    // Resolved when a process starts, by which time the broker can be built.
    serveMainServices: (process, port) => {
      // Read only once a call is cut off, long after serveRpc returned.
      const served: RpcServer = serveRpc(
        mainServicesRouter(process, {
          productBackground: productBackgroundControlRouter(() => container.resolve(ProductBackgroundToken)),
          broker: withInstagramCredential(
            withHubInstallKey(container.resolve(AuthBrokerToken), container.resolve(MainHubInstallKeyToken)),
            container.resolve(MainInstagramAuthToken),
            () => {
              const accounts = container.resolve(AccountsToken);
              accounts.notifyChanged();
              void callRpc(
                container
                  .resolve(UtilityHostToken)
                  .client('agent')
                  .credentials.forget({ provider: 'instagram' }),
              );
            },
          ),
          host: container.resolve(UtilityHostToken),
          callerGone: () => served.closed,
          ...(container.has(ImportRuntimeToken)
            ? { importsControl: container.resolve(ImportRuntimeToken).control }
            : {}),
          voiceCaptures: container.resolve(VoiceCaptureStoreToken),
          secrets: container.resolve(SecretStoreToken),
          plugins: container.resolve(PluginServiceToken),
          events: container.resolve(EventBusToken),
        }),
        port,
        { context: { caller: process }, exposeDetail: true },
      );
      return served;
    },
  });
  container.value(UtilityHostToken, host);
}

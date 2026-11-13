// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The routers main serves itself: accounts and recovery to every window,
 * and to the agent process its credentials and the job runner (forwarded
 * to the jobs process). Electron-free, so unit-tested.
 */
import {
  accountsContract,
  backgroundModelsContract,
  CHATGPT_PROVIDER,
  componentInstallerContract,
  credentialsContract,
  embeddingsContract,
  forwardTo,
  implementContract,
  importsControlContract,
  jobEnqueueContract,
  MAIN_SERVICE_CONTRACTS,
  pluginsServiceContract,
  productBackgroundControlContract,
  notServedRouter,
  eventsContract,
  eventsRouter,
  recoveryContract,
  telemetryIngestContract,
  unwrapRpc,
  type AnyContractRouter,
  type AsyncResult,
  type EventBus,
  type RpcRouter,
  type RunId,
  type UtilityName,
  type PluginService,
} from '@taalcut/core';
import type { AuthBroker, SecretStore } from '@taalcut/models';
import type { UtilityHost } from '../rpc/utility-host';
import { toWire, wireStream } from '../../shared/wire';
import type { MainAccounts } from './accounts';
import type { RecoveryState } from './run-recovery';
import { agentPhase3Services, lanPhase3Services, mcpServicesRouter } from './phase3-namespaces';
import { agentRunnerForward, renderWorkerForward } from './runner-forward';
import type { VoiceCaptureStore } from '../voice/voice-capture-store';
import { pluginsServiceRouter } from '../plugins/plugin-routers';

/** Each event from now on, in order, until `signal` fires. */
async function* each<T>(subscribe: (listener: (value: T) => void) => () => void, signal?: AbortSignal) {
  const queue: T[] = [];
  let wake: (() => void) | undefined;
  const off = subscribe((value) => {
    queue.push(value);
    wake?.();
  });
  const stop = () => wake?.();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    while (!signal?.aborted) {
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  } finally {
    off();
    signal?.removeEventListener('abort', stop);
  }
}

/** appContract.accounts over models' accounts service; sign-in progress from the broker. */
export function accountsRouter({ service, signInEvents }: Pick<MainAccounts, 'service' | 'signInEvents'>) {
  const os = implementContract(accountsContract);
  const reply = async <T>(result: AsyncResult<T>) => toWire(unwrapRpc(await result));
  return os.router({
    state: os.state.handler(() => reply(service.state())),
    changed: os.changed.handler(({ signal }) => wireStream(service.changed(signal))),
    signIn: os.signIn.handler(({ input }) => reply(service.signIn(input))),
    signInEvents: os.signInEvents.handler(({ signal }) => each(signInEvents.subscribe, signal)),
    signOut: os.signOut.handler(({ input }) => reply(service.signOut(input))),
    setApiKey: os.setApiKey.handler(({ input }) => reply(service.setApiKey(input))),
    testApiKey: os.testApiKey.handler(({ input }) => reply(service.testApiKey(input))),
    removeApiKey: os.removeApiKey.handler(({ input }) => reply(service.removeApiKey(input))),
    setLocalServer: os.setLocalServer.handler(({ input }) => reply(service.setLocalServer(input))),
    testLocalServer: os.testLocalServer.handler(({ input }) => reply(service.testLocalServer(input))),
  });
}

export interface RecoveryDeps {
  /** This launch's report, kept current after an agent crash (run-recovery.ts). */
  readonly state: Pick<RecoveryState, 'report' | 'seen'>;
  /** The agent process picks the runs up (UTILITY_CONTRACTS.agent.runs). */
  readonly resume: (runIds: readonly RunId[]) => Promise<void>;
}

/** Offered until dismissed or resumed; offered again if the agent crashes mid-run later. */
export function recoveryRouter(deps: RecoveryDeps) {
  const os = implementContract(recoveryContract);
  return os.router({
    report: os.report.handler(() => {
      const report = deps.state.report();
      return {
        ...report,
        unfinishedRuns: [...report.unfinishedRuns],
        reclaimedJobs: [...report.reclaimedJobs],
        lastCommands: report.lastCommands.map((project) => ({ ...project, commands: [...project.commands] })),
      };
    }),
    resumeRuns: os.resumeRuns.handler(async ({ input }) => {
      deps.state.seen();
      await deps.resume(input.runIds);
    }),
    dismiss: os.dismiss.handler(() => {
      deps.state.seen();
    }),
  });
}

/** ChatGPT signs in to 'openai'; the model picker knows the plan as 'openai-codex'. */
const PLAN_ALIASES: Readonly<Record<string, string>> = { openai: CHATGPT_PROVIDER };

/** What the agent process may ask main: a credential for one request, and which providers are set up. */
export function credentialsRouter(broker: Pick<AuthBroker, 'get' | 'invalidate' | 'statuses'>) {
  const os = implementContract(credentialsContract);
  return os.router({
    get: os.get.handler(async ({ input, signal }) => {
      const credential = unwrapRpc(
        await broker.get(input.provider, {
          ...(signal ? { signal } : {}),
          ...(input.minValidityMs !== undefined ? { minValidityMs: input.minValidityMs } : {}),
          ...(input.forceRefresh ? { forceRefresh: true } : {}),
        }),
      );
      return credential ? { ...credential } : null;
    }),
    invalidate: os.invalidate.handler(({ input }) => broker.invalidate?.(input.provider)),
    configured: os.configured.handler(async () => {
      const statuses = unwrapRpc(await broker.statuses());
      const ids = statuses.flatMap((status) => {
        if (!status.signedIn) return [];
        const alias = status.method === 'subscription' ? PLAN_ALIASES[status.provider] : undefined;
        return alias ? [status.provider, alias] : [status.provider];
      });
      return [...new Set(ids)];
    }),
  });
}

export interface MainServicesDeps {
  readonly productBackground?: RpcRouter<typeof productBackgroundControlContract, Record<never, never>>;
  readonly importsControl?: RpcRouter<typeof importsControlContract, Record<never, never>>;
  readonly broker: Pick<AuthBroker, 'get' | 'invalidate' | 'statuses'>;
  /** `start` brings up the on-demand render process before a forwarded worker call. */
  readonly host: Pick<UtilityHost, 'client'> & Partial<Pick<UtilityHost, 'start'>>;
  /** True once the process these services are for has gone (its port closed). Default: never. */
  readonly callerGone?: () => boolean;
  /** Consent recordings the agent claims (voice/voice-capture-store.ts). Default: not served (tests). */
  readonly voiceCaptures?: Pick<VoiceCaptureStore, 'claim'>;
  /** The keychain vault. Lan's adb key stays unserved until this is passed. */
  readonly secrets?: SecretStore;
  readonly plugins?: PluginService;
  /** Main's event bus: the agent follows render.finished from it (LRN1-MEM). Default: not served (tests). */
  readonly events?: EventBus;
}

/**
 * Main's services for one utility process (MAIN_SERVICE_CONTRACTS). The agent's credentials are main's;
 * runner, components, embeddings and queue go on to the jobs process, render to the render process.
 * The jobs process gets the render worker, which runs its export jobs. Jobs, render and lan hand
 * their telemetry events to the agent's queue.
 */
export function mainServicesRouter(
  process: UtilityName,
  deps: MainServicesDeps,
): RpcRouter<AnyContractRouter, Record<never, never>> {
  // The render process starts on demand: an export job or a frame capture brings it up. A jobs crash
  // mid-export leaves the render running so the reclaimed job joins it (runner-forward.ts).
  const renderWorker = () =>
    renderWorkerForward(
      () => {
        deps.host.start?.('render');
        return deps.host.client('render').worker;
      },
      deps.callerGone ?? (() => false),
    );
  const telemetry = () => forwardTo(telemetryIngestContract, () => deps.host.client('agent').telemetryIngest);
  if (process === 'jobs') {
    return implementContract(MAIN_SERVICE_CONTRACTS.jobs).router({
      render: renderWorker(),
      telemetry: telemetry(),
      models: forwardTo(backgroundModelsContract, () => deps.host.client('agent').backgroundModels),
    });
  }
  if (process === 'render') {
    // An export's grade LUTs and subject tracks: the jobs queue, as the agent's runner (round P3-3).
    return implementContract(MAIN_SERVICE_CONTRACTS.render).router({
      telemetry: telemetry(),
      runner: agentRunnerForward(() => deps.host.client('jobs').runner, deps.callerGone ?? (() => false)),
      // AGT2-MATCH: QA's slot match embeds a slot's needs as the agent's casting does.
      embeddings: forwardTo(embeddingsContract, () => deps.host.client('jobs').embeddings),
    });
  }
  if (process === 'lan') {
    return implementContract(MAIN_SERVICE_CONTRACTS.lan).router({
      telemetry: telemetry(),
      ...lanPhase3Services(deps.secrets),
    });
  }
  if (process === 'mcp') return mcpServicesRouter(deps.host);
  const os = implementContract(MAIN_SERVICE_CONTRACTS.agent);
  return os.router({
    importsControl: deps.importsControl ?? notServedRouter(importsControlContract, 'importsControl'),
    productBackground:
      deps.productBackground ?? notServedRouter(productBackgroundControlContract, 'productBackground'),
    plugins: deps.plugins
      ? pluginsServiceRouter(deps.plugins)
      : notServedRouter(pluginsServiceContract, 'plugins'),
    credentials: credentialsRouter(deps.broker),
    // A job outlives the agent process that waited on it: its resumed run joins it (runner-forward.ts).
    runner: agentRunnerForward(() => deps.host.client('jobs').runner, deps.callerGone ?? (() => false)),
    components: forwardTo(componentInstallerContract, () => deps.host.client('jobs').components),
    embeddings: forwardTo(embeddingsContract, () => deps.host.client('jobs').embeddings),
    queue: forwardTo(jobEnqueueContract, () => deps.host.client('jobs').queue),
    render: renderWorker(),
    ...agentPhase3Services(deps.voiceCaptures),
    // LRN1-MEM forwards main's render.finished here so the agent records what worked.
    mainEvents: deps.events
      ? eventsRouter(deps.events, { exposed: ['render.finished'] })
      : notServedRouter(eventsContract, 'mainEvents'),
  });
}

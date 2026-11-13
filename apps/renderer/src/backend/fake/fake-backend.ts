// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The renderer's stand-in for main and the utility processes in a plain
 * browser (the dev server, the renderer's end-to-end tests), where there is
 * no main to connect to. It is the real thing on the wire: core's command bus
 * behind core's commandsRouter, an event bus behind core's eventsRouter, and
 * the other contracts served with serveRpc on one end of a MessageChannel,
 * with the page holding a connectRpc client on the other. In Electron,
 * main.tsx uses connectToMain's client instead.
 */
import {
  commandsRouter,
  connectRpc,
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  createSettingsCommands,
  createUiCommands,
  eventsRouter,
  forwardCommandEvents,
  implementContract,
  NotFoundError,
  serveRpc,
  systemClock,
  toRpcError,
  type CommandBus,
  type EventBus,
  type TaalcutError,
  SETTINGS_COMMANDS,
} from '@taalcut/core';
import { backendContract, type Backend } from '../contract';
import { createFakeAccounts, type FakeAccounts } from './fake-accounts';
import { createFakeConsents, type FakeConsents } from './fake-consents';
import { createFakeModels, type CallReceipt, type FakeModels } from './fake-models';
import { createFakeSpeech, type FakeSpeech, type FakeSpeechOptions } from './fake-speech';
import { fakeCudaHold, liveCudaSetup } from './fake-nvidia';
import { fakeCompute } from './fake-compute';
import { fakeHardware } from './fake-system';
import { createPhase2Fakes, type Phase2FakeOptions, type Phase2Fakes } from './fake-phase2';
import { createPhase2bFakes, type Phase2bFakeOptions, type Phase2bFakes } from './fake-phase2b';
import { createMakeFakes, type FakeMake, type FakeMakeOptions } from './make/fake-make';
import { createFakeUsage, type FakeUsage, type FakeUsageMode } from './fake-usage';
import { createPhase3Fakes, type Phase3FakeOptions, type Phase3Fakes } from './phase3/fake-phase3';
import { usageHistory } from './phase3/usage-history';
import { findTrace, summarizeTraces } from './fake-traces';
import { TRACE_FIXTURES } from './trace-fixtures';
import { createFakeRelink } from './imports/fake-relink';
import { createFakeImports } from './imports/fake-imports';
import { createFakePlugins, type FakePluginOptions } from './plugins/fake-plugins';
import { createFakeCreation } from './creation/fake-creation';
import { productFakes } from './products/fake-products';
import { themeCommand, type FakeThemeTarget } from './fake-theme';
import { createFakeInterfaceSounds, type FakeInterfaceSoundsOptions } from './fake-interface-sounds';

export type { FakeThemeTarget } from './fake-theme';

export interface FakeBackendOptions {
  interfaceSounds?: FakeInterfaceSoundsOptions;
  plugins?: FakePluginOptions;
  /** The page's theme engine: the fake runs settings.setTheme against it. */
  theme?: FakeThemeTarget;
  /** ISO date for the deprecation watcher. Default: today. */
  today?: () => string;
  signInDelayMs?: number;
  /** The library, Wi-Fi import and template fakes (sizes, scenarios, latency). */
  phase2?: Phase2FakeOptions;
  /** Privacy, budgets, onboarding, telemetry, feedback and updates (UI round 2b). */
  phase2b?: Phase2bFakeOptions;
  /** Projects, timelines and renders (P2-M3, P2-M7, P2-M8, P2-M11, P2-X3). */
  make?: FakeMakeOptions;
  /** Language, External agents, updates, the usage dashboard, starters and a phone on a cable (Phase 3). */
  phase3?: Phase3FakeOptions;
  /** A month of cloud calls before the seed's last two days (the usage dashboard's preview). */
  usageHistory?: boolean;
  /** Settings › Usage's states: no calls ever, slow reads or failing reads. */
  usageMode?: FakeUsageMode;
  /** LIB1-LANG: the languages you speak, already answered. */
  speech?: FakeSpeechOptions;
}

/** What tests drive directly: the fake's services, and "the next model call". */
export interface FakeControls {
  readonly plugins: ReturnType<typeof createFakePlugins>;
  readonly bus: CommandBus;
  /** What main's bus would send the page, e.g. a `ui.action` from the app menu. */
  readonly events: EventBus;
  readonly models: FakeModels;
  readonly accounts: FakeAccounts;
  readonly usage: FakeUsage;
  readonly consents: FakeConsents;
  /** The library (5,000 clips by default), the scripted phone and the templates. */
  readonly library: Phase2Fakes['library'];
  readonly transfer: Phase2Fakes['transfer'];
  readonly templates: Phase2Fakes['templates'];
  /** P3-V14: folders, a template's file, the library's commands. */
  readonly templateLibrary: Phase2Fakes['templateLibrary'];
  /** Privacy switches, budgets, onboarding progress, recorded telemetry, sent feedback. */
  readonly privacy: Phase2bFakes['privacy'];
  readonly budget: Phase2bFakes['budget'];
  readonly onboarding: Phase2bFakes['onboarding'];
  readonly feedback: Phase2bFakes['feedback'];
  /** Projects, timelines, renders and previews. */
  readonly make: FakeMake;
  /** The language, MCP sessions and the clipboard main wrote, limits, the phone on a cable, updates. */
  readonly phase3: Phase3Fakes;
  /** LIB1-LANG: the languages you speak, as stored. */
  readonly speech: FakeSpeech;
  /** Every command the bus ran, oldest first. */
  readonly dispatched: { name: string; source: string }[];
  call(module: Parameters<FakeModels['call']>[0]): CallReceipt | TaalcutError;
}

/** What files.openNotice says isn't there, as main says it (the not-found message's `entity`: data, not UI copy). */
const NOTICE_ENTITY = 'notice';

const isError = (value: unknown): value is TaalcutError =>
  typeof value === 'object' && value !== null && 'code' in value && 'messageKey' in value;

/** Unwraps a fake's value-or-error the way a real handler does (unwrapRpc). */
/** models' HardwareProbeFailed, as the jobs process sends it (the renderer can't import models). */
const PROBE_FAILED: TaalcutError = {
  code: 'models.hardware_probe_failed',
  messageKey: 'errors.models.hardware_probe_failed',
  retryable: true,
  // eslint-disable-next-line lingui/no-unlocalized-strings -- developer detail, never shown
  detail: 'fake: the probe failed',
};

function reply<T>(value: T | TaalcutError): T {
  if (isError(value)) throw toRpcError(value);
  return value;
}

export function createFakeBackend(options: FakeBackendOptions = {}): {
  client: Backend;
  controls: FakeControls;
} {
  const now = () => systemClock.now();
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10));
  const usage = createFakeUsage(now, options.usageHistory ? usageHistory : undefined, options.usageMode);
  const hardware = fakeHardware(options.phase3?.hardware);
  // LNX1-TRM: on the RTX 4090 host the download holds NVIDIA's CUDA libraries back until the terms are accepted in
  // the fake acknowledgements (made with the phase 3 fakes, below).
  const acknowledged: { current?: Phase3Fakes['acknowledgements'] } = {};
  const speech: { current?: FakeSpeech } = {};
  const held =
    options.phase3?.hardware?.system === 'linux-nvidia'
      ? fakeCudaHold((featureId, version) => acknowledged.current?.has(featureId, version) ?? false)
      : undefined;
  const accounts = createFakeAccounts({ now, signInDelayMs: options.signInDelayMs });
  const models = createFakeModels({
    usage,
    tier: hardware.tier,
    today,
    now,
    // Shows the deprecation notice: an image override on a model that retires on 2026-10-23.
    initial: { overrides: { images: { primary: { provider: 'openrouter', model: 'openai/gpt-image-1' } } } },
    // As main does: a model of a provider with no key or sign-in is marked, and the chat doesn't offer it.
    configured: () => accounts.configured(),
  });
  const consents = createFakeConsents(now);
  const plugins = createFakePlugins(now, options.plugins);
  const imports = createFakeImports(options.phase2?.pickedFolder);
  const relink = createFakeRelink();

  const events = createEventBus({ clock: systemClock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
  const phase2 = createPhase2Fakes(events, {
    ...options.phase2,
    readInstagramAuth:
      options.phase2?.readInstagramAuth ??
      (() => accounts.watch.get().instagram ?? { signedIn: false, username: null }),
    // LRN1-STY: read when a profile is asked for, by which time Make (made below, from these templates) exists.
    readExportedTemplates: options.phase2?.readExportedTemplates ?? (() => make.exportedTemplates()),
  });
  const phase2b = createPhase2bFakes(
    {
      now,
      models: () => models.watch.get(),
      calls: () => usage.list({ limit: 10_000 }).records,
      consents: () => consents.list(),
      freeBytes: () => hardware.info.freeDiskBytes,
      emitDownloads: (downloads) => events.emit('components.downloads', downloads),
      held,
      // LIB1-LANG: the Indian-language identifier, while the person's languages ask for it (made below).
      wanted: () => speech.current?.wanted() ?? [],
    },
    options.phase2b,
  );
  const settings = createMemorySettingsStore();
  const sounds = createFakeInterfaceSounds(settings, options.interfaceSounds);
  const make = createMakeFakes(
    events,
    {
      ...(options.phase3?.hardware?.system ? { system: options.phase3.hardware.system } : {}),
      ...options.make,
      ...(options.phase2?.library?.count !== undefined ? { libraryCount: options.phase2.library.count } : {}),
    },
    phase2.templates,
  );
  const creation = createFakeCreation(make);
  const products = productFakes(creation, make);
  const phase3 = createPhase3Fakes(
    {
      now,
      settings,
      usage,
      templates: phase2.templates,
      libraryClips: () => options.phase2?.library?.count ?? 5_000,
      capOf: (projectId) => phase2b.budget.project(projectId).cap,
      events,
      library: phase2.library,
      make,
      localOnly: () => phase2b.privacy.state().localOnly,
    },
    options.phase3,
  );
  acknowledged.current = phase3.acknowledgements;
  speech.current = createFakeSpeech(
    { settings, appLanguage: () => phase3.locale.watch.get().resolved },
    options.speech,
  );
  // The real settings.openSignInWarning, openAccounts, openModels, setLocale and UI commands
  // (go.*, edit.* with their shortcuts): each UI command emits a ui.action for the page.
  const {
    openSignInWarning,
    openAccounts,
    openModels,
    setLocale,
    setInterfaceSounds,
    initializeInterfaceSounds,
  } = createSettingsCommands({
    settings,
    events,
  });
  bus.register(
    ...products.commands,
    ...creation.commands,
    ...plugins.commands,
    ...imports.commands,
    ...relink.commands,
    ...models.commands(),
    openSignInWarning,
    openAccounts,
    openModels,
    setLocale,
    setInterfaceSounds,
    initializeInterfaceSounds,
    ...phase3.commands,
    ...createUiCommands({ events }).all,
    ...phase2.commands,
    ...phase2b.commands,
    ...make.commands,
    ...speech.current.commands,
    ...(options.theme ? [themeCommand(options.theme)] : []),
  );
  // As in the agent: every change on the bus is a command.changed event for the page.
  forwardCommandEvents(bus, events);
  const dispatched: FakeControls['dispatched'] = [];
  bus.subscribe((change) => {
    if (change.kind === 'executed') dispatched.push({ name: change.name, source: change.origin.source });
    // As main does on command.changed: the language setting moved (a switch, its undo or redo).
    if (change.name === SETTINGS_COMMANDS.setLocale)
      void phase3.locale.refresh().then(() => phase3.updates.relocalise());
    if (
      change.name === SETTINGS_COMMANDS.setInterfaceSounds ||
      change.name === SETTINGS_COMMANDS.initializeInterfaceSounds
    )
      void sounds.changed();
    // A model or a switch changed: what leaves this Mac may have too.
    phase2b.changed();
  });

  const os = implementContract(backendContract);
  const router = os.router({
    creation: creation.router,
    products: products.router,
    productBackground: products.background,
    productPublishing: products.publishing,
    ...plugins.router,
    ...imports.router,
    ...relink.router,
    commands: commandsRouter(bus),
    interfaceSounds: sounds.router,
    events: eventsRouter(events),
    models: {
      settings: os.models.settings.handler(() => models.watch.get()),
      changed: os.models.changed.handler(({ signal }) => models.watch.stream(signal)),
      options: os.models.options.handler(({ input }) => models.options(input.module)),
    },
    accounts: {
      state: os.accounts.state.handler(() => accounts.watch.get()),
      changed: os.accounts.changed.handler(({ signal }) => accounts.watch.stream(signal)),
      signIn: os.accounts.signIn.handler(async ({ input }) =>
        reply(await accounts.signIn(input.provider, input.acknowledgedAt)),
      ),
      // The fake's sign-ins finish at once, with no device code to show.
      signInEvents: os.accounts.signInEvents.handler(async function* ({ signal }) {
        if (signal && !signal.aborted)
          await new Promise((resolve) => signal.addEventListener('abort', resolve));
        yield* [];
      }),
      signOut: os.accounts.signOut.handler(({ input }) => accounts.signOut(input.provider)),
      setApiKey: os.accounts.setApiKey.handler(({ input }) =>
        reply(accounts.setApiKey(input.provider, input.key)),
      ),
      testApiKey: os.accounts.testApiKey.handler(({ input }) => reply(accounts.testApiKey(input.provider))),
      removeApiKey: os.accounts.removeApiKey.handler(({ input }) => accounts.removeApiKey(input.provider)),
      setLocalServer: os.accounts.setLocalServer.handler(({ input }) =>
        reply(accounts.setLocalServer(input.kind, input.baseUrl)),
      ),
      testLocalServer: os.accounts.testLocalServer.handler(({ input }) =>
        reply(accounts.testLocalServer(input.kind)),
      ),
    },
    usage: {
      list: os.usage.list.handler(async ({ input }) => {
        await usage.settle();
        return usage.list(input);
      }),
      ...phase3.usage,
    },
    system: {
      hardware: os.system.hardware.handler(() => {
        if (options.phase3?.hardware?.failing) return reply<typeof hardware>(PROBE_FAILED);
        if (!held) return hardware;
        const runtime = phase2b.onboarding.components().find((each) => each.id === held.part.id);
        return { ...hardware, gpuSetup: liveCudaSetup(hardware, held, runtime) };
      }),
      // The download of everything this Mac needs (fake-downloads.ts): first run starts it, its commands steer it.
      components: os.system.components.handler(() => phase2b.onboarding.components()),
      downloads: os.system.downloads.handler(() => phase2b.onboarding.downloads()),
      compute: os.system.compute.handler(() => fakeCompute(options.phase3?.hardware?.system)),
    },
    traces: {
      runs: os.traces.runs.handler(({ input }) => summarizeTraces(TRACE_FIXTURES).slice(0, input.limit)),
      get: os.traces.get.handler(({ input }) => reply(findTrace(TRACE_FIXTURES, input.runId))),
    },
    consents: {
      list: os.consents.list.handler(() => consents.list()),
      revoke: os.consents.revoke.handler(({ input }) => {
        const revoked = consents.revoke(input.module);
        phase2b.changed();
        return revoked;
      }),
    },
    ...phase2.router({
      starters: (input) => phase3.starters.list(input),
      devices: phase3.transfer,
      ...phase3.extensions,
      files: {
        ...phase3.extensions.files,
        openNotice: os.files.openNotice.handler(({ input }) => {
          if (!phase2b.onboarding.openNotice(input.componentId))
            throw toRpcError(NotFoundError({ entity: NOTICE_ENTITY, id: input.componentId }));
        }),
      },
    }),
    ...phase2b.router,
    ...make.router,
    ...phase3.router,
    ...speech.current.router,
  });

  const channel = new MessageChannel();
  serveRpc(router, channel.port1, { context: {} });
  const { client } = connectRpc(backendContract, channel.port2, { peer: 'fake' });

  return {
    client,
    controls: {
      plugins,
      bus,
      events,
      models,
      accounts,
      usage,
      consents,
      library: phase2.library,
      transfer: phase2.transfer,
      templates: phase2.templates,
      templateLibrary: phase2.templateLibrary,
      privacy: phase2b.privacy,
      budget: phase2b.budget,
      onboarding: phase2b.onboarding,
      feedback: phase2b.feedback,
      make,
      phase3,
      speech: speech.current,
      dispatched,
      call: (module) => models.call(module),
    } satisfies FakeControls,
  };
}

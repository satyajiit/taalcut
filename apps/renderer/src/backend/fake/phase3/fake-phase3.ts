// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Phase 3 namespaces the ui-onboarding lane's screens read, served by the renderer's fake on the same
 * MessageChannel as the rest: `locale` (P3-L2), `mcp` and `mcpSetup` (P3-V4), `updates` (P3-B9, P3-B14) and the
 * agent's `acknowledgements`; the usage dashboard's `summary` and `limits` (G8); the starters behind
 * `templates.starters` (P3-B3); and the USB procedures of `transfer` (P3-B4, P3-B5), which fake-phase2.ts serves. Each is core's contract, so the real backend changes
 * nothing in the pages. Their commands (settings.setLocale is core's own, registered by fake-backend.ts).
 */
import type { FakeHardwareOptions } from '../fake-system';
import { appContract, deviceProcedures, implementContract, type AnyCommand } from '@taalcut/core';
import { createFakeCredits } from './fake-credits';
import type { Phase3Deps } from './phase3-deps';
import { createFakeDevices, type FakeDevicesOptions } from './fake-devices';
import { createFakeFilePicks, type FakeFilePicksOptions } from './fake-file-picks';
import { createFakeHub, type FakeHubOptions } from './fake-hub';
import { exportState } from '../make/p3/interchange/export-state';
import { createFakeMediaCommands } from './fake-media-commands';
import { createFakeStock } from './fake-stock';
import { createFakeStyles, type FakeStylesOptions } from './fake-styles';
import { createFakeVoiceCapture, type FakeVoiceCaptureOptions } from './fake-voice-capture';
import { createFakeLocale, type FakeLocaleOptions } from './fake-locale';
import { createFakeMcp, type FakeMcpOptions } from './fake-mcp';
import { createFakeStarters, type FakeStartersOptions } from './fake-starters';
import { createFakeAcknowledgements, createFakeUpdates, type FakeUpdatesOptions } from './fake-updates';
import { createFakeLimits, summarizeUsage, type LimitScenario } from './fake-usage-summary';
import { createFakeComments, type FakeCommentsOptions } from '../comments/fake-comments';
import { createFakeMemory, type FakeMemoryOptions } from '../memory/fake-memory';
import { seedDesigns } from '../workspace/design-arrange';
import { createFakeWorkspace } from '../workspace/fake-workspace';
import { createFakeDesignCommands } from './fake-design-commands';

export interface Phase3FakeOptions {
  readonly locale?: FakeLocaleOptions;
  readonly mcp?: FakeMcpOptions;
  /** Limits in force when the page opens (Settings › Usage › Now). */
  readonly limits?: LimitScenario;
  readonly usb?: FakeDevicesOptions;
  readonly updates?: FakeUpdatesOptions;
  readonly starters?: FakeStartersOptions;
  /** The probe's tier and free space (first run's This Mac step). */
  readonly hardware?: FakeHardwareOptions;
  /** Brand kits and looks (P3-V10). */
  readonly styles?: FakeStylesOptions;
  /** The template hub's state (P3-B12). */
  readonly hub?: FakeHubOptions;
  /** What main's file dialog answers, per purpose. */
  readonly files?: FakeFilePicksOptions;
  /** The microphone for a voice consent (P3-B6). */
  readonly voiceCapture?: FakeVoiceCaptureOptions;
  /** Settings → Memory (LRN1-MEM). */
  readonly memory?: FakeMemoryOptions;
  /** EDT1-CMT: the editor's comments. */
  readonly comments?: FakeCommentsOptions;
  /** HFW1-UI: graphics the AI designed on Golden hour's first video, and its workspace (design-arrange.ts). */
  readonly designs?: { readonly arranged?: boolean };
}

export type { Phase3Deps } from './phase3-deps';

export function createPhase3Fakes(deps: Phase3Deps, options: Phase3FakeOptions = {}) {
  const locale = createFakeLocale(deps.settings, options.locale);
  const acknowledgements = createFakeAcknowledgements(deps.now);
  const updates = createFakeUpdates(
    { now: deps.now, locale: () => locale.watch.get().resolved, acknowledgements },
    options.updates,
  );
  const mcp = createFakeMcp(deps.now, options.mcp);
  const limits = createFakeLimits(deps.now, options.limits);
  const devices = createFakeDevices(deps.now, options.usb);
  const starters = createFakeStarters(
    deps.templates,
    () => ({ clips: deps.libraryClips() }),
    options.starters,
  );

  const styles = createFakeStyles(deps, options.styles);
  const hub = createFakeHub(deps, options.hub);
  const stock = createFakeStock({
    now: deps.now,
    events: deps.events,
    library: deps.library,
    localOnly: deps.localOnly,
    // An imported video's licence and author, for the export's credits (P3-V18).
    provenance: (assetId, provenance) => exportState().provenance.set(assetId, provenance),
    ...(deps.make.p3.gaps.stockScenario ? { scenario: deps.make.p3.gaps.stockScenario } : {}),
    // An imported video a gap uses isn't discarded by an undo.
    inUse: (assetId) =>
      deps.make.timelines
        .all()
        .some((timeline) =>
          timeline.tracks.some(
            (track) =>
              track.kind !== 'text' &&
              track.items.some((item) => item.type === 'clip' && item.media.assetId === assetId),
          ),
        ),
  });
  const credits = createFakeCredits(deps.library);
  const filePicks = createFakeFilePicks(options.files);
  const voiceCapture = createFakeVoiceCapture(deps, options.voiceCapture);
  const memory = createFakeMemory(
    { ...deps, projects: deps.make.projects, templates: deps.templates },
    options.memory,
  );

  // HFW1-UI: the workspace's files and revisions; with `designs`, Golden hour's designed graphics.
  const workspace = createFakeWorkspace({ now: deps.now });
  if (options.designs?.arranged) seedDesigns(deps.make.timelines, workspace);

  const comments = createFakeComments(
    { ...deps, timelines: { get: deps.make.timelines.get, list: deps.make.timelines.all } },
    options.comments,
  );

  const loc = implementContract(appContract.locale);
  const mc = implementContract(appContract.mcp);
  const setup = implementContract(appContract.mcpSetup);
  const ack = implementContract(appContract.acknowledgements);
  const upd = implementContract(appContract.updates);
  const use = implementContract(appContract.usage);
  const usb = implementContract(deviceProcedures);

  const router = {
    locale: loc.router({
      state: loc.state.handler(() => locale.watch.get()),
      changed: loc.changed.handler(({ signal }) => locale.watch.stream(signal)),
    }),
    mcp: mc.router({
      state: mc.state.handler(() => mcp.watch.get()),
      changed: mc.changed.handler(({ signal }) => mcp.watch.stream(signal)),
    }),
    mcpSetup: setup.router({
      createSession: setup.createSession.handler(({ input }) => mcp.createSession(input)),
      copySetup: setup.copySetup.handler(({ input }) => mcp.copySetup(input)),
      rotateToken: setup.rotateToken.handler(({ input }) => mcp.rotateToken(input)),
    }),
    acknowledgements: ack.router({
      has: ack.has.handler(({ input }) => acknowledgements.has(input.featureId, input.termsVersion)),
      record: ack.record.handler(({ input }) => acknowledgements.record(input.featureId, input.termsVersion)),
    }),
    updates: upd.router({
      state: upd.state.handler(() => updates.watch.get()),
      changed: upd.changed.handler(({ signal }) => updates.watch.stream(signal)),
      check: upd.check.handler(() => updates.check()),
      installNow: upd.installNow.handler(() => void updates.installs.push(deps.now())),
    }),
    styles: styles.router,
    hub: hub.router,
    voiceCapture: voiceCapture.router,
    memory: memory.router,
    comments: comments.router,
    workspace: workspace.router,
  };
  /** What Phase 3 adds to Phase 2's namespaces (fake-phase2.ts Phase2Extensions). */
  const extensions = {
    library: { ...stock.router, ...credits.router },
    files: { ...filePicks.router, ...deps.make.p3.interchange.files },
  };

  /** What the usage namespace adds to the built `list` (fake-backend.ts serves it). */
  const usage = {
    summary: use.summary.handler(async ({ input }) => {
      await deps.usage.settle();
      return summarizeUsage(deps.usage.all(), input, deps.capOf);
    }),
    limits: use.limits.handler(() => [...limits.watch.get()]),
    limitsChanged: use.limitsChanged.handler(async function* ({ signal }) {
      for await (const value of limits.watch.stream(signal)) yield [...value];
    }),
  };
  /** The USB procedures, spread into the transfer router (fake-phase2.ts). */
  const transfer = usb.router({
    devices: usb.devices.handler(({ signal }) => devices.watch.stream(signal)),
    openDevice: usb.openDevice.handler(({ input }) => devices.open(input.deviceKey)),
    deviceItems: usb.deviceItems.handler(() => ({ items: [], total: 0 })),
    deviceSummary: usb.deviceSummary.handler(({ input }) => devices.summary(input.deviceKey, input.filter)),
    importFromDevice: usb.importFromDevice.handler(({ input }) =>
      devices.importFrom(input.deviceKey, input.selection.filter),
    ),
    deviceRun: usb.deviceRun.handler(({ input, signal }) => devices.run(input.runId).stream(signal)),
    deviceRunItems: usb.deviceRunItems.handler(({ input }) => {
      devices.run(input.runId);
      return { items: [] };
    }),
    pauseDeviceImport: usb.pauseDeviceImport.handler(({ input }) =>
      devices.setRunState(input.runId, 'paused'),
    ),
    resumeDeviceImport: usb.resumeDeviceImport.handler(({ input }) =>
      devices.setRunState(input.runId, 'running'),
    ),
    cancelDeviceImport: usb.cancelDeviceImport.handler(({ input }) =>
      devices.setRunState(input.runId, 'cancelled'),
    ),
    forgetUsbDebugKey: usb.forgetUsbDebugKey.handler(() => ({ forgotten: true })),
  });

  const commands: AnyCommand[] = [
    ...mcp.commands(),
    ...updates.commands(),
    ...starters.commands(),
    ...styles.commands,
    ...hub.commands,
    ...stock.commands,
    // P3-B6, P3-V13: the voice consent and motion-graphic commands (voice.removeVoiceover and music.setDucking
    // are the export fakes', make/p3/fake-export-commands.ts).
    ...createFakeMediaCommands(deps, voiceCapture, options.voiceCapture).commands,
    // LRN1-MEM: MEMORY_COMMANDS (memory/fake-memory.ts).
    ...memory.commands,
    // EDT1-CMT: COMMENT_COMMANDS (comments/fake-comments.ts).
    ...comments.commands,
    // HFW1-UI: WORKSPACE_COMMANDS and the Designer's graphics commands.
    ...workspace.commands,
    ...createFakeDesignCommands(deps).commands,
  ];
  return {
    router,
    extensions,
    styles,
    hub,
    stock,
    filePicks,
    voiceCapture,
    memory,
    comments,
    workspace,
    usage,
    transfer,
    commands,
    starters,
    locale,
    mcp,
    limits,
    devices,
    updates,
    acknowledgements,
  };
}

export type Phase3Fakes = ReturnType<typeof createPhase3Fakes>;

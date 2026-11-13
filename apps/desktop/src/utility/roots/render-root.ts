// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's composition root (P2-M6, P2-M11): @taalcut/render's
 * engine over the library's ports, FFmpeg from the app's sidecars, the
 * pinned chrome-headless-shell (the installed component, or the development
 * cache in a checkout), the bundled caption fonts and, since REF1, the reel
 * each template keeps (render-reference.ts) for the reel's own music. Serves
 * UTILITY_CONTRACTS.render: renders for windows, worker for the jobs
 * process and the agent.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  ClockToken,
  createToken,
  EventBusToken,
  implementContract,
  RenderStoreToken,
  renderWorkerRouter,
  SettingsStoreToken,
  UTILITY_CONTRACTS,
  type PortLike,
} from '@taalcut/core';
import {
  EncoderSelection,
  HardwareFailures,
  ToneMapSelection,
  VideoBackendSelection,
  type MediaContext,
} from '@taalcut/media';
import {
  createRenderEngine,
  createTextMeasurer,
  HEADLESS_SHELL_DELIVERY,
  resolveHeadlessShell,
  type RenderEngine,
  type TextMeasurer,
} from '@taalcut/render';
import { renderPaths } from '../../shared/render-paths';
import {
  registerRenderPorts,
  renderAssetFiles,
  renderTimelines,
  renderTranscripts,
} from '../../shared/render-ports';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import type { ProbedHardware } from '../../shared/tokens';
import type { UtilityRoot } from '../runtime';
import { commonRouters, createUtilityContainer } from './base';
import { macHardware } from './hardware';
import { registerHardwareSessions, sessionContext } from './hardware-sessions';
import { mediaBinaries } from './jobs-root';
import { hardwareVideoBackends } from './media-jobs';
import { registerLibraryPhase3Render } from './library-phase3';
import { registerTemplateMedia } from './agent-template-media';
import { registerWorkspaceStore } from './workspace-store';
import { registerDuckingPlanner } from './render-ducking';
import { installedShellDir } from './render-jobs';
import { renderPhase3Deps } from './render-phase3';
import { renderReferenceAudio } from './render-reference';
import { registerSoundListener, renderListener } from './render-listener';
import { renderJobRunner, renderMainClient } from './render-runner';
import { renderSlotMatch } from './render-slot-match';
import { renderStylePacing } from './render-style-pacing';

export { installedShellDir };

const RenderEngineToken = createToken<RenderEngine>('desktop.renderEngine');

/** Environment the shell must not inherit from an Electron utility process. */
const STRIPPED_ENV = /^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|DYLD_.*)$/;

/**
 * The render process's answers media remembers, as a MediaService keeps them (LNX1-RND): the machine's hw-video
 * rows from the host probe (`TAALCUT_FORCE_CPU=1` turns them off: every CPU route reports `disabled`), the working
 * encoder, the tone-map route and the hardware that failed.
 */
export function renderMediaSelection(
  hardware: () => Promise<ProbedHardware>,
): Pick<MediaContext, 'videoBackends' | 'encoders' | 'toneMaps' | 'hardwareFailures'> {
  return {
    videoBackends: new VideoBackendSelection(hardwareVideoBackends(hardware)),
    encoders: new EncoderSelection(),
    toneMaps: new ToneMapSelection(),
    hardwareFailures: new HardwareFailures(),
  };
}

/** `main`: the port to main's services, whose runner is the jobs queue (grade bakes, subject tracks). */
export async function composeRender(
  config: UtilityConfig,
  pid: number = process.pid,
  main?: PortLike,
): Promise<UtilityRoot> {
  // Puppeteer passes this process's environment to Chrome: none of Electron's switches go with it.
  for (const key of Object.keys(process.env)) if (STRIPPED_ENV.test(key)) delete process.env[key];
  const container = registerRenderPorts(createUtilityContainer(config));
  // The Style a render draws (library-phase3.ts), before render-phase3.ts reads it.
  registerLibraryPhase3Render(container, config);
  // REF1: each template's kept reel (the library's template media store, as the agent process registers it), read
  // for the reel's own music in exports, previews and the export dialog (render-reference.ts).
  registerTemplateMedia(container, config);
  // HFW1-WS: the workspace's blobs, which the render worker reads to draw a composition (workspace-store.ts).
  registerWorkspaceStore(container, config);
  // Conform, previews, QA and the producer wait on the same hardware video cap as the jobs process.
  const hardware = macHardware(config.userData);
  registerHardwareSessions(container, config.userData, hardware);
  const selection = renderMediaSelection(hardware);
  // Package resolution works from both bundled utility code and source-level integration tests.
  const renderPackageDir = config.packaged
    ? join(config.resourcesPath, 'render')
    : dirname(dirname(createRequire(import.meta.url).resolve('@taalcut/render')));
  const fontsDir = join(renderPackageDir, 'fonts');
  const binaries = await mediaBinaries(config).resolve();
  // Without FFmpeg the renders list still works; an export then fails with media's error.
  if (!binaries.ok) console.warn(`[render] FFmpeg unavailable: ${binaries.error.code}`);
  // The mixer's ducking envelope under the voice (render-ducking.ts).
  else registerDuckingPlanner(container, { binaries: binaries.value });
  let measurer: Promise<TextMeasurer> | undefined;
  const runner = renderJobRunner(main);
  // EAR1-A2: QA hears the render through the jobs process (render-listener.ts).
  registerSoundListener(container, runner);
  container.factory(
    RenderEngineToken,
    ({ store, settings, clock, events }) =>
      createRenderEngine({
        store,
        timelines: renderTimelines(container),
        assets: renderAssetFiles(container),
        transcripts: renderTranscripts(container),
        // Path d: the reel the template keeps (REF1).
        ...renderReferenceAudio(container, config),
        settings,
        media: {
          binaries: binaries.ok
            ? binaries.value
            : { ffmpeg: 'ffmpeg-unavailable', ffprobe: 'ffprobe-unavailable', source: 'sidecar' },
          ...sessionContext(container),
          ...selection,
        },
        shell: async () =>
          // The jobs process installs the shell component before an export when none is on disk yet (render-jobs.ts).
          resolveHeadlessShell({
            // Unpackaged builds only (the e2e runs, whose HOME is a test folder): a shell already on disk.
            ...(!config.packaged && process.env.TAALCUT_HEADLESS_SHELL
              ? { explicit: process.env.TAALCUT_HEADLESS_SHELL }
              : {}),
            ...(HEADLESS_SHELL_DELIVERY === 'component'
              ? { componentDir: installedShellDir(config.userData) }
              : { bundledDir: join(config.resourcesPath, 'render') }),
            development: !config.packaged,
            packageDir: renderPackageDir,
          }),
        fontsDir,
        measurer: () => (measurer ??= createTextMeasurer(fontsDir)),
        folders: renderPaths(config.userData),
        // HFW1: composition graphics read their files from <userData>/workspaces/<projectId>/blobs, where the
        // library's workspace store writes them (workspace-store.ts). Previews, stills and exports all compile here.
        workspaceRoot: config.userData,
        clock,
        events,
        log: (line) => console.warn(line),
        ...renderPhase3Deps(container, config, runner),
        // LRN1-STY: the pacing band of the set a project is made like (QA's stylePacing).
        ...renderStylePacing(container),
        // AGT2-MATCH: a draft's template and its shots' word (QA's slot match).
        ...renderSlotMatch(container, config, clock, renderMainClient(main)),
        // EAR1-A2: the sound QA checks' listener.
        ...renderListener(container),
      }),
    {
      deps: {
        store: RenderStoreToken,
        settings: SettingsStoreToken,
        clock: ClockToken,
        events: EventBusToken,
      },
      dispose: (engine) => engine.dispose(),
    },
  );
  const engine = container.resolve(RenderEngineToken);
  const os = implementContract(UTILITY_CONTRACTS.render);
  const router = os.router({
    ...commonRouters(container, 'render', pid),
    renders: engine.renders,
    worker: renderWorkerRouter(engine.worker),
  });
  return { container, router };
}

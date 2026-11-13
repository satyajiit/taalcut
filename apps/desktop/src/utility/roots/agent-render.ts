// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render in the agent process (P2-M5, P2-M8, P2-M11): the render, music and
 * caption commands on the bus, and the render, caption and timeline
 * (captureFrame) tool modules. Exports are enqueued on the jobs process and
 * frames captured by the render process, both through main.
 */
import { registerExportFileSink } from './agent-interchange';
import { join } from 'node:path';
import {
  ClockToken,
  GeneratedAssetSinkToken,
  ExportFileSinkToken,
  CommandBusToken,
  EventBusToken,
  jobEnqueuerOverRpc,
  JobRunnerToken,
  RenderStoreToken,
  renderWorkerOverRpc,
  SettingsStoreToken,
  type AnyCommand,
  type Container,
  type SkillModule,
  type ToolModule,
} from '@taalcut/core';
import {
  captionToolModule,
  createCoverExportCommand,
  createCaptionCommands,
  createMusicCommands,
  createRenderCommands,
  createTextMeasurer,
  createRenderSkillModule,
  renderToolModule,
  timelineToolModule,
} from '@taalcut/render';
import { renderFontsDir, renderPaths } from '../../shared/render-paths';
import {
  registerRenderPorts,
  renderTimelines,
  renderTranscripts,
  snapshotExport,
} from '../../shared/render-ports';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { AgentMainServicesToken, ToolRegistryToken } from '../../shared/tokens';
import { footagePicturesOf } from './agent-eyes';
import { canDesign } from './agent-workspace-tools';
import { registerLibraryGenerated } from './library-generated';
import { libraryProvenance } from './library-phase3';
import { videoAgentToolModule } from './match-ports';
import { registerRenderPhase3, renderPhase3Commands, renderPhase3ToolModules } from './render-phase3-agent';

const mainServices = (container: Container) => {
  if (!container.has(AgentMainServicesToken)) throw new Error('No port to main: render is unreachable');
  return container.resolve(AgentMainServicesToken)();
};

/** render.* and music.openReferenceAudioWarning, for bus.register. */
export function renderAgentCommands(container: Container, config: UtilityConfig): readonly AnyCommand[] {
  registerRenderPorts(container);
  registerRenderPhase3(container, config);
  const events = container.resolve(EventBusToken);
  const deps = {
    store: container.resolve(RenderStoreToken),
    enqueuer: jobEnqueuerOverRpc(() => mainServices(container).queue),
    timelines: renderTimelines(container),
    snapshotExport: snapshotExport(container),
    settings: container.resolve(SettingsStoreToken),
    clock: container.resolve(ClockToken),
    folders: renderPaths(config.userData),
    events,
  };
  registerExportFileSink(container);
  registerLibraryGenerated(container);
  const cover = createCoverExportCommand({
    timelines: deps.timelines,
    files: container.resolve(ExportFileSinkToken),
    generatedAssets: container.resolve(GeneratedAssetSinkToken),
    clock: deps.clock,
    worker: renderWorkerOverRpc(() => mainServices(container).render),
  });
  const render = createRenderCommands(deps);
  return [
    ...render.all,
    cover,
    ...createMusicCommands({ events }).all,
    ...renderPhase3Commands(container, deps),
  ] as readonly AnyCommand[];
}

/**
 * captions.*: registered once the text measurer has loaded (harfbuzz starts its WASM then), a moment
 * after start, over the library's stored transcripts (P2-L8).
 */
export function registerCaptionCommandsWhenReady(container: Container, config: UtilityConfig): void {
  const fontsDir = renderFontsDir({
    packaged: config.packaged,
    resourcesPath: config.resourcesPath,
    desktopDir: join(import.meta.dirname, '..', '..'),
  });
  void createTextMeasurer(fontsDir).then(
    (measurer) => {
      const captions = createCaptionCommands({
        timelines: renderTimelines(container),
        transcripts: renderTranscripts(container),
        measurer,
      });
      container.resolve(CommandBusToken).register(...(captions.all as readonly AnyCommand[]));
    },
    (cause: unknown) => console.warn(`[agent] caption commands unavailable: ${String(cause)}`),
  );
}

/**
 * The agent's render and caption tools, and render's `timeline` module (timeline.captureFrame), which
 * agent-timeline.ts folds into the one `timeline` module the agent offers.
 * The gate demo offers the same modules in the same order (agent-make-tools.ts), so its recorded session
 * replays here; a change to any tool means re-recording it (TAALCUT_RECORD=1 pnpm --filter @taalcut/gate-demo test).
 */
export function renderAgentToolModules(container: Container): {
  readonly modules: readonly ToolModule[];
  readonly timeline: ToolModule;
} {
  registerRenderPorts(container);
  return {
    modules: [
      renderToolModule({
        store: container.resolve(RenderStoreToken),
        timelines: renderTimelines(container),
        settings: container.resolve(SettingsStoreToken),
        jobs: container.resolve(JobRunnerToken),
        // P3-V7: the disclosure reminders name generated assets (their stored provenance).
        provenance: libraryProvenance(container),
      }),
      // AGT2-MATCH: video.done, the Maker's finish.
      videoAgentToolModule(container),
      captionToolModule(renderTimelines(container)),
      ...renderPhase3ToolModules(container),
    ],
    timeline: timelineToolModule({
      worker: renderWorkerOverRpc(() => mainServices(container).render),
      // AGT2: the frame as a picture where the person's frames may go to the agent's model.
      pictures: footagePicturesOf(container),
    }),
  };
}

/**
 * The Reviewer (P2-M8): reviews a QA-checked draft of the timeline before the one approval. HFW1-DSN: the Designer,
 * where its workspace tools are offered (agent-workspace-tools.ts), designs the graphics the Editor asks for.
 */
export function renderAgentSkills(container: Container): SkillModule {
  const registered =
    !process.env.TAALCUT_TEST_RECORDED_MODELS && container.has(ToolRegistryToken)
      ? (tool: string) => container.resolve(ToolRegistryToken).describe(tool) !== undefined
      : undefined;
  return createRenderSkillModule({
    store: container.resolve(RenderStoreToken),
    // EAR1-A3: the listening tools, where registered.
    ...(registered ? { registered } : {}),
    ...(canDesign(container)
      ? {
          designer: {
            timelines: renderTimelines(container),
            ...(registered ? { registered } : {}),
          },
        }
      : {}),
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's engine (SPEC section 2): the RenderWorker the jobs
 * process and the agent call (exports, frames), the renders router windows
 * read, preview sessions, and the live progress both share. The render
 * process's composition root builds one and serves `renders` and `worker`
 * from it.
 */
import { err, ok, renderExportJobInputSchema, ValidationError, type RenderWorker } from '@taalcut/core';
import { readExportSettings } from '../settings';
import { rendersRouter } from '../router/renders-router';
import { workspaceFramesOn } from '../workspace/frames/frames';
import { coverImage } from '../cover/cover-image';
import { captureFrame } from './capture-frame';
import type { RenderEngineDeps } from './deps';
import { runExport } from './export-run';
import { createLiveRenders, type LiveRenders } from './live';
import { createPreviewSessions, type PreviewSessions, type PreviewSessionsOptions } from './previews';

/** Idle preview sessions are swept this often. */
export const PREVIEW_SWEEP_MS = 5 * 60_000;

export interface RenderEngine {
  readonly worker: RenderWorker;
  readonly previews: PreviewSessions;
  readonly live: LiveRenders;
  /** Serves UTILITY_CONTRACTS.render.renders. */
  readonly renders: ReturnType<typeof rendersRouter>;
  /** Stops the sweep timer and closes every preview session. */
  dispose(): Promise<void>;
}

export interface RenderEngineOptions {
  readonly previews?: PreviewSessionsOptions;
  /** Default PREVIEW_SWEEP_MS; 0 turns the timer off (tests). */
  readonly sweepMs?: number;
}

export function createRenderEngine(deps: RenderEngineDeps, options: RenderEngineOptions = {}): RenderEngine {
  const live = createLiveRenders(deps.clock.now);
  const previews = createPreviewSessions(deps, options.previews);
  const worker: RenderWorker = {
    export: (input, callOptions = {}) => {
      const parsed = renderExportJobInputSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(err(ValidationError({ field: 'input' }, { detail: parsed.error.message })));
      return runExport(deps, live, parsed.data, callOptions);
    },
    coverImage: (input, callOptions = {}) => coverImage(deps, input, callOptions),
    captureFrame: (input, callOptions = {}) => captureFrame(deps, input, callOptions),
    // HFW1: the Designer's stills of a workspace composition.
    workspaceFrames: (input) => workspaceFramesOn(deps, input),
  };
  const renders = rendersRouter(deps, live, previews, {
    defaultPresetId: async (projectId, canvas, scope) => {
      const settings = await readExportSettings(deps.settings, projectId, canvas, scope);
      return settings.ok ? ok(settings.value.presetId) : ok(null);
    },
  });
  const sweepMs = options.sweepMs ?? PREVIEW_SWEEP_MS;
  const timer =
    sweepMs > 0 ? setInterval(() => void previews.sweep().catch(() => undefined), sweepMs) : undefined;
  timer?.unref?.();
  return {
    worker,
    previews,
    live,
    renders,
    async dispose() {
      if (timer) clearInterval(timer);
      await previews.closeAll();
    },
  };
}

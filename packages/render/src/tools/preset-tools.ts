// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Export format discovery and the saved project choices consumed by render.export. */
import { z } from 'zod';
import {
  defineTool,
  exportPresetIdSchema,
  exportVideoCodecSchema,
  ok,
  type ProjectId,
  type TimelineId,
  ulidSchema,
} from '@taalcut/core';
import { canvasPreset } from '../presets/canvas-preset';
import { defaultPresetFor, EXPORT_PRESETS, presetAvailability, presetCodecs } from '../presets/presets.v1';
import { planTimeline } from '../plan/render-plan';
import { readExportSettings } from '../settings';
import { rateSchema } from './schemas';
import type { RenderToolDeps } from './tool-deps';

const LOCAL_PERMISSION = { network: 'none' } as const;
const READ_RETRY = { maxAttempts: 2, initialDelayMs: 500 };

export function listPresetsTool(deps: RenderToolDeps) {
  return defineTool({
    name: 'render.listPresets',
    version: '1.1.0',
    description:
      'The export presets with whether this timeline fits each (its length and frame rate), the reason when it ' +
      "doesn't, the preset-supported frame rates and codecs, and the rect text must stay inside. " +
      'Codec choices describe preset support; the export checks the machine encoder. Set preset and codec ' +
      'with render.setExportPreset, then call render.export with the reviewed timelineRevision and requested rate.',
    summary: 'The export presets and whether this timeline fits each.',
    tags: ['export', 'preset', 'platform', 'safe-zone'],
    input: z.object({ projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') }),
    output: z.object({
      /** The timeline's current revision, which render.export takes. */
      timelineRevision: z.int().positive(),
      defaultPresetId: exportPresetIdSchema,
      presets: z.array(
        z.object({
          id: exportPresetIdSchema,
          labelKey: z.string(),
          available: z.boolean(),
          reasonKey: z.string().optional(),
          minSeconds: z.int().nonnegative(),
          maxSeconds: z.int().positive(),
          width: z.int().positive(),
          height: z.int().positive(),
          frameRate: z.object({ num: z.int().positive(), den: z.int().positive() }),
          supportedRates: z.array(rateSchema),
          codec: z.string(),
          codecs: z.array(exportVideoCodecSchema),
          safe: z.object({ x: z.int(), y: z.int(), width: z.int(), height: z.int() }),
        }),
      ),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: READ_RETRY,
    permission: LOCAL_PERMISSION,
    run: async (input) => {
      const timeline = await deps.timelines.get(input.timelineId as TimelineId);
      if (!timeline.ok) return timeline;
      const plan = planTimeline(timeline.value);
      if (!plan.ok) return plan;
      const presets = EXPORT_PRESETS.map((entry) => {
        const preset = canvasPreset(entry, timeline.value.canvas);
        const fits = presetAvailability(preset, timeline.value.canvas.rate, plan.value.durationFrames);
        return {
          id: preset.id,
          width: preset.width,
          height: preset.height,
          frameRate: timeline.value.canvas.rate,
          supportedRates: [...preset.rates],
          codec: preset.video.codec,
          codecs: [...presetCodecs(preset)],
          labelKey: preset.labelKey,
          available: fits.available,
          ...(fits.available ? {} : { reasonKey: fits.reasonKey }),
          minSeconds: preset.duration.minSeconds,
          maxSeconds: preset.duration.maxSeconds,
          safe: preset.safe,
        };
      });
      const chosen = await readExportSettings(
        deps.settings,
        input.projectId as ProjectId,
        timeline.value.canvas,
        { timelineId: timeline.value.id, preferCanvas: timeline.value.exportAtCanvasSize },
      );
      const defaultPresetId = chosen.ok ? chosen.value.presetId : defaultPresetFor(timeline.value.canvas);
      return ok({ timelineRevision: timeline.value.revision, defaultPresetId, presets });
    },
  });
}

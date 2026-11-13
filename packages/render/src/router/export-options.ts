// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * renders.exportOptions: what the export dialog offers for a timeline at its
 * latest revision. Every preset with whether it fits (rate, length) and why
 * not, a size and time estimate, the default preset, the music choice and
 * what it still needs, and whether captions can be burned in. REF1: the reel's
 * own music is available when the template keeps it, and the "add this sound
 * in the app" steps carry the reel's link and its sound's credit. LNX1-AV1: each
 * preset's codecs on this machine (media's working hardware encoders); a
 * preset whose only codec can't be encoded here (AV1 without a hardware AV1
 * encoder) is unavailable with that reason, which the picker shows dimmed.
 */
import { canvasPreset } from '../presets/canvas-preset';
import {
  err,
  exportOptionsSchema,
  NotFoundError,
  ok,
  type AsyncResult,
  type ExportOptions,
  type ExportPreset,
  type ExportPresetId,
  type FrameRate,
  type ProjectId,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { RenderEngineDeps } from '../engine/deps';
import { platformSoundSteps } from '../music/paths';
import { NO_REFERENCE_AUDIO } from '../music/reference-audio';
import type { ReferenceCredit } from '../ports';
import { exportCredentials } from './export-credentials';
import { machineEncoders, presetCodecAvailability } from '../presets/codecs';
import { planTimeline } from '../plan/render-plan';
import {
  defaultPresetFor,
  EXPORT_PRESETS,
  presetAvailability,
  videoBitrateKbps,
} from '../presets/presets.v1';

/**
 * Time estimate: a fixed part (shell start, conform of a few clips, mix, finishing) plus a per-frame
 * cost, then QA (decode passes over the file). Measured with test/bench/export-60s.bench.int.test.ts:
 * 60 s at 1080×1920 30 fps with captions took 34.6 s end to end on an M5 Max under load (conform
 * 3.8 s, capture and encode 22.5 s, mix 2.0 s, QA 5.9 s), about 15 ms a frame plus 6 s. These
 * constants keep roughly 1.5× headroom for slower Macs until an M1 measurement replaces them.
 */
export const ESTIMATE = { fixedMs: 6_000, msPerFrame: 22, qaShare: 0.2, containerOverhead: 1.01 } as const;

export function estimateExport(
  preset: ExportPreset,
  rate: FrameRate,
  durationFrames: number,
): { bytes: number; renderMs: number } {
  const seconds = (durationFrames * rate.den) / rate.num;
  const kbps = videoBitrateKbps(preset, rate) + preset.audio.bitrateKbps;
  const bytes = Math.round(((kbps * 1000) / 8) * seconds * ESTIMATE.containerOverhead);
  const renderMs = Math.round(
    (ESTIMATE.fixedMs + durationFrames * ESTIMATE.msPerFrame) * (1 + ESTIMATE.qaShare),
  );
  return { bytes, renderMs };
}

const NO_CREDIT: ReferenceCredit = { referenceUrl: null, soundLabel: null };

/**
 * The music part: whether the template's reel can play (its kept file is here and has sound), and the steps for
 * adding the sound in the app, with the reel's link and credit. The steps come whenever the timeline has the
 * reel's sound to add (a template) or its music is off (path a), so turning the music off shows them at once.
 * A store that can't answer reads as "not here" and "not known": the dialog still opens.
 */
async function musicOptions(deps: RenderEngineDeps, timeline: Timeline): Promise<ExportOptions['music']> {
  const source = deps.referenceAudio ?? NO_REFERENCE_AUDIO;
  const template = timeline.template;
  const file = template ? await source.file(template.id) : ok(null);
  const credit = template && source.credit ? await source.credit(template) : ok(NO_CREDIT);
  const music = timeline.music;
  return {
    current: music,
    referenceAudioAvailable: file.ok && file.value !== null,
    // Nothing to acknowledge since REF1 (the owner's decision of 2026-10-29); the field stays for older windows.
    referenceAudioAcknowledged: true,
    platformSound:
      music.path === 'platformSound' || template !== null
        ? platformSoundSteps(credit.ok ? credit.value : NO_CREDIT)
        : null,
  };
}

export interface ExportOptionsDeps {
  /**
   * The project's chosen preset (render.setExportPreset), or the one the timeline's canvas takes while none is chosen
   * (`readExportSettings`); without it, the canvas's (`defaultPresetFor`).
   */
  readonly defaultPresetId?: (
    projectId: ProjectId,
    canvas: { readonly width: number; readonly height: number },
    scope?: { readonly timelineId: TimelineId; readonly preferCanvas?: boolean | undefined },
  ) => AsyncResult<ExportPresetId | null>;
}

export async function exportOptions(
  deps: RenderEngineDeps,
  input: { readonly projectId: ProjectId; readonly timelineId: TimelineId },
  options: ExportOptionsDeps = {},
): AsyncResult<ExportOptions> {
  const timeline = await deps.timelines.get(input.timelineId);
  if (!timeline.ok) return timeline;
  if (timeline.value.projectId !== input.projectId)
    return err(NotFoundError({ entity: 'timeline', id: input.timelineId }));
  const plan = planTimeline(timeline.value);
  if (!plan.ok) return plan;
  const { rate } = timeline.value.canvas;
  const durationFrames = plan.value.durationFrames;
  const hardware = await machineEncoders(deps.media);
  const presets = EXPORT_PRESETS.map((base) => {
    const preset = canvasPreset(base, timeline.value.canvas);
    const codecs = presetCodecAvailability(preset, hardware);
    // The machine's answer comes first: no length fixes a missing encoder.
    const usable = codecs.find((codec) => codec.available);
    const availability = usable
      ? presetAvailability(preset, rate, durationFrames)
      : { available: false as const, reasonKey: codecs[0]!.reasonKey! };
    return {
      preset,
      available: availability.available,
      ...(availability.available ? {} : { reasonKey: availability.reasonKey }),
      estimate: estimateExport(preset, rate, durationFrames),
      ...(codecs.every((codec) => codec.available) ? {} : { codecs }),
    };
  });
  const { canvas } = timeline.value;
  const chosen = options.defaultPresetId
    ? await options.defaultPresetId(input.projectId, canvas, {
        timelineId: timeline.value.id,
        preferCanvas: timeline.value.exportAtCanvasSize,
      })
    : ok(null);
  const wanted = (chosen.ok ? chosen.value : null) ?? defaultPresetFor(canvas);
  const usable =
    presets.find((entry) => entry.preset.id === wanted && entry.available) ??
    presets.find((entry) => entry.available);
  const music = await musicOptions(deps, timeline.value);
  const captions = timeline.value.captions;
  const credentials = await exportCredentials(deps, input.projectId, timeline.value);
  return ok(
    exportOptionsSchema.parse({
      projectId: input.projectId,
      timelineId: input.timelineId,
      timelineRevision: timeline.value.revision,
      rate,
      durationFrames,
      presets,
      defaultPresetId: usable?.preset.id ?? wanted,
      music,
      captions: {
        available: captions !== null && captions.cues.length > 0,
        enabled: captions?.enabled ?? false,
        language: captions?.language ?? null,
      },
      credentials,
    }),
  );
}

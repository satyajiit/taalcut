// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A project's export settings: the preset, the caption output, Content
 * Credentials (P3-V7) and the Style's bumpers (P3-V10). The
 * agent pre-fills them with `render.setExportPreset`, the exportApproval
 * card changes them, and the `render.export` tool reads them when it runs.
 * One setting per project in core's SettingsStore.
 */
import { z } from 'zod';
import {
  contentCredentialsOptionSchema,
  defineSetting,
  exportPresetIdSchema,
  exportVideoCodecSchema,
  ok,
  renderCaptionsSchema,
  type AsyncResult,
  type ProjectId,
  type TimelineId,
  type SettingDefinition,
  type SettingsStore,
} from '@taalcut/core';
import { DEFAULT_PRESET_ID, defaultPresetFor, presetCodecs, presetFor } from './presets/presets.v1';

export const exportSettingsSchema = z.object({
  presetId: exportPresetIdSchema,
  /** LNX1-AV1: one of the preset's codecs (HEVC for a platform preset); absent: the preset's default. */
  codec: exportVideoCodecSchema.optional(),
  captions: renderCaptionsSchema,
  /** P3-V7: off unless the person turns it on (render.setContentCredentials, person sources only). */
  contentCredentials: contentCredentialsOptionSchema.default({ add: false }),
  /** P3-V10: the Style's intro and outro. */
  includeBumpers: z.boolean().default(true),
});
export type ExportSettings = z.output<typeof exportSettingsSchema>;

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  presetId: DEFAULT_PRESET_ID,
  captions: { burnIn: true, sidecars: [] },
  contentCredentials: { add: false },
  includeBumpers: true,
};

const definitions = new Map<string, SettingDefinition<ExportSettings>>();

/** The setting `render.export.<projectId>`. */
export function exportSettingFor(
  projectId: ProjectId,
  timelineId?: TimelineId,
): SettingDefinition<ExportSettings> {
  const key = timelineId ? `${projectId}.${timelineId}` : projectId;
  let definition = definitions.get(key);
  if (!definition) {
    definition = defineSetting(`render.export.${key}`, exportSettingsSchema, DEFAULT_EXPORT_SETTINGS);
    definitions.set(key, definition);
  }
  return definition;
}

/**
 * The project's settings, or the defaults when there is no store. With the timeline's `canvas`, settings the person
 * never chose take the canvas's preset (BRK1, `defaultPresetFor`): a landscape template's video stays landscape. The
 * store answers the setting's own default value when nothing is stored, which is how "never chosen" is told apart
 * from choosing the vertical default.
 */
export async function readExportSettings(
  settings: SettingsStore | undefined,
  projectId: ProjectId,
  canvas?: { readonly width: number; readonly height: number },
  scope?: { readonly timelineId: TimelineId; readonly preferCanvas?: boolean | undefined },
): AsyncResult<ExportSettings> {
  if (scope) {
    const local = exportSettingFor(projectId, scope.timelineId);
    const chosen = settings ? await settings.get(local) : ok(local.defaultValue);
    if (!chosen.ok) return chosen;
    const project = settings ? await settings.get(exportSettingFor(projectId)) : ok(DEFAULT_EXPORT_SETTINGS);
    if (!project.ok) return project;
    if (chosen.value !== local.defaultValue)
      return ok({ ...chosen.value, contentCredentials: project.value.contentCredentials });
    if (scope.preferCanvas) return ok({ ...project.value, presetId: 'device', codec: undefined });
  }
  const definition = exportSettingFor(projectId);
  const read = settings ? await settings.get(definition) : ok(definition.defaultValue);
  if (!read.ok || !canvas || read.value !== definition.defaultValue) return read;
  return ok({ ...read.value, presetId: defaultPresetFor(canvas) });
}

/** The settings' codec when their preset offers it and it isn't the default: what an export request names. */
export function settingsCodec(settings: ExportSettings): Pick<ExportSettings, 'codec'> {
  const preset = presetFor(settings.presetId);
  const { codec } = settings;
  return codec && codec !== preset.video.codec && presetCodecs(preset).includes(codec) ? { codec } : {};
}

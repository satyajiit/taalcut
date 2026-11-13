// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Command names and payloads for renders, captions and the music choice, so
 * the renderer, ⌘K and the agent dispatch them typed. Handlers live in the
 * owning packages: render and caption commands in @taalcut/render,
 * `music.choosePath` in @taalcut/timeline; all on the agent's bus.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError, type TaalcutError } from '../basics/errors';
import { idSchema, type ProjectId } from '../basics/ids';
import { languageTagSchema } from '../templates/template-parts';
import { captionStyleSchema, captionTrackSchema } from './captions';
import { musicChoiceSchema, REFERENCE_AUDIO_FEATURE, REFERENCE_AUDIO_TERMS_VERSION } from './music';
import { exportPresetIdSchema, exportVideoCodecSchema } from './presets';
import { qaCheckIdSchema } from './qa';
import { exportRequestSchema, renderCaptionsSchema } from './render-types';

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();
const renderId = idSchema<'Render'>();

export const RENDER_COMMANDS = {
  /** write, not undoable. Result { renderId, jobId }; a repeat while queued, running or ready returns that render. */
  export: 'render.export',
  /** write, not undoable. */
  cancel: 'render.cancel',
  /** write; inverse sets the previous value. */
  setNotify: 'render.setNotify',
  /**
   * write; inverse sets the previous settings. The project's export settings (preset, caption output),
   * which the agent's `render.export` tool reads when it runs and the exportApproval card changes.
   */
  setExportPreset: 'render.setExportPreset',
  /** write, not undoable; only checks marked overridable; person sources only (`sources: PERSON_SOURCES`). */
  overrideQa: 'render.overrideQa',
  /** write (soft delete); inverse render.restore. */
  delete: 'render.delete',
  /** internal: delete's inverse. */
  restore: 'render.restore',
  /** P3-V16: write, not undoable, app-wide; one Render per item, each an ordinary render.export job at low priority. */
  exportBatch: 'render.exportBatch',
  /** write, not undoable. */
  cancelBatch: 'render.cancelBatch',
  /** P3-V7: write; inverse sets the previous value; person sources only (the agent never turns credentials on). */
  setContentCredentials: 'render.setContentCredentials',
} as const;

/** One timeline in a batch; unset fields come from the project's export settings. */
export const exportBatchItemSchema = z.object({
  projectId,
  timelineId,
  timelineRevision: z.int().positive().optional(),
  presetId: exportPresetIdSchema.optional(),
  captions: renderCaptionsSchema.optional(),
});
export const EXPORT_BATCH_MODES = ['export', 'draft'] as const;

export const renderCommandPayloads = {
  [RENDER_COMMANDS.export]: exportRequestSchema,
  [RENDER_COMMANDS.cancel]: z.object({ projectId, renderId }),
  [RENDER_COMMANDS.setNotify]: z.object({ projectId, renderId, notify: z.boolean() }),
  [RENDER_COMMANDS.setExportPreset]: z.object({
    projectId,
    timelineId: timelineId.optional(),
    presetId: exportPresetIdSchema,
    /** LNX1-AV1: one of the preset's `video.codecs`; absent: the preset's default. */
    codec: exportVideoCodecSchema.optional(),
    captions: renderCaptionsSchema.optional(),
    /** P3-V10: the Style's intro and outro. */
    includeBumpers: z.boolean().optional(),
  }),
  [RENDER_COMMANDS.overrideQa]: z.object({ projectId, renderId, checks: z.array(qaCheckIdSchema).min(1) }),
  [RENDER_COMMANDS.delete]: z.object({ projectId, renderId }),
  [RENDER_COMMANDS.restore]: z.object({ projectId, renderId }),
  [RENDER_COMMANDS.exportBatch]: z.object({
    batchId: idSchema<'RenderBatch'>(),
    items: z.array(exportBatchItemSchema).min(1).max(50),
    mode: z.enum(EXPORT_BATCH_MODES),
    notify: z.boolean().default(false),
  }),
  [RENDER_COMMANDS.cancelBatch]: z.object({ batchId: idSchema<'RenderBatch'>() }),
  [RENDER_COMMANDS.setContentCredentials]: z.object({ projectId, add: z.boolean() }),
};

export const CAPTION_COMMANDS = {
  setEnabled: 'captions.setEnabled',
  /** Empty text deletes the cue. */
  editText: 'captions.editText',
  setStyle: 'captions.setStyle',
  /** Regroups cues from the transcript; edited cues stay. */
  rebuild: 'captions.rebuild',
  /** internal: every caption command's inverse, the whole previous track. */
  restore: 'captions.restore',
  /** P3-V20: write; every cue's text in another language; inverse captions.restore. */
  applyTranslation: 'captions.applyTranslation',
} as const;

const captionTarget = { projectId, timelineId, revision: z.int().positive().optional() };
export const captionCommandPayloads = {
  [CAPTION_COMMANDS.setEnabled]: z.object({ ...captionTarget, enabled: z.boolean() }),
  [CAPTION_COMMANDS.editText]: z.object({
    ...captionTarget,
    cueId: idSchema<'CaptionCue'>(),
    text: z.string().max(500),
  }),
  [CAPTION_COMMANDS.setStyle]: z.object({
    ...captionTarget,
    style: captionStyleSchema.omit({ version: true }).partial(),
  }),
  [CAPTION_COMMANDS.rebuild]: z.object(captionTarget),
  [CAPTION_COMMANDS.restore]: z.object({ projectId, timelineId, track: captionTrackSchema.nullable() }),
  [CAPTION_COMMANDS.applyTranslation]: z.object({
    ...captionTarget,
    revision: z.int().positive().optional(),
    language: languageTagSchema,
    /**
     * Every cue of the track exactly once (render.translation_mismatch otherwise). Round P3-3: empty text drops
     * that cue, as in `captions.editText` (a translated sentence with fewer words than the cues it spans).
     */
    cues: z
      .array(z.object({ cueId: idSchema<'CaptionCue'>(), text: z.string().trim().max(500) }))
      .min(1)
      .max(5000),
  }),
};

export const MUSIC_COMMANDS = {
  /**
   * write; inverse `timeline.restore` with the previous choice (and the cuts a re-time to the user's own track
   * moved). Never removes an acknowledgement.
   */
  choosePath: 'music.choosePath',
  /** read: emits ui.action to open the warning card (the fix on render.acknowledgement_required). */
  openReferenceAudioWarning: 'music.openReferenceAudioWarning',
} as const;

/**
 * @deprecated Since REF1 (owner decision, 2026-10-29) path d needs no acknowledgement and nothing raises this; it
 * stays so stored errors and QA reports still read.
 *
 * Keeping the reference's own audio (path d) without a stored acknowledgement. `music.choosePath` (handled by
 * @taalcut/timeline), render's preflight and QA return it; declared here because timeline may not import
 * render. Raise it with `referenceAudioAcknowledgementRequired`, which carries the fix.
 */
export const RenderAcknowledgementRequired = defineError<{ feature: string }>(
  'render.acknowledgement_required',
);

/** The error for a project, with its fix: open the warning card at the current terms. */
export function referenceAudioAcknowledgementRequired(projectId: ProjectId): TaalcutError {
  return RenderAcknowledgementRequired(
    { feature: REFERENCE_AUDIO_FEATURE },
    {
      fix: {
        command: MUSIC_COMMANDS.openReferenceAudioWarning,
        labelKey: 'fix.openReferenceAudioWarning',
        payload: { projectId, termsVersion: REFERENCE_AUDIO_TERMS_VERSION },
      },
    },
  );
}

export const musicCommandPayloads = {
  [MUSIC_COMMANDS.choosePath]: z.object({
    projectId,
    timelineId,
    choice: musicChoiceSchema,
    /**
     * Set only when the user just pressed "I understand" on the warning card: records the acknowledgement
     * (REFERENCE_AUDIO_FEATURE, REFERENCE_AUDIO_TERMS_VERSION). Refused from the 'agent' and 'mcp' sources.
     */
    acknowledgedAt: z.int().nonnegative().optional(),
  }),
  [MUSIC_COMMANDS.openReferenceAudioWarning]: z.object({
    projectId,
    termsVersion: z.string().min(1).max(100),
  }),
};

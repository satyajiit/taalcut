// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timelines.planCleanup` (P3-V9): the cleanup a timeline would get with the app's settings (CLEANUP_SETTING)
 * and any per-call changes, from audio's analysis of each talking clip's asset. Reads only; the editor shows it
 * ("Remove 14 fillers, shorten 9 pauses, cut 2 retakes: 11 s shorter") and `timeline.applyCleanup` applies it.
 */
import {
  CLEANUP_SETTING,
  cleanupSettingsSchema,
  err,
  newId,
  ok,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type CleanupPlan,
  type CleanupSettings,
  type SettingsStore,
  type SpeechCleanupAnalysis,
  type SpeechCleanupSource,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { cleanableClips, planCleanup } from './plan-cleanup';

export interface CleanupReadDeps {
  readonly read: (timelineId: TimelineId) => AsyncResult<Timeline>;
  readonly speech: SpeechCleanupSource;
  /** The app-wide defaults; absent: CLEANUP_SETTING's defaults. */
  readonly settings?: Pick<SettingsStore, 'get'>;
}

export function createCleanupReads(deps: CleanupReadDeps) {
  async function settingsFor(changes: Partial<CleanupSettings> | undefined): AsyncResult<CleanupSettings> {
    const stored = deps.settings ? await deps.settings.get(CLEANUP_SETTING) : null;
    if (stored && !stored.ok) return stored;
    const merged = cleanupSettingsSchema.safeParse({ ...(stored?.value ?? CLEANUP_SETTING.defaultValue), ...changes });
    if (merged.success) return ok(merged.data);
    return err(ValidationError({ field: 'settings' }, { detail: merged.error.issues[0]?.message ?? '' }));
  }

  async function analyses(timeline: Timeline): AsyncResult<Map<AssetId, SpeechCleanupAnalysis>> {
    const out = new Map<AssetId, SpeechCleanupAnalysis>();
    for (const clip of cleanableClips(timeline)) {
      const assetId = clip.media.assetId;
      if (out.has(assetId)) continue;
      const found = await deps.speech.get(assetId);
      if (!found.ok) return found;
      if (found.value) out.set(assetId, found.value);
    }
    return ok(out);
  }

  return {
    async planCleanup(timelineId: TimelineId, changes?: Partial<CleanupSettings>): AsyncResult<CleanupPlan> {
      const timeline = await deps.read(timelineId);
      if (!timeline.ok) return timeline;
      const settings = await settingsFor(changes);
      if (!settings.ok) return settings;
      const found = await analyses(timeline.value);
      if (!found.ok) return found;
      return planCleanup(timeline.value, found.value, settings.value, () => newId<'TimelineItem'>());
    },
  };
}

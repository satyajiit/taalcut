// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details as the real handlers write them (logs): never shown as words */

/**
 * Putting a look on things (P3-V10, P3-V16), as the real handlers do it:
 * - template.setStyle (@taalcut/templates template-set-style.ts): a new template version naming the Style,
 *   through the fake's templates (inverse template.setHead); a missing Style is `templates.style_not_found`.
 * - timeline.setStyle (@taalcut/timeline style-commands.ts): the video's Style and its captions' look, one undo
 *   step (timeline.restore with the style and captions as they were); `timeline.style_not_found`.
 * - batch.applyStyle (batch-commands.ts, batch-edits.ts): one look on up to 50 videos in any projects, app-wide
 *   (`project: () => null`), all or nothing: a video listed twice, a missing one or one outside the project it
 *   names fails the batch before anything is written. Its inverse, batch.restoreStyles, puts back only the videos
 *   still at the revision the batch left; the others are listed 'changedSince'.
 */
import {
  BATCH_COMMANDS,
  batchCommandPayloads,
  defineCommand,
  err,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelineSchema,
  ValidationError,
  type AnyCommand,
  type BatchApply,
  type BatchStyleResult,
  type Result,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { FakeTimelines } from '../../make/fake-timelines';
import type { FakeTemplates } from '../../templates/fake-templates';
import { applyBatchLook, restoreLook, setStyle, type BatchLook } from './look-edits';
import { styleNotFound, timelineNotFound, timelineStyleNotFound } from './style-errors';
import type { StyleState } from './style-state';

type Skipped = BatchStyleResult['skipped'][number];
interface Edited {
  readonly before: Timeline;
  readonly after: Timeline;
}

export interface ApplyDeps {
  readonly store: StyleState;
  readonly templates: FakeTemplates;
  readonly timelines: FakeTimelines;
}

/** timeline.restore with the look as it was: the fake's default inverse doesn't carry the Style. */
const restoreInverse = (before: Timeline) => ({
  name: TIMELINE_COMMANDS.restore,
  payload: {
    projectId: before.projectId,
    timelineId: before.id,
    styleId: before.styleId,
    captions: before.captions,
  },
});

export function createApplyCommands({ store, templates, timelines }: ApplyDeps): AnyCommand[] {
  /** readFor: the video, if it is in the project the payload names. */
  function read(item: { readonly projectId: string; readonly timelineId: TimelineId }): Result<Timeline> {
    const found = timelines.get(item.timelineId);
    return found && found.projectId === item.projectId ? ok(found) : err(timelineNotFound(item.timelineId));
  }

  function lookFor(apply: BatchApply): Result<BatchLook> {
    if (apply.kind === 'captionPreset') return ok({ kind: 'captionPreset', presetId: apply.presetId });
    const style = store.get(apply.styleId);
    return style.ok ? ok({ kind: 'style', style: style.value }) : err(timelineStyleNotFound(apply.styleId));
  }

  /** Checks every edited video first, then writes them: the fake's stand-in for one unit of work. */
  function writeAll(edited: readonly Edited[]) {
    for (const { after } of edited) {
      const checked = timelineSchema.safeParse({ ...after, revision: after.revision + 1 });
      if (!checked.success)
        return err(ValidationError({ field: 'items' }, { detail: checked.error.issues[0]?.message }));
    }
    const restore = [];
    for (const { before, after } of edited) {
      const written = timelines.write(before.projectId, before, { ok: true, timeline: after });
      if (!written.ok) return written;
      restore.push({
        projectId: before.projectId,
        timelineId: before.id,
        styleId: before.styleId,
        captions: before.captions,
        revision: written.value.result.revision,
      });
    }
    return ok(restore);
  }

  const templateSetStyle = defineCommand({
    name: TEMPLATE_COMMANDS.setStyle,
    payload: templateCommandPayloads[TEMPLATE_COMMANDS.setStyle],
    sideEffect: 'write',
    handle: ({ projectId, templateId, baseVersion, styleId }, context) => {
      if (styleId !== null && !store.has(styleId)) return err(styleNotFound());
      return templates.edit(
        { templateId, baseVersion, projectId },
        context.source,
        TEMPLATE_COMMANDS.setStyle,
        (template) => ({ ok: true, template: { ...template, styleId } }),
      );
    },
  });

  const timelineSetStyle = defineCommand({
    name: TIMELINE_COMMANDS.setStyle,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.setStyle],
    sideEffect: 'write',
    handle: (payload) => {
      let look = null;
      if (payload.styleId !== null) {
        const style = store.get(payload.styleId);
        if (!style.ok) return err(timelineStyleNotFound(payload.styleId));
        look = style.value;
      }
      const before = read(payload);
      if (!before.ok) return before;
      const after = setStyle(before.value, look);
      return timelines.write(
        payload.projectId,
        before.value,
        { ok: true, timeline: after },
        restoreInverse(before.value),
      );
    },
  });

  const applyStyle = defineCommand({
    name: BATCH_COMMANDS.applyStyle,
    payload: batchCommandPayloads[BATCH_COMMANDS.applyStyle],
    sideEffect: 'write',
    project: () => null,
    handle: ({ items, apply }) => {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.timelineId))
          return err(ValidationError({ field: 'items' }, { detail: `${item.timelineId} is listed twice` }));
        seen.add(item.timelineId);
      }
      const look = lookFor(apply);
      if (!look.ok) return look;
      const edited: Edited[] = [];
      const applied: TimelineId[] = [];
      const skipped: Skipped[] = [];
      for (const item of items) {
        const before = read(item);
        if (!before.ok) return before;
        const after = applyBatchLook(before.value, look.value);
        if (after === 'noCaptions') {
          skipped.push({ timelineId: before.value.id, reason: 'noCaptions' });
          continue;
        }
        applied.push(before.value.id);
        if (after !== before.value) edited.push({ before: before.value, after });
      }
      const restore = writeAll(edited);
      if (!restore.ok) return restore;
      const result: BatchStyleResult = { applied, skipped };
      if (restore.value.length === 0) return ok({ result });
      return ok({
        result,
        inverse: { name: BATCH_COMMANDS.restoreStyles, payload: { items: restore.value } },
      });
    },
  });

  const restoreStyles = defineCommand({
    name: BATCH_COMMANDS.restoreStyles,
    payload: batchCommandPayloads[BATCH_COMMANDS.restoreStyles],
    sideEffect: 'write',
    internal: true,
    project: () => null,
    // Undo runs this; redo runs batch.applyStyle again, so it needs no inverse of its own.
    handle: ({ items }) => {
      const edited: Edited[] = [];
      const applied: TimelineId[] = [];
      const skipped: Skipped[] = [];
      for (const item of items) {
        const current = read(item);
        if (!current.ok || current.value.revision !== item.revision) {
          skipped.push({ timelineId: item.timelineId, reason: 'changedSince' });
          continue;
        }
        applied.push(current.value.id);
        const after = restoreLook(current.value, item);
        if (after !== current.value) edited.push({ before: current.value, after });
      }
      const written = writeAll(edited);
      const result: BatchStyleResult = { applied, skipped };
      return written.ok ? ok({ result }) : written;
    },
  });

  return [templateSetStyle, timelineSetStyle, applyStyle, restoreStyles];
}

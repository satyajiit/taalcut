// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The read-and-edit half of batch.applyStyle and batch.restoreStyles (P3-V16): every video is read and edited in
 * memory before anything is written, so the batch either writes them all or none (batch-commands.ts writes).
 */
import {
  err,
  ConflictError,
  NotImplementedError,
  ok,
  ValidationError,
  type AsyncResult,
  type BATCH_COMMANDS,
  type BatchApply,
  type BatchStyleResult,
  type batchCommandPayloads,
  type Result,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { z } from 'zod';
import type { EditResult } from '../edits/types';
import { TimelineNotFound } from '../errors';
import { applyBatchLook, restoreLook, type BatchLook } from '../styles/batch-style';
import { readStyle } from '../styles/read-style';
import { readFor, type CommandDeps } from './context';

type Payloads = typeof batchCommandPayloads;
export type ApplyPayload = z.output<Payloads[typeof BATCH_COMMANDS.applyStyle]>;
export type RestorePayload = z.output<Payloads[typeof BATCH_COMMANDS.restoreStyles]>;
type Skipped = BatchStyleResult['skipped'][number];

/** A video read and edited, not yet written. */
export interface Edited {
  readonly before: Timeline;
  readonly edit: EditResult;
}

/** Every video's edit, and what the result reports, before any write. */
export interface BatchEdits {
  readonly edited: Edited[];
  readonly result: BatchStyleResult;
}

/** A video named twice would be written twice in one unit of work: refused before anything is read. */
function once(items: ApplyPayload['items']): Result<void> {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.timelineId))
      return err(ValidationError({ field: 'items' }, { detail: `${item.timelineId} is listed twice` }));
    seen.add(item.timelineId);
  }
  return ok(undefined);
}

/** The look a batch puts on: a caption preset as it is, a Style read from the store. */
async function lookFor(deps: CommandDeps, apply: BatchApply): AsyncResult<BatchLook> {
  if (apply.kind === 'captionPreset') return ok({ kind: 'captionPreset', presetId: apply.presetId });
  if (!deps.styles) return err(NotImplementedError({ feature: 'timeline.styles' }));
  const style = await readStyle(deps.styles, apply.styleId);
  return style.ok ? ok({ kind: 'style', style: style.value }) : style;
}

/** batch.applyStyle's edits: a missing video fails the batch; one the look doesn't fit is skipped and listed. */
export async function applyEdits(
  deps: CommandDeps,
  payload: ApplyPayload,
  redo = false,
): AsyncResult<BatchEdits> {
  const unique = once(payload.items);
  if (!unique.ok) return unique;
  const look = await lookFor(deps, payload.apply);
  if (!look.ok) return look;
  const edited: Edited[] = [];
  const applied: TimelineId[] = [];
  const skipped: Skipped[] = [];
  for (const item of payload.items) {
    const current = await readFor(deps.store, item.timelineId, item.projectId);
    if (!current.ok) return current;
    if (!redo && item.revision !== undefined && item.revision !== current.value.revision)
      return err(ConflictError({ entity: 'timeline', id: item.timelineId }));
    const outcome = applyBatchLook(current.value, look.value);
    if (!outcome.ok) return outcome;
    if (outcome.value.kind === 'skipped') {
      skipped.push({ timelineId: current.value.id, reason: outcome.value.reason });
      continue;
    }
    applied.push(current.value.id);
    edited.push({ before: current.value, edit: outcome.value.edit });
  }
  return ok({ edited, result: { applied, skipped } });
}

/** batch.restoreStyles' edits: a video gone, or changed after the batch, keeps the person's later change. */
export async function restoreEdits(deps: CommandDeps, payload: RestorePayload): AsyncResult<BatchEdits> {
  const edited: Edited[] = [];
  const applied: TimelineId[] = [];
  const skipped: Skipped[] = [];
  for (const item of payload.items) {
    const current = await readFor(deps.store, item.timelineId, item.projectId);
    if (!current.ok && !TimelineNotFound.is(current.error)) return current;
    if (!current.ok || current.value.revision !== item.revision) {
      skipped.push({ timelineId: item.timelineId, reason: 'changedSince' });
      continue;
    }
    const edit = restoreLook(current.value, item);
    if (!edit.ok) return edit;
    applied.push(current.value.id);
    edited.push({ before: current.value, edit: edit.value });
  }
  return ok({ edited, result: { applied, skipped } });
}

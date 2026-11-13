// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The only way a file reaches the renders folder (gate criterion 4,
 * docs/qa-gate.md rule 1). `finalizeRender` moves the QA-checked file from
 * the work folder into `renders/` and marks the render ready, and refuses
 * without a report whose verdict is passed, passedWithWarnings or
 * overridden. Nothing else in the package writes status 'ready': a test
 * scans the sources for it.
 */
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  err,
  ok,
  ValidationError,
  type AsyncResult,
  type Clock,
  type QaCheckId,
  type QaReport,
  type RenderId,
  type RenderRecord,
  type RenderStore,
  type Result,
} from '@taalcut/core';
import { OverrideRefused, QaNotPassed } from '../errors';
import { DELIVERABLE_VERDICTS, summarize, verdictOf } from './verdict';

export interface FinalizeFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  stat(path: string): Promise<{ size: number }>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const NODE_FS: FinalizeFs = { rename, copyFile, mkdir, stat, rm };

export interface FinalizeDeps {
  readonly store: Pick<RenderStore, 'get' | 'update'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly fs?: FinalizeFs;
}

export interface FinalizeInput {
  readonly renderId: RenderId;
  /** The muxed, checked file in the work folder. */
  readonly workFile: string;
  /** `<library>/renders/<projectId>/<renderId>.mp4`. */
  readonly destination: string;
  readonly report: QaReport;
  /** SRT and VTT written next to the file when requested. */
  readonly sidecars?: readonly { readonly from: string; readonly to: string }[];
}

/** A rename on one volume; a copy to `.part`, a rename and a delete across volumes. */
async function move(fs: FinalizeFs, from: string, to: string): Promise<void> {
  await fs.mkdir(dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause;
    const part = `${to}.part`;
    await fs.copyFile(from, part);
    await fs.rename(part, to);
    await fs.rm(from, { force: true });
  }
}

/** Refuses unless QA passed (or the user overrode it); then delivers the file and marks the render ready. */
export async function finalizeRender(deps: FinalizeDeps, input: FinalizeInput): AsyncResult<RenderRecord> {
  const { report } = input;
  if (report.renderId !== input.renderId)
    return err(ValidationError({ field: 'report.renderId' }, { detail: 'QA report is for another render' }));
  if (!DELIVERABLE_VERDICTS.has(report.verdict) || verdictOf(report.checks, report.overrides) !== report.verdict)
    return err(QaNotPassed({ verdict: report.verdict }));
  const record = await deps.store.get(input.renderId);
  if (!record.ok) return record;
  if (record.value.status === 'cancelled' || record.value.deletedAt !== null)
    return err(QaNotPassed({ verdict: record.value.status }));
  const fs = deps.fs ?? NODE_FS;
  try {
    await move(fs, input.workFile, input.destination);
    for (const sidecar of input.sidecars ?? []) await move(fs, sidecar.from, sidecar.to);
  } catch (cause) {
    return err(ValidationError({ field: 'destination' }, { detail: `Could not move the render: ${String(cause)}` }));
  }
  const bytes = (await fs.stat(input.destination)).size;
  const updated = await deps.store.update(input.renderId, {
    status: 'ready',
    filePath: input.destination,
    bytes,
    qa: summarize(report),
    qaReport: report,
    error: null,
    finishedAt: deps.clock.now(),
  });
  if (!updated.ok) {
    // The row didn't take it: put the file back so no unrecorded file sits in renders/.
    await move(fs, input.destination, input.workFile).catch(() => undefined);
    return updated;
  }
  return updated;
}

/** QA failed and the fixes ran out: the file stays in the work folder, the render waits for the user. */
export async function markNeedsAttention(
  deps: Pick<FinalizeDeps, 'store' | 'clock'>,
  input: { readonly renderId: RenderId; readonly report: QaReport },
): AsyncResult<RenderRecord> {
  return deps.store.update(input.renderId, {
    status: 'needsAttention',
    qa: summarize(input.report),
    qaReport: input.report,
    finishedAt: deps.clock.now(),
  });
}

/**
 * "Export anyway": records an override for each named check. Only failing, overridable checks may be
 * overridden; the command's `sources: PERSON_SOURCES` keeps the agent out. The verdict becomes
 * `overridden` once every failing check is overridden.
 */
export function overrideQa(
  report: QaReport,
  checks: readonly QaCheckId[],
  actor: string,
  at: number,
): Result<QaReport> {
  for (const id of checks) {
    const check = report.checks.find((candidate) => candidate.id === id);
    if (!check || check.status !== 'fail' || !check.overridable) return err(OverrideRefused({ check: id }));
  }
  const already = new Set(report.overrides.map((entry) => entry.check));
  const overrides = [
    ...report.overrides,
    ...checks.filter((id) => !already.has(id)).map((check) => ({ check, at, actor })),
  ];
  return ok({ ...report, overrides, verdict: verdictOf(report.checks, overrides) });
}

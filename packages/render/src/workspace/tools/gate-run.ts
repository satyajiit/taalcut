// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition at the head, gated (HFW1 "dsn"): its entry read from the store, the assets it names, the gate (render's
 * own, gate/workspace-gate.ts) and the composition's hash over exactly those files. `workspace.lint`, `render`,
 * `place` and `replace` all gate the same way, so what was looked at is what is placed.
 */
import { compositionHash, ok, type AsyncResult, type ProjectId, type WorkspaceFile } from '@taalcut/core';
import { z } from 'zod';
import { gateComposition, type GateFile, type WorkspaceGateResult } from '../gate/workspace-gate';
import type { WorkspaceToolDeps } from './deps';
import { compositionFiles, fileAt, headOf, textOf, type Head } from './workspace-io';

export interface GatedEntry {
  readonly head: Head;
  readonly entry: WorkspaceFile;
  readonly text: string;
  readonly files: readonly GateFile[];
  /** sha256 over the files (core `compositionHash`): the composition's `hash` when it is kept. */
  readonly hash: string;
  readonly result: WorkspaceGateResult;
}

export async function gateEntry(
  deps: WorkspaceToolDeps,
  projectId: ProjectId,
  path: string,
): AsyncResult<GatedEntry> {
  const head = await headOf(deps.store, projectId);
  if (!head.ok) return head;
  const entry = fileAt(head.value, path);
  if (!entry.ok) return entry;
  const text = await textOf(deps.store, projectId, entry.value);
  if (!text.ok) return text;
  const files = compositionFiles(head.value, entry.value, text.value);
  const gate = deps.gate ?? gateComposition;
  const result = await gate({ entry: path, files, ...(deps.now ? { now: deps.now() } : {}) });
  const hash = await compositionHash(files);
  return ok({ head: head.value, entry: entry.value, text: text.value, files, hash, result });
}

/** A finding as the model reads it. */
export const findingSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  fixHint: z.string(),
});

/** The findings for the model: errors first, at most `max`, each with what to do. */
export const findingsOf = (result: WorkspaceGateResult, max = 20) =>
  result.findings.slice(0, max).map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    fixHint: finding.fixHint,
  }));

/** One line for a refusal: the first errors and their fixes. */
export function refusalText(result: WorkspaceGateResult, max = 3): string {
  const errors = result.findings.filter((finding) => finding.severity === 'error').slice(0, max);
  const lines = errors.map((finding) => `${finding.code}: ${finding.message}. ${finding.fixHint}`);
  return `The composition did not pass the gate: ${lines.join(' | ')}. Fix it and workspace.lint it again.`;
}

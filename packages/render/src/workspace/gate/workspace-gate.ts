// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate over a workspace's files (HFW1 "hf: gate"), as the Designer's `workspace.lint` and `setComposition` run
 * it: the files' limits (32 files, 64 KB each, 2 MB in all, plain paths), the entry's text against its sha256,
 * HyperFrames' lint, Taalcut's markup and CSS allowlists, the lowering, and every `url()` and image naming an asset
 * the files hold by its own sha256. It always answers with the core `CompositionGate` report (each check's status
 * and what to fix) and every finding, and with the prepared composition only when nothing failed.
 */
import { createHash } from 'node:crypto';
import {
  type CompositionGate,
  type GraphicParam,
  WORKSPACE_LIMITS,
  workspacePathSchema,
} from '@taalcut/core';
import { assetReferences } from './assets';
import { readComposition } from './document';
import { refusal, type WorkspaceFinding } from './finding';
import { gateHtml } from './gate';
import { gateReport } from './gate-report';
import type { PreparedComposition } from './prepare';

/** The gate's version (`CompositionGate.version`): a newer gate checks a kept composition again. */
export const GATE_VERSION = 'hfw1.1';

/** A workspace file as the gate reads it: its record, and its text when it is one the gate reads (the entry). */
export interface GateFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly text?: string;
}

export interface WorkspaceGateInput {
  /** The file with the composition's root (`data-composition-id`). */
  readonly entry: string;
  /** Every file of the composition: the entry with its text, and the assets it loads. */
  readonly files: readonly GateFile[];
  /** When it was checked (ms since the epoch; default now). */
  readonly now?: number;
}

export { assetReferences };

export interface WorkspaceGateResult {
  readonly gate: CompositionGate;
  /** Every finding, errors first, each with its fix hint. */
  readonly findings: readonly WorkspaceFinding[];
  /** The composition ready to fold, when it passed. */
  readonly prepared?: PreparedComposition;
  /** Its variables and length, when its document could be read. */
  readonly variables: readonly GraphicParam[];
  readonly durationSeconds?: number;
}

const LIMIT_HINT = 'Keep a composition to 32 files of at most 64 KB each and 2 MB in all.';

/** The files' own limits: count, sizes, paths, the entry and its text. */
function fileFindings(input: WorkspaceGateInput): WorkspaceFinding[] {
  const findings: WorkspaceFinding[] = [];
  const { files } = input;
  if (files.length > WORKSPACE_LIMITS.files)
    findings.push(refusal('gate.files', `the composition has ${files.length} files`, LIMIT_HINT));
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > WORKSPACE_LIMITS.workspaceBytes)
    findings.push(refusal('gate.size', `the files hold ${total} bytes`, LIMIT_HINT));
  const seen = new Set<string>();
  for (const file of files) {
    if (!workspacePathSchema.safeParse(file.path).success)
      findings.push(
        refusal(
          'gate.path',
          `${file.path.slice(0, 60)} is not a workspace path`,
          'Name files with relative paths of letters, digits, ".", "-" and "_", without .. or a leading /.',
        ),
      );
    if (seen.has(file.path))
      findings.push(refusal('gate.path', `${file.path} is listed twice`, 'List each file once.'));
    seen.add(file.path);
    if (file.bytes > WORKSPACE_LIMITS.fileBytes)
      findings.push({ ...refusal('gate.size', `${file.path} is over 64 KB`, LIMIT_HINT), file: file.path });
  }
  const entry = files.find((file) => file.path === input.entry);
  if (!entry)
    findings.push(
      refusal(
        'gate.entry',
        `the entry ${input.entry} is not among the files`,
        'Name a file you wrote as the entry.',
      ),
    );
  else if (entry.text === undefined)
    findings.push(
      refusal('gate.entry', `the entry ${input.entry} was given without its text`, 'Read the entry.'),
    );
  else if (
    Buffer.byteLength(entry.text, 'utf8') !== entry.bytes ||
    createHash('sha256').update(entry.text, 'utf8').digest('hex') !== entry.sha256
  )
    findings.push(
      refusal(
        'gate.entry',
        `the entry's text is not the file ${entry.sha256.slice(0, 12)}…`,
        'Read it again.',
      ),
    );
  return findings;
}

/** Each loaded path is one of the files, and the sha256 its path names is that file's. */
function assetFindings(prepared: PreparedComposition, files: readonly GateFile[]): WorkspaceFinding[] {
  const findings: WorkspaceFinding[] = [];
  for (const path of assetReferences(prepared)) {
    const file = files.find((candidate) => candidate.path === path);
    const named = /^assets\/([0-9a-f]{64})$/.exec(path)?.[1];
    if (!file)
      findings.push(
        refusal(
          'gate.asset',
          `${path.slice(0, 80)} is not one of the composition's files`,
          'Write the image into the workspace first and load it by its path, assets/<sha256>.',
        ),
      );
    else if (named !== file.sha256)
      findings.push(
        refusal(
          'gate.asset',
          `${path.slice(0, 80)} does not hold the file its name says`,
          'Name an asset by the sha256 of its own bytes.',
        ),
      );
  }
  return findings;
}

/** Gates a composition's files and reports on them (the record a kept composition carries). */
export async function gateComposition(input: WorkspaceGateInput): Promise<WorkspaceGateResult> {
  const checkedAt = input.now ?? Date.now();
  const limits = fileFindings(input);
  const entry = input.files.find((file) => file.path === input.entry);
  if (limits.length > 0 || entry?.text === undefined)
    return {
      gate: gateReport({ version: GATE_VERSION, checkedAt, findings: limits }),
      findings: limits,
      variables: [],
    };
  const gated = await gateHtml(entry.text, entry.path);
  const prepared = gated.ok ? gated.value : undefined;
  const assets = prepared ? assetFindings(prepared, input.files) : [];
  const findings = gated.ok ? [...assets, ...gated.warnings] : gated.findings;
  const all = [
    ...findings.filter((f) => f.severity === 'error'),
    ...findings.filter((f) => f.severity !== 'error'),
  ];
  const gate = gateReport({
    version: GATE_VERSION,
    checkedAt,
    findings: all,
    loweredTweens: prepared?.motion.tweens.length ?? 0,
    urlsChecked: prepared !== undefined,
  });
  // A refused composition still says its variables and length when its document reads.
  const read = prepared ? undefined : readComposition(entry.text);
  const document = prepared?.doc ?? (read?.ok ? read.value : undefined);
  return {
    gate,
    findings: all,
    ...(gate.passed && prepared ? { prepared } : {}),
    variables: document?.variables ?? [],
    ...(document ? { durationSeconds: document.durationSeconds } : {}),
  };
}

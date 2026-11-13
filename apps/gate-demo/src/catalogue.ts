// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's tool catalogue as a recorded session saw it: one line per tool, in the order its composition registers
 * them, with a hash of what the model is offered for it (family, summary, description, tags and input schema). Tool
 * search ranks with BM25 over the whole catalogue, so one tool more or less, or one reworded, changes which tools
 * `findTools` and a skill's route load, and the requests stop matching the cassette (LRN1-FIX: the desktop's
 * `plugins` module, missing here, broke the gate demo's replay; the style tools, added after the make flow was
 * recorded, broke its). Each session keeps the catalogue it was recorded with beside its cassette
 * (`RecordedSession.catalogue`, written by whatever records it), and each composition that replays a session is
 * checked against that session's file by its own test: this package's (test/catalogue.test.ts) and the desktop's
 * agent process (its test/agent-catalogue.test.ts). Plain text, one tool a line, since that is what they compare:
 * a re-record's diff names each tool that changed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, type ToolModule } from '@taalcut/core';
import { createToolRegistry } from '@taalcut/tools';
import { GATE_DEMO_FIXTURES, isRecording, type RecordedSession } from './recorded-models';

/** The file's header, as # lines: what it is, who writes it, who reads it. */
const header = (session: RecordedSession) => [
  `The tools the ${session.name} session was recorded with: module, tool, hash of what the model sees.`,
  `Written when it is recorded: ${session.rerecord}.`,
  'Every composition that replays it must offer exactly this list, in this order.',
];

/** Where a session's recording writes its catalogue and the checks read it. */
const cataloguePath = (session: RecordedSession, fixturesDir: string) => join(fixturesDir, session.catalogue);

const fingerprint = (offered: unknown) =>
  createHash('sha256').update(JSON.stringify(offered)).digest('hex').slice(0, 12);

/** "<module> <tool> <hash>" for every tool of `modules`, in their order. */
export function catalogueOf(modules: readonly ToolModule[]): string[] {
  const registry = unwrap(createToolRegistry(modules));
  return modules.flatMap((module) =>
    module.tools.map((tool) => {
      const described = registry.describe(tool.name, tool.version);
      if (!described) throw new Error(`${tool.name} ${tool.version} is missing from its own registry`);
      const { family, summary, description, tags } = described;
      const [schema] = unwrap(registry.loadSchemas([tool.name]));
      return `${module.id} ${tool.name} ${fingerprint([family, summary, description, tags, schema?.inputSchema])}`;
    }),
  );
}

/** The catalogue `session` was recorded with; undefined before a recording has written one. */
export function recordedCatalogue(
  session: RecordedSession,
  fixturesDir: string = GATE_DEMO_FIXTURES,
): readonly string[] | undefined {
  const path = cataloguePath(session, fixturesDir);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Records `tools` as the catalogue `session` was recorded with, under the header. */
export function writeRecordedCatalogue(
  session: RecordedSession,
  tools: readonly string[],
  fixturesDir: string = GATE_DEMO_FIXTURES,
): void {
  const lines = [...header(session).map((line) => `# ${line}`), ...tools, ''];
  writeFileSync(cataloguePath(session, fixturesDir), lines.join('\n'));
}

/**
 * While any of `sessions` is being recorded (TAALCUT_RECORD, isRecording), writes the catalogue `modules` offer as
 * that session's: the gate demo's tests call it for theirs, the desktop's agent process for the sessions it records.
 */
export function recordCatalogues(
  sessions: readonly RecordedSession[],
  modules: readonly ToolModule[],
  fixturesDir: string = GATE_DEMO_FIXTURES,
): void {
  const recording = sessions.filter(isRecording);
  if (recording.length === 0) return;
  const tools = catalogueOf(modules);
  for (const session of recording) writeRecordedCatalogue(session, tools, fixturesDir);
}

/**
 * How `offered` differs from `recorded`: "+ line" offered but not recorded, "- line" recorded but not offered, and
 * one "order" line when the same tools come in another order. Empty when they are the same.
 */
export function catalogueDrift(recorded: readonly string[], offered: readonly string[]): string[] {
  const was = new Set(recorded);
  const now = new Set(offered);
  const drift = [
    ...offered.filter((line) => !was.has(line)).map((line) => `+ ${line}`),
    ...recorded.filter((line) => !now.has(line)).map((line) => `- ${line}`),
  ];
  if (drift.length === 0 && recorded.join('\n') !== offered.join('\n')) drift.push('order');
  return drift;
}

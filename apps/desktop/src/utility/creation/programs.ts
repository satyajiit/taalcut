// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  authoredProgramDigestInput,
  err,
  ok,
  upgradeTimeline,
  ValidationError,
  type AsyncResult,
  type AuthoredProgram,
  type AuthoredProgramStore,
  type CreationInspectInput,
  type Timeline,
  type TimelineStore,
} from '@taalcut/core';
import { inspectAuthoredProgram } from '@taalcut/render';

export async function readCreationTimeline(
  store: TimelineStore,
  input: CreationInspectInput,
): AsyncResult<Timeline> {
  const found = await store.get(input.timelineId);
  if (!found.ok) return found;
  const parsed = upgradeTimeline(found.value.json, found.value.schemaVersion);
  if (!parsed.ok) return parsed;
  return parsed.value.projectId === input.projectId ? parsed : err(ValidationError({ field: 'projectId' }));
}

export async function readCreationProgram(
  programs: AuthoredProgramStore,
  timelines: TimelineStore,
  input: CreationInspectInput,
) {
  const timeline = await readCreationTimeline(timelines, input);
  if (!timeline.ok) return timeline;
  const program = timeline.value.authoredPrograms?.[0];
  if (!program)
    return err(ValidationError({ field: 'program' }, { detail: 'Timeline has no authored program' }));
  const manifest = await programs.get(input.projectId, program);
  if (!manifest.ok) return manifest;
  const entry = manifest.value.files.find((file) => file.path === manifest.value.entry)!;
  const bytes = await programs.readFile(input.projectId, entry.sha256);
  if (!bytes.ok) return bytes;
  const inspection = inspectAuthoredProgram(new TextDecoder().decode(bytes.value), manifest.value);
  return inspection.ok ? ok({ timeline: timeline.value, inspection: inspection.value }) : inspection;
}

export async function storeProgramSource(
  store: AuthoredProgramStore,
  projectId: Timeline['projectId'],
  program: AuthoredProgram,
  source: string,
): AsyncResult<AuthoredProgram> {
  const file = await store.putFile(projectId, new TextEncoder().encode(source));
  if (!file.ok) return file;
  const next = {
    ...program,
    version: program.version + 1,
    files: [
      ...program.files.filter((item) => item.path !== program.entry),
      { path: program.entry, ...file.value },
    ],
  };
  return ok({ ...next, hash: createHash('sha256').update(authoredProgramDigestInput(next)).digest('hex') });
}

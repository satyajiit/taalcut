// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { telemetryEnvelopeSchema, type TelemetryEnvelope } from '@taalcut/core';
import { z } from 'zod';
import { readJson } from '../../files';
import { parseJsonLines } from '../../jsonl';
import { type CohortName, type LanguageName } from '../slices';
import { inWindow } from '../window';
import { cohortName, type CohortFile } from './cohorts';
import { readNdjsonBytes, sourceOf } from './digest';
import { parseWith } from './parse';
import { type InstallRollup, type SourceRef, type TelemetryInput } from './types';

const markerSchema = z.strictObject({ synthetic: z.boolean() });

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${dir}: ${message}`, { cause: error });
  }
}

function parseLines(path: string, text: string): TelemetryEnvelope[] {
  return parseJsonLines(text, path, (value) => parseWith(telemetryEnvelopeSchema, value, 'the envelope'));
}

interface Group {
  cohort: CohortName | null;
  envelopes: TelemetryEnvelope[];
}

function groupByInstall(envelopes: readonly TelemetryEnvelope[], cohorts: CohortFile): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const envelope of envelopes) {
    let group = groups.get(envelope.installId);
    if (group === undefined) {
      group = { cohort: null, envelopes: [] };
      groups.set(envelope.installId, group);
    }
    if (envelope.cohort !== undefined) {
      const name = cohortName(cohorts.map, envelope.cohort);
      if (group.cohort !== null && group.cohort !== name) {
        throw new Error(`Install ${envelope.installId} is both ${group.cohort} and ${name}`);
      }
      group.cohort = name;
    }
    group.envelopes.push(envelope);
  }
  return groups;
}

function firstLocale(envelopes: readonly TelemetryEnvelope[]): LanguageName | null {
  for (const envelope of envelopes) {
    if (envelope.event.name === 'session.started') return envelope.event.locale;
  }
  return null;
}

/**
 * One rollup per install with an event in the window. `firstSeenAt` comes from every envelope in the export, so an
 * install active before `--from` is not mistaken for a new one.
 */
function rollup(
  envelopes: readonly TelemetryEnvelope[],
  cohorts: CohortFile,
  fromMs: number,
  toMs: number,
): InstallRollup[] {
  const installs: InstallRollup[] = [];
  for (const [installId, group] of groupByInstall(envelopes, cohorts)) {
    const all = [...group.envelopes].sort((left, right) => left.at - right.at || left.seq - right.seq);
    const firstSeen = all[0];
    const ordered = all.filter((envelope) => inWindow(envelope.at, fromMs, toMs));
    if (firstSeen === undefined || ordered.length === 0) continue;
    installs.push({
      installId,
      cohort: group.cohort,
      language: firstLocale(ordered),
      firstSeenAt: firstSeen.at,
      newInWindow: firstSeen.at >= fromMs,
      envelopes: ordered,
    });
  }
  installs.sort((left, right) => left.installId.localeCompare(right.installId));
  return installs;
}

/**
 * `*.ndjson` plus an optional `synthetic.json`. A missing marker is not synthetic. Pass the whole export, not only the
 * window: events before `--from` only tell which installs are new.
 */
export function loadTelemetry(
  dir: string,
  cohorts: CohortFile,
  fromMs: number,
  toMs: number,
): TelemetryInput {
  const names = readDir(dir);
  const sources: SourceRef[] = [];
  let synthetic = false;
  if (names.includes('synthetic.json')) {
    const path = join(dir, 'synthetic.json');
    const marker = parseWith(markerSchema, readJson(path), path);
    synthetic = marker.synthetic;
    sources.push(sourceOf(path, synthetic));
  }
  if (cohorts.source !== null) sources.push(cohorts.source);

  const envelopes: TelemetryEnvelope[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.ndjson')).sort()) {
    const path = join(dir, name);
    const read = readNdjsonBytes(path);
    sources.push({ ...read.source, synthetic });
    envelopes.push(...parseLines(path, read.text));
  }

  return { kind: 'present', installs: rollup(envelopes, cohorts, fromMs, toMs), sources, synthetic };
}

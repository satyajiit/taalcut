// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { jsonFiles, readJson } from '../../files';
import { parseUsabilitySession } from '../../usability/schema';
import { sourceOf } from './digest';
import { type SessionsInput, type SourceRef, type UsabilitySession } from './types';

/**
 * P3-Q4 session records, read with the usability package's own schema so the two cannot drift. The participant's
 * cohort code is not resolved: moderated sessions are sliced by language only.
 */
export function loadSessions(dir: string): SessionsInput {
  const sessions: UsabilitySession[] = [];
  const sources: SourceRef[] = [];
  for (const file of jsonFiles(dir)) {
    const parsed = parseUsabilitySession(readJson(file.path), file.path);
    const source = sourceOf(file.path, parsed.synthetic);
    sources.push(source);
    sessions.push({
      language: parsed.language,
      seconds: parsed.timeToFirstVideoSeconds,
      source,
    });
  }
  return {
    kind: 'present',
    sessions,
    sources,
    synthetic: sessions.some((session) => session.source.synthetic),
  };
}

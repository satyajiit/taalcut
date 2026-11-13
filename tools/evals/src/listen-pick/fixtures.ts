// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** listen-pick's labels: the 60 golden queries (queries.ts) as `cases.json`. Real labels, not synthetic numbers. */
import { join } from 'node:path';
import { writeJson } from '../files';
import { PICK_QUERIES } from './queries';
import type { PickLabel } from './schema';

export function pickLabels(): PickLabel[] {
  return PICK_QUERIES.map((q, i) => ({
    caseId: `q${String(i + 1).padStart(2, '0')}`,
    query: q.query,
    families: [...q.families],
    from: q.from,
  }));
}

export function writePickFixtures(dir: string): { labels: string } {
  writeJson(join(dir, 'cases.json'), pickLabels());
  return { labels: dir };
}

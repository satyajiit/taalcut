// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf, Id } from '@taalcut/core';
import { PROJECT, RUN, TIMELINE } from './fixtures-phase3-ids';

/**
 * The renderer fake's talking-head project and video (make/p3/seeds/cleanup.ts, seeded with
 * `{ "cleanup": { "talkingHead": true } }`), so the card shows its cut in /dev/kit.
 */
export const TALKING_PROJECT = '01K7C5M6Q8M00000000000001W' as Id<'Project'>;
export const TALKING_TIMELINE = '01K7C5M6Q8N00000000000001W' as Id<'Timeline'>;

const stats = { fillers: 14, pauses: 9, retakes: 2, punchIns: 3, secondsSaved: 11 };

const proposed: CardOf<'cleanupPlan'> = {
  type: 'cleanupPlan',
  id: 'cleanup',
  version: 1,
  runId: RUN,
  projectId: TALKING_PROJECT,
  plan: { timelineId: TALKING_TIMELINE, revision: 1, clips: [], stats },
  before: 52,
  after: 41,
  status: 'proposed',
};

/** P3-V9: the cleanup plan card. */
export const CLEANUP_PLAN_FIXTURES: Readonly<Record<string, CardOf<'cleanupPlan'>>> = {
  proposed,
  /** Golden hour's first video has moved on since revision 2 (the fake keeps it at 7): "Check again". */
  stale: {
    ...proposed,
    id: 'cleanup-stale',
    projectId: PROJECT,
    plan: { timelineId: TIMELINE, revision: 2, clips: [], stats },
  },
  applied: { ...proposed, id: 'cleanup-applied', status: 'applied' },
  nothingToCut: {
    ...proposed,
    id: 'cleanup-nothing',
    plan: {
      ...proposed.plan,
      stats: { fillers: 0, pauses: 0, retakes: 0, punchIns: 0, secondsSaved: 0 },
    },
    after: 52,
  },
};

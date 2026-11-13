// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How many of a job's attempts a restart of the jobs process cut short. The
 * restarted engine takes over a dead boot's lease at once; the repository adds
 * one here in the same change, so the count survives the restarts it counts
 * (it replaces the jobs process's `job-restarts.json`, which is now ignored).
 */
import type { Migration } from './types';

const up = `
ALTER TABLE jobs ADD COLUMN interruptions INTEGER NOT NULL DEFAULT 0 CHECK (interruptions >= 0);
`;

const down = `
ALTER TABLE jobs DROP COLUMN interruptions;
`;

export const jobInterruptions: Migration = { version: 10, name: 'job_interruptions', up, down };

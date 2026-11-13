// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT2: regenerate the one legacy session that submitted two writes against revision 3.
 * This is deterministic command-contract evidence, not a new live-model quality measurement.
 * Run: pnpm --filter @taalcut/evals exec tsx src/edit/record-revisions.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScriptedModelClient, type ScriptedReply } from '@taalcut/agent';
import { EDIT_CASES } from './cases';
import { SESSIONS_DIR } from './cli';
import { runCase } from './run';
import { sessionOf } from './session';
import { PROJECT_ID, TIMELINE_ID } from './timeline-doc';

const target = { projectId: PROJECT_ID, timelineId: TIMELINE_ID };
const call = (name: string, args: Record<string, unknown>): ScriptedReply => ({
  toolCalls: [{ name, arguments: args }],
});
const replies = [
  call('timeline_get', { timelineId: TIMELINE_ID }),
  call('timeline_setSpeed', { ...target, revision: 3, clip: '5', speed: 2 }),
  call('timeline_get', { timelineId: TIMELINE_ID }),
  call('timeline_setGrade', { ...target, revision: 4, clips: ['5'], temperature: 0.6 }),
  call('timeline_get', { timelineId: TIMELINE_ID }),
  {
    text: 'The dog clip now plays at double speed with warmer colors.',
    ...call('handOff', { timelineId: TIMELINE_ID, revision: 5 }),
  },
];
const edit = EDIT_CASES.find((entry) => entry.id === 'multi-fast-warm')!;
const live = createScriptedModelClient((_request, turn) => replies[Math.min(turn, replies.length - 1)]!);
const { run, turns } = await runCase(edit, { live });
if (!run.pass || run.status !== 'completed' || run.malformed.length || run.outOfTarget.length)
  throw new Error(`Revision-aware recording failed: ${JSON.stringify(run)}`);
const session = sessionOf(
  edit.id,
  'scripted/EDT2 revision-aware contract',
  { pass: run.pass, why: run.why },
  turns,
);
writeFileSync(join(SESSIONS_DIR, `${edit.id}.json`), `${JSON.stringify(session, null, 1)}\n`);
console.log(`Recorded ${edit.id}: ${turns.length} real agent turns, ${run.status}, ${run.why}`);

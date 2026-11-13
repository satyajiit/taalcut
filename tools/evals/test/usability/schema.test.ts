// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fixtureSessions } from '../../src/usability/fixtures';
import {
  parseUsabilitySession,
  usabilitySessionSchema,
  type UsabilitySession,
} from '../../src/usability/schema';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../../usability/session.schema.json');

interface EditableTask {
  id: string;
  startedAt: string;
  endedAt: string;
  outcome: string;
  errors: string[];
  ease: number;
}

interface EditableSession extends Omit<UsabilitySession, 'language' | 'tasks' | 'timeToFirstVideoSeconds'> {
  language: string;
  tasks: EditableTask[];
  timeToFirstVideoSeconds: number | null;
}

function editable(): EditableSession {
  const session = fixtureSessions()[0];
  if (session === undefined) throw new Error('missing fixture');
  return structuredClone(session);
}

function taskAt(session: EditableSession, index: number): EditableTask {
  const task = session.tasks[index];
  if (task === undefined) throw new Error(`missing task ${index}`);
  return task;
}

describe('usability session schema', () => {
  it('accepts a synthetic fixture', () => {
    for (const session of fixtureSessions()) {
      expect(parseUsabilitySession(session)).toEqual(session);
    }
  });

  it('accepts a real session marked synthetic false', () => {
    const session = editable();
    session.synthetic = false;
    expect(parseUsabilitySession(session).synthetic).toBe(false);
  });

  it('accepts an equal start and end', () => {
    const session = editable();
    const task = taskAt(session, 2);
    task.endedAt = task.startedAt;
    expect(parseUsabilitySession(session).tasks[2].endedAt).toBe(task.startedAt);
  });

  it('compares task instants, not offset strings', () => {
    const session = editable();
    const task = taskAt(session, 0);
    // 12:00 at +05:30 is 06:30Z, which is before 08:00Z even though "12" > "08" as text.
    task.startedAt = '2026-10-15T12:00:00.000+05:30';
    task.endedAt = '2026-10-15T08:00:00.000Z';
    expect(() => parseUsabilitySession(session)).not.toThrow();
  });

  it('rejects a language outside the four v1 languages', () => {
    const session = editable();
    session.language = 'fr';
    expect(() => parseUsabilitySession(session)).toThrow();
  });

  it('rejects ease 0 and ease 8', () => {
    const tooHard = editable();
    taskAt(tooHard, 0).ease = 0;
    expect(() => parseUsabilitySession(tooHard)).toThrow();
    const tooEasy = editable();
    taskAt(tooEasy, 5).ease = 8;
    expect(() => parseUsabilitySession(tooEasy)).toThrow();
  });

  it('rejects a session missing T4', () => {
    const session = editable();
    session.tasks.splice(3, 1);
    expect(session.tasks.map((task) => task.id)).not.toContain('T4');
    expect(() => parseUsabilitySession(session)).toThrow();
  });

  it('rejects endedAt before startedAt', () => {
    const session = editable();
    const task = taskAt(session, 0);
    task.startedAt = '2026-10-15T10:00:00.000Z';
    task.endedAt = '2026-10-15T09:00:00.000Z';
    expect(() => parseUsabilitySession(session)).toThrow();
  });

  it('rejects a negative time to first video', () => {
    const session = editable();
    session.timeToFirstVideoSeconds = -1;
    expect(() => parseUsabilitySession(session)).toThrow();
  });

  it('accepts null for a participant who never exported', () => {
    const session = editable();
    session.timeToFirstVideoSeconds = null;
    expect(parseUsabilitySession(session).timeToFirstVideoSeconds).toBeNull();
  });

  it('rejects a first export that would end after the last task', () => {
    // Fixture tasks run from 09:00 to 09:54, so 55 minutes is past the session's end.
    const session = editable();
    session.timeToFirstVideoSeconds = 54 * 60;
    expect(parseUsabilitySession(session).timeToFirstVideoSeconds).toBe(54 * 60);
    session.timeToFirstVideoSeconds = 55 * 60;
    expect(() => parseUsabilitySession(session)).toThrow(/after the last task ended/);
  });

  it('rejects a non-finite time to first video', () => {
    const session = editable();
    session.timeToFirstVideoSeconds = Number.POSITIVE_INFINITY;
    expect(() => parseUsabilitySession(session)).toThrow();
  });

  it('rejects a duplicate task id', () => {
    const session = editable();
    taskAt(session, 3).id = 'T1';
    expect(() => parseUsabilitySession(session)).toThrow();
  });

  it('rejects an unknown key', () => {
    const session = editable();
    expect(() => parseUsabilitySession({ ...session, note: 'extra' })).toThrow();
  });

  it('matches the committed JSON Schema from z.toJSONSchema', () => {
    const exported = `${JSON.stringify(z.toJSONSchema(usabilitySessionSchema), null, 2)}\n`;
    expect(readFileSync(schemaPath, 'utf8')).toBe(exported);
  });
});

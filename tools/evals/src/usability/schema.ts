// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { parseNamed } from '../schema';

/** Recorded language of a moderated session. Matches the product's four v1 languages. */
export const LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
export type SessionLanguage = (typeof LANGUAGES)[number];

/** Protocol tasks, in the order the moderator runs them. */
export const TASK_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'] as const;
export type TaskId = (typeof TASK_IDS)[number];

export const TASK_OUTCOMES = ['success', 'assisted', 'failed', 'abandoned'] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

export const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

const sessionIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'sessionId must be lowercase words separated by hyphens');

/** Six letters or digits, or the explicit none code. `none` in any other case is not that code. */
const cohortCodeSchema = z
  .string()
  .regex(/^(?:[A-Z0-9]{6}|NONE)$/, 'cohortCode must be six uppercase letters or digits, or NONE');

const nonBlank = z.string().min(1);

const instantSchema = z.iso.datetime({ offset: true });

function taskSchema<Id extends TaskId>(id: Id) {
  return z
    .object({
      id: z.literal(id),
      startedAt: instantSchema,
      endedAt: instantSchema,
      outcome: z.enum(TASK_OUTCOMES),
      errors: z.array(z.string()),
      ease: z.number().int().min(1).max(7),
    })
    .strict()
    .superRefine((task, ctx) => {
      // Compare instants, not the strings. `Z` and a numeric offset do not sort as text.
      if (Date.parse(task.endedAt) < Date.parse(task.startedAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endedAt'],
          message: 'endedAt is before startedAt',
        });
      }
    });
}

const findingSchema = z
  .object({
    severity: z.enum(FINDING_SEVERITIES),
    area: nonBlank,
    what: nonBlank,
    evidence: nonBlank,
  })
  .strict();

// Slots are T1..T6 in order, so a missing task, a reorder, or a duplicate id cannot parse.
const tasksSchema = z.tuple([
  taskSchema('T1'),
  taskSchema('T2'),
  taskSchema('T3'),
  taskSchema('T4'),
  taskSchema('T5'),
  taskSchema('T6'),
]);

export const usabilitySessionSchema = z
  .object({
    v: z.literal(1),
    sessionId: sessionIdSchema,
    language: z.enum(LANGUAGES),
    date: z.iso.date(),
    moderator: nonBlank,
    mac: z
      .object({
        chip: nonBlank,
        memoryGb: z.number().finite().positive(),
      })
      .strict(),
    participant: z
      .object({
        cohortCode: cohortCodeSchema,
        experience: nonBlank,
      })
      .strict(),
    tasks: tasksSchema,
    /** T1's start until the first export ends. Null when they never exported in the session: a censored time, never 0. */
    timeToFirstVideoSeconds: z.number().finite().nonnegative().nullable(),
    findings: z.array(findingSchema),
    synthetic: z.boolean(),
  })
  .strict()
  .superRefine((session, ctx) => {
    // The first export happens inside the session: no later than the last task's end.
    if (session.timeToFirstVideoSeconds === null) return;
    const firstExport = Date.parse(session.tasks[0].startedAt) + session.timeToFirstVideoSeconds * 1000;
    const sessionEnd = Math.max(...session.tasks.map((task) => Date.parse(task.endedAt)));
    if (firstExport > sessionEnd) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeToFirstVideoSeconds'],
        message: 'the first export would end after the last task ended',
      });
    }
  });

export type UsabilitySession = z.infer<typeof usabilitySessionSchema>;

/** `usability/session.schema.json`. Regenerate with `run schema -- --kind usability`. */
export function usabilityJsonSchema(): unknown {
  return z.toJSONSchema(usabilitySessionSchema);
}
export type UsabilityFinding = UsabilitySession['findings'][number];
export type UsabilityTask = UsabilitySession['tasks'][number];

export function parseUsabilitySession(input: unknown, label = 'usability session'): UsabilitySession {
  return parseNamed(usabilitySessionSchema, input, label);
}

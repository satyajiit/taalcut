// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Telemetry's envelope, port, setting and IPC (P2-X7). The agent process
 * keeps the queue and sends batches; every other process hands its events
 * to it (`telemetryIngestContract`: the agent serves it, main forwards it to
 * jobs, render and lan), and a window may record only the few events it
 * alone sees (RENDERER_TELEMETRY_EVENTS). Nothing is recorded while consent
 * is off or Local only is on.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type ProjectId } from '../basics/ids';
import { createToken } from '../di/token';
import { ipc } from '../ipc/contract';
import { defineSetting } from '../ports/preferences';
import { COHORT_CODE_PATTERN } from '../settings/privacy-contract';
import { telemetryEventSchema, type TelemetryEvent, type TelemetryEventName } from './telemetry-events';

const count = z.int().nonnegative();

/** What leaves the Mac: one envelope per event, sent in batches. */
export const telemetryEnvelopeSchema = z
  .object({
    v: z.literal(1),
    /** Random per install; a new one each time telemetry is turned on. */
    installId: idSchema<'Install'>(),
    sessionId: idSchema<'TelemetrySession'>(),
    /** The alpha code the PO gave the creator, if entered. */
    cohort: z.string().regex(COHORT_CODE_PATTERN).optional(),
    /** First 16 hex of HMAC-SHA-256(install salt, projectId): links a project's events without its id. */
    projectKey: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
    seq: count,
    at: z.int().nonnegative(),
    event: telemetryEventSchema,
  })
  .strict();
export type TelemetryEnvelope = z.output<typeof telemetryEnvelopeSchema>;

export interface Telemetry {
  /** Never fails or blocks. Dropped while consent is off or Local only is on. */
  record(event: TelemetryEvent, context?: { readonly projectId?: ProjectId }): void;
}

export const TelemetryToken = createToken<Telemetry>('core.telemetry');

/** The Telemetry that records nothing: tests, and processes before telemetry is wired. */
export const noTelemetry: Telemetry = { record() {} };

export const TELEMETRY_SETTING = defineSetting(
  'privacy.telemetry',
  z.object({
    enabled: z.boolean(),
    cohort: z.string().regex(COHORT_CODE_PATTERN).optional(),
    changedAt: count,
  }),
  { enabled: false, changedAt: 0 },
);

/** The events only a window sees. */
export const RENDERER_TELEMETRY_EVENTS = [
  'onboarding.step',
  'export.survey',
  'feedback.sent',
  // P3-B3: first run's branches and milestones happen in the window.
  'onboarding.branch',
  'onboarding.imported',
  'onboarding.firstExport',
  // P3-B8: a recipe chip is the composer's.
  'recipe.used',
] as const satisfies readonly TelemetryEventName[];

const rendererEventSchema = telemetryEventSchema.refine(
  (event) => (RENDERER_TELEMETRY_EVENTS as readonly string[]).includes(event.name),
  { message: 'A window may record only its own events', path: ['name'] },
);

/** appContract.telemetry, owner agent. `record` refuses events not in RENDERER_TELEMETRY_EVENTS. */
export const telemetryContract = {
  state: ipc.output(
    z.object({
      enabled: z.boolean(),
      cohort: z.string().optional(),
      queued: count,
      lastSentAt: z.int().nonnegative().optional(),
    }),
  ),
  record: ipc
    .input(z.object({ event: rendererEventSchema, projectId: idSchema<'Project'>().optional() }))
    .output(z.void()),
};

/**
 * Other processes hand their events to the agent's queue: UTILITY_CONTRACTS.agent.telemetryIngest, and
 * MAIN_SERVICE_CONTRACTS.{jobs,render,lan}.telemetry, which main forwards to the agent.
 */
export const telemetryIngestContract = {
  record: ipc
    .input(z.object({ event: telemetryEventSchema, projectId: idSchema<'Project'>().optional() }))
    .output(z.void()),
};

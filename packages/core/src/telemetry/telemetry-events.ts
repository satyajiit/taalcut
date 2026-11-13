// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The telemetry catalogue (P2-X7, alpha measurement): every event that may leave
 * the Mac when the user turned telemetry on. No media, no text, no file
 * names, no ids: only enums, bounded numbers, booleans and coarse size
 * buckets, so no event can fingerprint a library (test/telemetry.test.ts
 * walks every field to keep it that way).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { APP_LOCALES } from '../basics/locales';
import { OPENING_PATHS } from '../chat/chat-start';
import { UPDATE_CHANNELS } from '../ipc/main-services-contracts';
import { MODEL_MODULE_IDS } from '../ports/model-ports';
import { MUSIC_PATHS } from '../render/music';
import { EXPORT_PRESET_IDS } from '../render/presets';
import { QA_CHECK_IDS } from '../render/qa';
import { HARDWARE_TIERS } from '../settings/models-contract';
import { ONBOARDING_STEP_IDS } from '../settings/onboarding-contract';
import { DEVICE_BRIDGE_KINDS } from '../transfer/devices-contract';
import { telemetry, telemetryCount, telemetryMs, telemetrySize, telemetryVersion } from './event-fields';
import { LAUNCH_TELEMETRY_EVENTS } from './launch-events';

const count = telemetryCount;
const ms = telemetryMs;
const size = telemetrySize;

export { SIZE_BUCKETS, sizeBucket, type SizeBucket } from './event-fields';

/** How a video's model calls were paid for (E2: cost per video on API keys). */
export const COST_BILLINGS = ['apiKey', 'subscription', 'local', 'mixed'] as const;

/** The model profile a session runs: a built-in one (models' BUILTIN_PROFILE_IDS) or the user's own. */
export const TELEMETRY_PROFILES = ['fast-cheap', 'balanced', 'best-quality', 'local-only', 'custom'] as const;

export const telemetryEventSchema = z.discriminatedUnion('name', [
  telemetry('session.started', {
    appVersion: telemetryVersion,
    channel: z.enum(UPDATE_CHANNELS),
    osMajor: z.int().min(10).max(99),
    tier: z.enum(HARDWARE_TIERS),
    locale: z.enum(APP_LOCALES),
    profile: z.enum(TELEMETRY_PROFILES),
  }),
  telemetry('onboarding.step', { step: z.enum(ONBOARDING_STEP_IDS), ms, skipped: z.boolean() }),
  telemetry('import.completed', {
    /** P3-B4 adds 'usb'. */
    source: z.enum(['folder', 'wifi', 'usb']),
    assets: size,
    failed: size,
    reencodedByPhone: size,
    ms,
    /** P3-B4, P3-B5: a USB import's bridge. */
    bridge: z.enum(DEVICE_BRIDGE_KINDS).optional(),
    /** P3-B4: items left in iCloud, not on the phone. */
    inICloud: size.optional(),
  }),
  telemetry('index.completed', {
    assets: size,
    footageMinutes: size,
    ms,
    vision: z.enum(['this-mac', 'cloud', 'off']),
  }),
  telemetry('flow.started', { path: z.enum(OPENING_PATHS) }),
  telemetry('breakdown.completed', { slots: count, ms }),
  telemetry('cast.completed', {
    slots: count,
    variants: z.int().min(1).max(10),
    lowConfidence: count,
    reranked: count,
    ms,
  }),
  telemetry('qa.result', {
    passed: z.boolean(),
    firstPass: z.boolean(),
    fixLoops: count,
    failed: z.array(z.enum(QA_CHECK_IDS)).max(QA_CHECK_IDS.length),
  }),
  telemetry('export.completed', {
    firstExport: z.boolean(),
    /** null: exported outside a flow (the export dialog). */
    path: z.enum(OPENING_PATHS).nullable(),
    preset: z.enum(EXPORT_PRESET_IDS),
    musicPath: z.enum(MUSIC_PATHS),
    /** Gate criterion 2. */
    slots: count,
    slotsKeptAi: count,
    slotsSwappedByUser: count,
    orderChanged: z.boolean(),
    breakdownEdited: z.boolean(),
    seconds: z.int().min(1).max(600),
    renderMs: ms,
  }),
  telemetry('export.survey', { answer: z.enum(['yes', 'maybe', 'no']) }),
  telemetry('cost.recorded', {
    scope: z.enum(['export', 'abandoned']),
    usdMicros: count,
    estimateMicros: count,
    byModule: z.partialRecord(z.enum(MODEL_MODULE_IDS), count),
    capHit: z.boolean(),
    /** E2: how the calls were paid for; optional so a Phase 2 outbox row still sends. */
    billing: z.enum(COST_BILLINGS).optional(),
  }),
  telemetry('feedback.sent', { withBundle: z.boolean(), withChatText: z.boolean() }),
  telemetry('recovery.offered', { runs: count, jobs: count, restored: z.boolean() }),
  ...LAUNCH_TELEMETRY_EVENTS,
]);
export type TelemetryEvent = z.output<typeof telemetryEventSchema>;
export type TelemetryEventName = TelemetryEvent['name'];

export const TELEMETRY_EVENT_NAMES: readonly TelemetryEventName[] = telemetryEventSchema.options.map(
  (option) => option.shape.name.value,
);

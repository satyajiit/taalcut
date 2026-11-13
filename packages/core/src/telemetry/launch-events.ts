// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's telemetry events (P3-B3 onboarding, P3-B9 updates, P3-V4 MCP, G8 limits, B11 the router, P3-Q1's
 * adoption and export-rate counts). Enums, booleans and bounded numbers only, like the rest of the catalogue
 * (telemetry-events.ts spreads these into it).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { HUB_REPORT_REASONS } from '../hub/worker-api';
import { UPDATE_CHANNELS } from '../ipc/main-services-contracts';
import { MCP_CLIENT_KINDS, MCP_LEVELS } from '../mcp/mcp-types';
import { MODEL_MODULE_IDS } from '../ports/model-ports';
import { ROUTER_MODES } from '../settings/agent-settings';
import {
  ONBOARDING_SOURCE_BRANCHES,
  ONBOARDING_STEP_IDS,
  ONBOARDING_THINKING_BRANCHES,
} from '../settings/onboarding-contract';
import { USAGE_LIMIT_KINDS } from '../settings/usage-summary';
import { INTERCHANGE_FORMATS } from '../timeline/interchange';
import { VARIANT_AXES } from '../timeline/variants';
import { telemetry, telemetryCount, telemetryMs, telemetrySize, telemetryVersion } from './event-fields';

/** What a chat recipe chip was about (P3-B8), for adoption counts. */
export const RECIPE_CATEGORIES = [
  'cut',
  'captions',
  'music',
  'graphics',
  'style',
  'reframe',
  'export',
] as const;
export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];
export const ONBOARDING_FIRST_EXPORT_STARTS = ['reference', 'describe', 'template'] as const;
export const UPDATE_ROLLBACK_REASONS = ['exited', 'hung', 'attempts'] as const;
export const RATE_LIMIT_OUTCOMES = ['switched', 'waited', 'stopped'] as const;
export const ROUTER_CONFIDENCES = ['low', 'mid', 'high'] as const;
export const ROUTER_OUTCOMES = ['answered', 'timeout', 'error'] as const;

export const LAUNCH_TELEMETRY_EVENTS = [
  telemetry('onboarding.branch', {
    step: z.enum(ONBOARDING_STEP_IDS),
    branch: z.enum([...ONBOARDING_THINKING_BRANCHES, ...ONBOARDING_SOURCE_BRANCHES, 'starter']),
  }),
  telemetry('onboarding.imported', { ms: telemetryMs }),
  telemetry('onboarding.firstExport', { ms: telemetryMs, start: z.enum(ONBOARDING_FIRST_EXPORT_STARTS) }),
  telemetry('update.installed', {
    from: telemetryVersion,
    to: telemetryVersion,
    channel: z.enum(UPDATE_CHANNELS),
    delta: z.boolean(),
  }),
  telemetry('update.rolledBack', {
    from: telemetryVersion,
    to: telemetryVersion,
    reason: z.enum(UPDATE_ROLLBACK_REASONS),
  }),
  telemetry('mcp.sessionCreated', { client: z.enum(MCP_CLIENT_KINDS), level: z.enum(MCP_LEVELS) }),
  telemetry('rateLimit.met', {
    module: z.enum(MODEL_MODULE_IDS),
    reason: z.enum(USAGE_LIMIT_KINDS),
    outcome: z.enum(RATE_LIMIT_OUTCOMES),
  }),
  /** B11: the router beside the main model; no family names, no text. */
  telemetry('router.decision', {
    mode: z.enum(ROUTER_MODES),
    agree: z.boolean(),
    routerNone: z.boolean(),
    mainNone: z.boolean(),
    confidence: z.enum(ROUTER_CONFIDENCES),
    outcome: z.enum(ROUTER_OUTCOMES),
  }),
  /** E1 (export rate): every finished render. */
  telemetry('render.finished', {
    kind: z.enum(['draft', 'export']),
    status: z.enum(['ready', 'needsAttention', 'failed', 'cancelled']),
  }),
  // E3 (adoption, counts only).
  telemetry('recipe.used', { category: z.enum(RECIPE_CATEGORIES) }),
  telemetry('hub.shared', { slots: telemetryCount, withStyle: z.boolean() }),
  telemetry('hub.forked', { slots: telemetryCount }),
  telemetry('hub.rated', {}),
  telemetry('hub.reported', { reason: z.enum(HUB_REPORT_REASONS) }),
  telemetry('variants.made', { count: z.int().min(1).max(5), axes: z.array(z.enum(VARIANT_AXES)).max(3) }),
  telemetry('interchange.exported', { format: z.enum(INTERCHANGE_FORMATS) }),
  telemetry('cleanup.applied', { fillers: telemetrySize, pauses: telemetrySize, retakes: telemetrySize }),
] as const;

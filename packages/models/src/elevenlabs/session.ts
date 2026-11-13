// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One ElevenLabs account for the voice, music and sound-effect providers (SPEC P3.2): the fetch path, and the plan
 * read once (`GET /v1/user/subscription`), which decides the output format (MP3 192 kb/s on Creator and above, else
 * 128 kb/s) and refuses music on Free. A plan lookup that fails for any reason but Local only, a missing key or a
 * cancel (a key without the user-read scope, a blip) leaves the plan unknown: its row says why, the standard format
 * is used, and the lookup is asked again after ten minutes.
 */
import { CancelledError, LocalOnly, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { z } from 'zod';
import { ModelNotConfigured } from '../errors';
import { ELEVENLABS_LIMITS, FREE_TIER, HIGH_FORMAT_TIERS, OUTPUT_FORMATS, type OutputFormat } from './config';
import { createElevenLabsHttp, type ElevenLabsHttp, type ElevenLabsHttpDeps } from './http';
import { parseWire } from './wire-parse';

const subscriptionSchema = z.object({ tier: z.string().min(1) });

export interface ElevenLabsSession {
  readonly http: ElevenLabsHttp;
  /** The plan's tier, read once; null when it couldn't be read. */
  tier(module: 'voice' | 'music', signal?: AbortSignal): AsyncResult<string | null>;
  /** The tier from the last lookup, without asking. */
  knownTier(): string | null | undefined;
  outputFormat(module: 'voice' | 'music', signal?: AbortSignal): AsyncResult<OutputFormat>;
}

export type ElevenLabsSessionDeps = ElevenLabsHttpDeps;

/** Errors that end the call rather than leaving the plan unknown. */
const FATAL = (error: TaalcutError) =>
  LocalOnly.is(error) || ModelNotConfigured.is(error) || CancelledError.is(error);

export function isFreeTier(tier: string | null | undefined): boolean {
  return tier === FREE_TIER;
}

export function formatForTier(tier: string | null | undefined): OutputFormat {
  const high = tier ? HIGH_FORMAT_TIERS.some((prefix) => tier.startsWith(prefix)) : false;
  return high ? OUTPUT_FORMATS.high : OUTPUT_FORMATS.standard;
}

export function createElevenLabsSession(deps: ElevenLabsSessionDeps): ElevenLabsSession {
  const http = createElevenLabsHttp(deps);
  const now = deps.now ?? Date.now;
  let known: { tier: string | null; at: number } | undefined;

  async function tier(module: 'voice' | 'music', signal?: AbortSignal): AsyncResult<string | null> {
    if (known && (known.tier !== null || now() - known.at < ELEVENLABS_LIMITS.tierRetryMs))
      return ok(known.tier);
    const answer = await http.send({
      module,
      model: 'api:subscription',
      method: 'GET',
      path: '/v1/user/subscription',
      ...(signal ? { signal } : {}),
    });
    if (!answer.ok && FATAL(answer.error)) return answer;
    const parsed = answer.ok ? parseWire(subscriptionSchema, answer.value, 'api:subscription') : answer;
    known = { tier: parsed.ok ? parsed.value.tier.toLowerCase() : null, at: now() };
    return ok(known.tier);
  }

  return {
    http,
    tier,
    knownTier: () => known?.tier,
    async outputFormat(module, signal) {
      const read = await tier(module, signal);
      return read.ok ? ok(formatForTier(read.value)) : read;
    },
  };
}

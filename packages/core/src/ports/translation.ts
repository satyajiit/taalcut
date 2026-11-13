// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text translation (P3-V20): @taalcut/models implements it, @taalcut/audio calls it for captions, in the agent
 * process. Units are what someone said (untrusted); the implementation fences them (basics/untrusted.ts).
 */
import type { AppLocale } from '../basics/locales';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { GenerationTrace } from './generation-ports';

export interface TranslationUnit {
  readonly id: string;
  /** Untrusted: what someone said. */
  readonly text: string;
}

export const TRANSLATION_PLACEMENTS = ['local', 'cloud', 'off'] as const;
/** At most this many units per request, and this many units of context. */
export const TRANSLATION_LIMITS = { units: 100, context: 2 } as const;

export interface TextTranslator {
  /** Where translation would run now: on this Mac, in the cloud, or nowhere (no model). */
  placement(): (typeof TRANSLATION_PLACEMENTS)[number];
  translate(request: {
    readonly units: readonly TranslationUnit[];
    /** BCP 47. */
    readonly from: string;
    readonly to: AppLocale;
    /** The previous batch's last units, for context; not translated. */
    readonly context?: readonly TranslationUnit[];
    readonly instruction?: 'shorter';
    readonly signal?: AbortSignal;
    readonly trace?: GenerationTrace;
  }): AsyncResult<{
    readonly units: readonly TranslationUnit[];
    readonly provider: string;
    readonly model: string;
    readonly local: boolean;
    /** What the request's model calls used, retries included (review M8: the tool reports it). */
    readonly usage: TranslationUsage;
  }>;
}

/** Tokens and money a translation used; US$0 on this Mac. */
export interface TranslationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
}
export const TextTranslatorToken = createToken<TextTranslator>('core.textTranslator');

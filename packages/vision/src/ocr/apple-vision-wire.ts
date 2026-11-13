// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How long the Apple Vision client waits for the mac helper (FIX-OCRCOLD), and its warm-up.
 *
 * Vision compiles its models for the Neural Engine the first time a helper build runs them: its detector and main
 * recogniser on the first read, the Arabic and Devanagari recognisers on the first line in their script. On this
 * M5 Max that took 24 s to 4.3 minutes a model while other work held the Mac, and a cancel ends the request and every
 * compile still ahead of it, so a fixed 60 s timeout could cancel the same read again and again (FIX-SIGN's run s1
 * lost its text read that way). A helper whose OCR is version 2 sends a keepalive for each request every 2 s while it
 * works: the client waits as long as those come, up to a cap, and gives up only when they stop (or at once when the
 * process exits). An older helper keeps the fixed timeout.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import type { JsonLineRequestOptions, JsonLineSidecar } from '@taalcut/media';
import { z } from 'zod';
import { OcrFailed } from '../errors';
import type { OcrWarmReport } from './types';

/** An older helper's requests: Vision's own time is well under a second a frame once compiled. */
export const FIXED_TIMEOUT_MS = 60_000;
/** The most one request may take with a keepalive: a compile seen at 4.3 minutes, with room. */
export const KEEPALIVE_CAP_MS = 10 * 60_000;
/** No keepalive for this long (the helper beats every 2 s): the helper is stuck or gone. */
export const STALL_MS = 30_000;
/** The warm-up compiles up to four models one after another. */
export const WARMUP_CAP_MS = 20 * 60_000;

/** OCR version 2 brought the keepalive and the warm-up (native/mac-helper/SPEC.md, "OCR v2"). */
export const KEEPALIVE_OCR_VERSION = 2;

export const readySchema = z
  .object({
    ocr: z.object({ languages: z.array(z.string().min(1).max(35)).max(200) }).optional(),
    serviceVersions: z.record(z.string(), z.number()).optional(),
  })
  .loose();

const warmSchema = z.object({
  steps: z.array(
    z.object({ script: z.string(), ms: z.number().nonnegative(), error: z.string().optional() }).loose(),
  ),
  ms: z.number().nonnegative(),
  yieldedMs: z.number().nonnegative().optional(),
  /** A development build's own compile cache folder (`taalcut-mac-helper-<16 hex>`), when it has one. */
  cache: z
    .string()
    .regex(/^taalcut-mac-helper-[0-9a-f]{16}$/)
    .optional(),
});

export interface Timing {
  /** The overall cap per request; with a keepalive, the client's own or KEEPALIVE_CAP_MS. */
  readonly timeoutMs?: number;
  /** With a keepalive: the wait for the next one. Default STALL_MS. */
  readonly stallMs?: number;
}

/** The sidecar's options for one `ocr.recognize`. */
export function requestTiming(keepalive: boolean, timing: Timing): JsonLineRequestOptions {
  if (!keepalive) return { timeoutMs: timing.timeoutMs ?? FIXED_TIMEOUT_MS };
  return { timeoutMs: timing.timeoutMs ?? KEEPALIVE_CAP_MS, stallTimeoutMs: timing.stallMs ?? STALL_MS };
}

/** Waits for the helper's warm-up (`ocr.warmup`); null from a helper that has none. */
export async function warmUp(
  sidecar: JsonLineSidecar,
  keepalive: boolean,
  timing: Timing,
): AsyncResult<OcrWarmReport | null> {
  if (!keepalive) return ok(null);
  const reply = await sidecar.request(
    'ocr.warmup',
    {},
    { timeoutMs: WARMUP_CAP_MS, stallTimeoutMs: timing.stallMs ?? STALL_MS },
  );
  if (!reply.ok) return err(OcrFailed(undefined, { detail: `ocr.warmup: ${reply.error.code}` }));
  const parsed = warmSchema.safeParse(reply.value);
  if (!parsed.success) return err(OcrFailed(undefined, { detail: 'ocr.warmup: unexpected reply' }));
  return ok({
    steps: parsed.data.steps.map(({ script, ms, error }) => ({ script, ms, ...(error ? { error } : {}) })),
    ms: parsed.data.ms,
    yieldedMs: parsed.data.yieldedMs ?? 0,
    ...(parsed.data.cache ? { cache: parsed.data.cache } : {}),
  });
}

/** One line for the log: `latin 812 ms, devanagari 33.9 s, …`. */
export function describeWarmUp(report: OcrWarmReport): string {
  const time = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
  const steps = report.steps.map((s) => `${s.script} ${s.error ? s.error : time(s.ms)}`).join(', ');
  return `OCR warm-up in ${time(report.ms)} (${steps}; waited ${time(report.yieldedMs)} for reads)`;
}

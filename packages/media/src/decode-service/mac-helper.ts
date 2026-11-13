// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The decode service over the mac helper's `decode.pass` and `decode.frames` (native/mac-helper SPEC). The
 * sidecar must be one that never signals the helper (`holdsVideoSession: true`): the helper ends its own
 * VideoToolbox sessions, on a cancel or at the end of stdin, and a process killed with a session open is what
 * preceded both watchdog resets on the development Mac. Requests settle on the helper's reply, so a cancel returns once the
 * session is invalidated; one the helper doesn't answer within the sidecar's grace settles anyway, its
 * `onLetGo` waits for the late reply or the helper's exit, and no other pass or frame read starts on the
 * helper meanwhile (IX2-F4).
 */
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { z } from 'zod';
import { SidecarFailed } from '../sidecar/errors';
import type { JsonLineSidecar, JsonValue } from '../sidecar/json-line';
import type { DecodeFramesRequest, DecodePassOptions, DecodePassRequest, DecodeService } from './types';

export const DECODE_PASS_METHOD = 'decode.pass';
export const DECODE_FRAMES_METHOD = 'decode.frames';

const reportSchema = z.object({
  frames: z.int().nonnegative(),
  sets: z.array(z.int().nonnegative()),
  ms: z.number().nonnegative(),
});

const framesReportSchema = z.object({
  written: z.array(z.array(z.int().nonnegative())),
  decoded: z.int().nonnegative(),
  reads: z.int().nonnegative(),
  ms: z.number().nonnegative(),
});

function framesParamsOf(request: DecodeFramesRequest): JsonValue {
  return {
    path: request.path,
    rate: { num: request.rate.num, den: request.rate.den },
    rotation: request.rotation,
    range: request.range,
    gapSeconds: request.gapSeconds,
    sets: request.sets.map((set) => ({
      width: set.width,
      height: set.height,
      frames: [...set.frames],
      path: set.path,
    })),
  };
}

function paramsOf(request: DecodePassRequest): JsonValue {
  return {
    path: request.path,
    rate: { num: request.rate.num, den: request.rate.den },
    ...(request.window ? { window: { from: request.window.from, frames: request.window.frames } } : {}),
    rotation: request.rotation,
    range: request.range,
    analysis: { ...request.analysis },
    sets: request.sets.map((set) => ({ ...set })),
  };
}

/** The helper's reply as the method's report; a reply that isn't one is a failure (retryable: the helper's fault). */
function reportOf<T>(method: string, reply: Result<JsonValue>, schema: z.ZodType<T>): Result<T> {
  if (!reply.ok) return reply;
  const parsed = schema.safeParse(reply.value);
  return parsed.success
    ? ok(parsed.data)
    : err(SidecarFailed(undefined, { detail: `${method} result: ${parsed.error.message}` }));
}

/** A request declined because an earlier one the helper didn't answer may still hold a session. */
const UNANSWERED_CANCEL = 'decode.unanswered_cancel';

/**
 * The service's requests to the helper, settling on its reply. `options.onLetGo` runs when the helper has let go of a
 * request; while one it didn't answer may still hold a session (a cancel's grace ran out), no pass or frame read
 * starts (IX2-F4): it declines at once with `decode.unanswered_cancel`, sending nothing.
 */
function decodeRequests(sidecar: JsonLineSidecar) {
  let unanswered = 0;
  return async (method: string, params: JsonValue, options: DecodePassOptions): AsyncResult<JsonValue> => {
    if (unanswered > 0) {
      options.onLetGo?.();
      const detail = `${unanswered} earlier decode request(s) may still hold a VideoToolbox session`;
      return err(SidecarFailed({ helperCode: UNANSWERED_CANCEL }, { detail }));
    }
    let settled = false;
    let letGo = false;
    const reply = await sidecar.request(method, params, {
      settleOnReply: true,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onSend ? { onSend: options.onSend } : {}),
      onLetGo: () => {
        letGo = true;
        if (settled) unanswered -= 1;
        options.onLetGo?.();
      },
    });
    settled = true;
    if (!letGo) unanswered += 1;
    return reply;
  };
}

export function createMacHelperDecodeService(sidecar: JsonLineSidecar): DecodeService {
  const avoid = new Map<string, string>();
  const decodeRequest = decodeRequests(sidecar);
  return {
    id: 'mac-helper',
    pass: async (request, options = {}) =>
      reportOf(
        DECODE_PASS_METHOD,
        await decodeRequest(DECODE_PASS_METHOD, paramsOf(request), options),
        reportSchema,
      ),
    frames: async (request, options = {}) =>
      reportOf(
        DECODE_FRAMES_METHOD,
        await decodeRequest(DECODE_FRAMES_METHOD, framesParamsOf(request), options),
        framesReportSchema.refine((report) => report.written.length === request.sets.length, {
          message: 'one written list per set',
        }),
      ),
    avoid: (path, reason) => {
      avoid.set(path, reason);
    },
    avoided: (path) => avoid.get(path),
    close: () => sidecar.close(),
  };
}

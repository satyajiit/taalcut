// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an FFmpeg job declares to the end policy (process/end-policy.ts, IX3-K2): whether its run may hold a
 * hardware video session, from the route it decodes on and the encoder it chose, never from its arguments. A job
 * on a decode route (`DecodeRoute`) reads the route's own `holdsVideoSession`.
 */
import type { DecodePlan } from '../backends';
import { isHardwareEncoder } from '../encoders';

/** A plan's decode (or a frame read's route): VideoToolbox holds a decoder session; the software decoder none. */
export const decodeHoldsVideoSession = (decode: { readonly backend: DecodePlan['backend'] }): boolean =>
  decode.backend !== 'software';

/** A transcode: its decode, or its video encoder when that is a platform hardware encoder. */
export function transcodeHoldsVideoSession(decode: DecodePlan, encoder: string): boolean {
  return decodeHoldsVideoSession(decode) || isHardwareEncoder(encoder);
}

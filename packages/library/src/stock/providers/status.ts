// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Maps a non-2xx stock response to a library error. 2xx returns null. */
import { type TaalcutError } from '@taalcut/core';
import { StockNoKey, StockRateLimited, StockUnavailable } from '../../errors';
import { retryAfterSeconds, type StockHttpResponse } from '../stock-provider';

export function statusError(
  provider: string,
  response: Pick<StockHttpResponse, 'status' | 'headers'>,
): TaalcutError | null {
  const { status } = response;
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return StockNoKey({ provider });
  if (status === 429) {
    return StockRateLimited({ provider, retryAfterSeconds: retryAfterSeconds(response.headers) });
  }
  // The catalogue marks stock_unavailable retryable (5xx and a bad body). Other 4xx use the same code.
  return StockUnavailable({ provider });
}

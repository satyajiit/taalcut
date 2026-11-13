// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A store's `core.not_found` told as the timeline's own error, which names what is missing; other errors pass. */
import { err, NotFoundError, type Result, type TaalcutError } from '@taalcut/core';

export function namedNotFound<T>(result: Result<T>, notFound: () => TaalcutError): Result<T> {
  return !result.ok && NotFoundError.is(result.error) ? err(notFound()) : result;
}

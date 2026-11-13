// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which failure a fallback chain reports when every model in it failed (UX3-AGT).
 *
 * A model with no key or sign-in fails with models.not_configured, which only says it was skipped. When the
 * chain also tried a model that was set up, that model's failure is the one that explains what happened. With
 * a ChatGPT sign-in and nothing else, Everyday's agent chain is ChatGPT's model and then two models nobody set
 * up, so reporting the chain's last failure turned every ChatGPT error into "Add a key first".
 */
import type { TaalcutError } from '@taalcut/core';
import { ModelNotConfigured } from '../errors';

/**
 * The failure to show for a chain, given each attempt's failure in order: the last one from a model that was
 * set up, else the first (the chain's primary, which is the one to set up). Undefined for an empty list.
 */
export function chainFailure(failures: readonly TaalcutError[]): TaalcutError | undefined {
  const tried = failures.filter((failure) => !ModelNotConfigured.is(failure));
  return tried.at(-1) ?? failures[0];
}

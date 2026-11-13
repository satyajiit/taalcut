// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeps secrets out of error `detail`, which reaches the run log, traces and
 * the model (AGENTS.md: `detail` never contains secrets). The patterns mirror
 * @taalcut/models' scrubber; tools may not import models, so the shared list
 * belongs in core (asked of the core owner).
 */
import { isTaalcutError, type TaalcutError } from '@taalcut/core';

export const REDACTED = '[REDACTED]';
/** A crash detail is a short developer note, not a dump. */
const MAX_CRASH_DETAIL = 300;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\b(xai|gsk|csk|nvapi|hf)[-_][A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Taalcut's own MCP bearer (P3-V4): 'tcm_' and 43 base64url characters.
  /\btcm_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  // Credentials in URLs: scheme://user:password@host.
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g,
  // name=value or name: value where the name says secret, as in query strings and logs.
  /(?<=\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?id|csrf[_-]?token|token|secret|password|passwd)\s*[=:]\s*)[^\s"'&,;]{6,}/gi,
];

/** JSON fields whose values are always secrets, whatever they look like. */
const SECRET_FIELD =
  /("(?:api_?key|access_?token|refresh_?token|id_?token|client_?secret|session_?id|csrf_?token|password|secret)"\s*:\s*)"[^"]*"/gi;

/** Redacts known secret shapes. Keeps "Bearer " so a scrubbed header still reads as one. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const scheme = /^(Bearer|Basic)\s+/i.exec(match);
      return scheme ? `${scheme[0]}${REDACTED}` : REDACTED;
    });
  }
  return out.replace(SECRET_FIELD, `$1"${REDACTED}"`);
}

/** The detail for tools.crashed: the error's name and its scrubbed, shortened message. */
export function crashDetail(cause: unknown): string {
  const text =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : isTaalcutError(cause)
        ? (cause.detail ?? cause.code)
        : typeof cause === 'string'
          ? cause
          : `non-Error value (${typeof cause})`;
  const scrubbed = scrubSecrets(text);
  return scrubbed.length > MAX_CRASH_DETAIL ? `${scrubbed.slice(0, MAX_CRASH_DETAIL)}…` : scrubbed;
}

/** The same error with any secret in its detail redacted. */
export function scrubError(error: TaalcutError): TaalcutError {
  if (error.detail === undefined) return error;
  const detail = scrubSecrets(error.detail);
  return detail === error.detail ? error : { ...error, detail };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Only a standalone copy request can finish without the usual unchanged-edit check. */
export function asksOnlyForPostCopy(request: string | undefined): boolean {
  if (!request) return false;
  const clauses = request
    .split(/\b(?:and|then|also)\b|[.!?;]/iu)
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    clauses.length > 0 &&
    clauses.every(
      (clause) =>
        /^not\s+subtitles?$/iu.test(clause) ||
        (/^(?:(?:please|actually)\s+)?(?:write|draft|create|generate|give|suggest|i\s+(?:mean|meant|need|want))\b/iu.test(
          clause,
        ) &&
          /\b(?:ig|instagram|post|social\s+media)\s+(?:post\s+)?captions?\b|\bcaptions?\s+for\s+(?:(?:the|my|an?|our)\s+)?(?:ig|instagram|post)\b/iu.test(
            clause,
          ) &&
          !/\b(?:disable|enable|resize|turn\s+(?:off|on))\b/iu.test(clause)),
    )
  );
}

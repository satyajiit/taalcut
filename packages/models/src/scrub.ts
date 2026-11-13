// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Removes secrets from text before it reaches an error detail, a log line or a
 * recorded fixture (G9). Known secret values are replaced exactly; common key
 * and token shapes are caught by pattern as a second line of defence.
 */

export const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: readonly RegExp[] = [
  // Authorization headers and bearer tokens in any text.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // OpenAI, Anthropic, OpenRouter, xAI, Groq style keys: a prefix and a long tail.
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\b(xai|gsk|csk|nvapi|hf)[-_][A-Za-z0-9_-]{16,}/g,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // JSON Web Tokens (OAuth access and id tokens).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Taalcut's own MCP bearer (security review SB-26): 'tcm_' and 43 base64url characters, also cut short.
  /\btcm_[A-Za-z0-9_-]{24,}/g,
  // Cookie/header sessionid and csrftoken values.
  /(?<=\b(?:session[_-]?id|csrf[_-]?token)\s*[=:]\s*)[^\s"'&,;]{6,}/gi,
];

/** Query parameter names that carry credentials, compared lower-cased with '-' read as '_'. */
const SECRET_QUERY_NAME =
  /^(?:x_)?(?:key|api_?key|access_?token|refresh_?token|id_?token|session_?id|csrf_?token|token|client_?secret|secret|password|code)$/;
const isSecretQueryName = (name: string) => SECRET_QUERY_NAME.test(name.toLowerCase().replace(/-/g, '_'));
/** The same parameters inside free text, e.g. a URL quoted in an error message. Already-redacted values stay. */
const SECRET_QUERY_IN_TEXT =
  /([?&](?:x[_-])?(?:key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?id|csrf[_-]?token|token|client[_-]?secret|secret|password|code)=)(?!%5BREDACTED%5D|\[REDACTED\])[^&\s#"']+/gi;

/** JSON fields whose values are always secrets, whatever they look like. */
const SECRET_FIELD =
  /("(?:api_?key|access_?token|refresh_?token|id_?token|client_?secret|session_?id|csrf_?token|password|secret)"\s*:\s*)"[^"]*"/gi;

export function scrubSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    // Short values would redact ordinary words; real keys and tokens are long.
    if (secret.length >= 8) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, (match) => keepScheme(match));
  out = out.replace(SECRET_QUERY_IN_TEXT, `$1${REDACTED}`);
  return out.replace(SECRET_FIELD, `$1"${REDACTED}"`);
}

/** Keeps "Bearer " so a scrubbed header still reads as one. */
function keepScheme(match: string): string {
  const scheme = /^(Bearer|Basic)\s+/i.exec(match);
  return scheme ? `${scheme[0]}${REDACTED}` : REDACTED;
}

export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of new Set(parsed.searchParams.keys()))
      if (isSecretQueryName(name)) parsed.searchParams.set(name, REDACTED);
    parsed.username = '';
    parsed.password = '';
    // A secret under some other name (a JWT in ?state=, a key in the path) still has a known shape.
    return scrubSecrets(parsed.toString());
  } catch {
    return scrubSecrets(url);
  }
}

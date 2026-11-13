// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Secret patterns (P1-F5, AGENTS.md "Secrets"). Keys and tokens live in the
 * OS keychain and never in the database or logs. Free text that may echo one
 * (chat messages, tool input and output, run-log data, cloud-call metadata)
 * is redacted before it is written; the scanner in scan.ts checks the result.
 *
 * One recognizer serves all three uses: `secretSpans` finds secrets in text
 * (the patterns below, plus `name: value` / `name=value` where the name is a
 * secret name), and `isSecretKey` decides which object keys hold one. Redaction
 * (redactText, redactSecrets), refusal (containsSecret) and the scan
 * (findSecrets) all go through them.
 */

export interface SecretPattern {
  /** e.g. 'api_key', 'bearer', 'jwt'. */
  readonly kind: string;
  /** Global regex. If it has a capture group, the group ends the match and only the group is the secret. */
  readonly pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // OpenAI and Anthropic keys (sk-…, sk-proj-…, sk-ant-api03-…, sk-ant-oat01-…, sk-ant-ort01-…).
  { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { kind: 'api_key', pattern: /\bxai-[A-Za-z0-9_-]{20,}/g },
  { kind: 'huggingface_token', pattern: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: 'bearer', pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi },
  // A URL's userinfo (scheme://user:password@host, or a token as the user name); the @ stays. Only the characters
  // RFC 3986 allows there, so a URL that ends at a quote is not joined to an @ in the binary bytes after it.
  { kind: 'url_credentials', pattern: /\b[a-z][a-z0-9+.-]*:\/\/([A-Za-z0-9._~!$&'()*+,;=:%-]+)(?=@)/gi },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Google OAuth refresh tokens.
  { kind: 'refresh_token', pattern: /\b1\/\/0[A-Za-z0-9_-]{20,}/g },
  // A refresh token in a JSON body, a form body or a query string.
  {
    kind: 'refresh_token',
    pattern: /\brefresh[_-]?token["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{12,}=*)/gi,
  },
  // Taalcut's own MCP bearer (P3-V4; core's MCP_TOKEN_PATTERN: 'tcm_' and 43 base64url characters), also cut short
  // in a truncated log line (security review SB-26).
  { kind: 'mcp_token', pattern: /\btcm_[A-Za-z0-9_-]{24,}/g },
  { kind: 'github_token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'aws_access_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'slack_token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  // A PEM private key (PKCS#1/#8, EC, OpenSSH, PGP), to its END line or, if cut off, the end of the text.
  {
    kind: 'private_key',
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
];

/**
 * Names whose value is a secret whatever it looks like, compared with case and
 * separators removed, so `apiKey`, `x-api-key`, `OPENAI_API_KEY` and
 * `aws_secret_access_key` all count. Names of references to keychain items
 * (`secretId`, `credentialRef`) don't.
 */
const SECRET_NAME =
  /(?:apikey|secret|secretkey|secretaccesskey|privatekey|accesstoken|refreshtoken|idtoken|authtoken|sessiontoken|bearertoken|password|passwd|passphrase|authorization|cookie)$/;
/** Environment-style token names: GITHUB_TOKEN, HF_TOKEN, x-auth-token. */
const TOKEN_NAME = /[_-]token$/i;

/** True if a value stored under this object key or header name is a secret. */
export function isSecretKey(key: string): boolean {
  return SECRET_NAME.test(key.toLowerCase().replace(/[^a-z0-9]/g, '')) || TOKEN_NAME.test(key);
}

/**
 * `name: value` or `name=value` in free text (JSON, form bodies, headers, env
 * files, logs), quotes and (nested) JSON escapes allowed. The name must end in a secret
 * word here and pass isSecretKey; the value must be 8+ characters, not only digits.
 */
const ASSIGNMENT =
  /\b([A-Za-z0-9_-]*(?:key|secret|token|passw(?:or)?d|passphrase|authorization|cookie))\\*["']?\s*[:=]\s*\\*["']?(?:(?:basic|bearer|token)\s+)?([^\s"'\\&,;{}[\]<>]{8,})/gi;

interface Span {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
}

/** Every secret in `text` as [start, end) spans, overlaps merged, in order. */
function secretSpans(text: string): Span[] {
  const spans: Span[] = [];
  const add = (kind: string, match: RegExpMatchArray, secret: string) => {
    const start = match.index! + match[0].length - secret.length;
    spans.push({ kind, start, end: start + secret.length });
  };
  for (const { kind, pattern } of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern)) add(kind, match, match[1] ?? match[0]);
  }
  for (const match of text.matchAll(ASSIGNMENT)) {
    const [, name, value] = match;
    if (isSecretKey(name!) && !/^[\d.]+$/.test(value!)) add('secret_field', match, value!);
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end)
      merged[merged.length - 1] = { ...last, end: Math.max(last.end, span.end) };
    else merged.push(span);
  }
  return merged;
}

export interface SecretFinding {
  readonly kind: string;
  /** Offset of the secret in the scanned text. */
  readonly index: number;
  /** The first characters and the length, never the secret itself. */
  readonly preview: string;
}

function preview(secret: string): string {
  return `${secret.slice(0, 6)}… (${secret.length} chars)`;
}

/** Every secret in `text`, in order of appearance. */
export function findSecrets(text: string): SecretFinding[] {
  return secretSpans(text).map(({ kind, start, end }) => ({
    kind,
    index: start,
    preview: preview(text.slice(start, end)),
  }));
}

/** `text` with every secret replaced by `[redacted:<kind>]`. */
export function redactText(text: string): string {
  let out = '';
  let from = 0;
  for (const { kind, start, end } of secretSpans(text)) {
    out += `${text.slice(from, start)}[redacted:${kind}]`;
    from = end;
  }
  return from === 0 ? text : out + text.slice(from);
}

/**
 * A copy of a value with secrets redacted: in every string, and as the whole
 * value of secret-named keys (isSecretKey). Arrays, plain objects, Maps, Sets
 * and Headers are walked; other objects are redacted as JSON would write them
 * (their toJSON, else their own enumerable properties), so nothing that
 * reaches JSON.stringify skips redaction. Values without secrets come back
 * unchanged (the same object).
 */
export function redactSecrets<T>(value: T): T {
  return redact(value, new WeakSet()) as T;
}

const redactedField = (key: unknown, item: unknown) =>
  typeof key === 'string' && isSecretKey(key) && typeof item === 'string' && item !== '';

function redactEntries(
  entries: Iterable<[unknown, unknown]>,
  seen: WeakSet<object>,
): [changed: boolean, out: [unknown, unknown][]] {
  let changed = false;
  const out: [unknown, unknown][] = [];
  for (const [key, item] of entries) {
    const next = redactedField(key, item) ? '[redacted]' : redact(item, seen);
    changed ||= next !== item;
    out.push([key, next]);
  }
  return [changed, out];
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => redact(item, seen));
    return items.every((item, i) => item === value[i]) ? value : items;
  }
  if (value instanceof Map) {
    const [changed, out] = redactEntries(value, seen);
    return changed ? new Map(out) : value;
  }
  if (value instanceof Set) {
    const items = [...value].map((item) => redact(item, seen));
    return items.some((item) => !value.has(item)) ? new Set(items) : value;
  }
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    const [changed, out] = redactEntries(value.entries(), seen);
    return changed ? new Headers(out as [string, string][]) : value;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (
    proto !== Object.prototype &&
    proto !== null &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    const json: unknown = (value as { toJSON(): unknown }).toJSON();
    const next = redact(json, seen);
    return next === json ? value : next;
  }
  const [changed, out] = redactEntries(Object.entries(value), seen);
  return changed ? Object.fromEntries(out) : value;
}

/** True if any string in `value`, or any secret-named key, holds a secret. */
export function containsSecret(value: unknown): boolean {
  return redactSecrets(value) !== value;
}

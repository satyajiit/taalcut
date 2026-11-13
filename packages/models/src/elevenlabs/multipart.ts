// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A `multipart/mixed` answer split into its parts (`POST /v1/music/detailed` sends the plan used as JSON and the
 * audio). Bytes stay bytes: the audio part is returned exactly as sent.
 */

export interface MimePart {
  /** Lower-case header names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** The boundary of a multipart content type, or null. */
export function boundaryOf(contentType: string | null): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  return match?.[1] ?? match?.[2] ?? null;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_END = encoder.encode('\r\n\r\n');
const CR = 0x0d;
const LF = 0x0a;
const DASH = 0x2d;

const crlfAt = (bytes: Uint8Array, at: number) => bytes[at] === CR && bytes[at + 1] === LF;

function headersOf(block: Uint8Array): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of decoder.decode(block).split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** One part's bytes (between its delimiter line and the next) as headers and body. */
function partOf(content: Uint8Array): MimePart {
  // No headers: the part opens with its blank line.
  if (crlfAt(content, 0)) return { headers: {}, body: content.subarray(2) };
  const split = indexOf(content, HEADER_END, 0);
  if (split < 0) return { headers: {}, body: content };
  return {
    headers: headersOf(content.subarray(0, split)),
    body: content.subarray(split + HEADER_END.length),
  };
}

/** The parts between `--boundary` lines; a body without them has none. */
export function parseMultipart(body: Uint8Array, boundary: string): MimePart[] {
  const delimiter = encoder.encode(`--${boundary}`);
  const parts: MimePart[] = [];
  let at = indexOf(body, delimiter, 0);
  while (at >= 0) {
    const start = at + delimiter.length;
    // `--boundary--` closes the message.
    const closing = body[start] === DASH && body[start + 1] === DASH;
    const next = closing ? -1 : indexOf(body, delimiter, start);
    if (next < 0) break;
    const contentStart = crlfAt(body, start) ? start + 2 : start;
    // The CRLF before the next delimiter belongs to the delimiter.
    const contentEnd = crlfAt(body, next - 2) ? next - 2 : next;
    parts.push(partOf(body.subarray(contentStart, contentEnd)));
    at = next;
  }
  return parts;
}

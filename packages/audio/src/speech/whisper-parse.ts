// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * whisper.cpp `-ojf` tokens to words. Byte-sized tokens are joined before
 * UTF-8 decode so a character split across tokens (Devanagari often is)
 * becomes one word. A 1–3 word phrase repeated four or more times is cut
 * at the second copy. Where whisper ran DTW (`--dtw`, the small model), a
 * word starts at its first token's `t_dtw` and lasts until the next word's:
 * the token offsets put the first word at 0 after a lead-in of silence and
 * drift by seconds, which captions and cuts on word boundaries can't use.
 */
import { type TranscriptWord } from '@taalcut/core';
import { AUDIO_CONFIG } from '../config';
import { msRange } from '../rates';

export interface WhisperToken {
  readonly text: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly probability?: number;
  /** The token's DTW time in ms (`t_dtw`, centiseconds; -1 or absent without DTW). */
  readonly dtwMs?: number;
}

const SPECIAL_TOKEN = /^\[_/;
/** A DTW word runs to the next word's start, but not across a pause longer than this. */
const DTW_WORD_MAX_MS = 1500;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function isByteString(text: string): boolean {
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0xff) return false;
  }
  return true;
}

/** Raw `\u00XX` bytes, or the UTF-8 encoding of a real JavaScript string. */
function tokenToBytes(text: string, asBytes: boolean): Uint8Array {
  if (!asBytes) return utf8Encoder.encode(text);
  const chars = [...text];
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i += 1) bytes[i] = chars[i]?.codePointAt(0) ?? 0;
  return bytes;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function finishText(raw: string): string {
  let text = raw;
  if (text.startsWith(' ') || text.startsWith('\u2581')) text = text.slice(1);
  return text.normalize('NFC');
}

function replacementCount(text: string): number {
  let count = 0;
  for (const char of text) if (char === '\uFFFD') count += 1;
  return count;
}

/**
 * Latin-1 code points are whisper's raw token bytes. A real character such
 * as "é" is also ≤ U+00FF; if that byte reading is not valid UTF-8, encode
 * the JavaScript string instead.
 */
function decodeTokens(tokens: readonly WhisperToken[]): string {
  const byteParts = tokens.map((token) => tokenToBytes(token.text, isByteString(token.text)));
  const asBytes = finishText(utf8Decoder.decode(concatBytes(byteParts)));
  if (!asBytes.includes('\uFFFD')) return asBytes;
  const asText = finishText(
    utf8Decoder.decode(concatBytes(tokens.map((token) => tokenToBytes(token.text, false)))),
  );
  return replacementCount(asText) < replacementCount(asBytes) ? asText : asBytes;
}

function isWordStart(text: string): boolean {
  return text.startsWith(' ') || text.startsWith('\u2581');
}

/** Specials are dropped. Tokens before the first boundary join the first word. */
function groupTokens(tokens: readonly WhisperToken[]): WhisperToken[][] {
  const groups: WhisperToken[][] = [];
  let current: WhisperToken[] | null = null;
  let seenBoundary = false;
  for (const token of tokens) {
    if (SPECIAL_TOKEN.test(token.text)) continue;
    const boundary = isWordStart(token.text);
    if (current && boundary && seenBoundary) {
      groups.push(current);
      current = [token];
      continue;
    }
    if (!current) current = [];
    current.push(token);
    if (boundary) seenBoundary = true;
  }
  if (current && current.length > 0) groups.push(current);
  return groups;
}

function meanProbability(tokens: readonly WhisperToken[]): number | undefined {
  let sum = 0;
  let count = 0;
  for (const token of tokens) {
    if (typeof token.probability !== 'number' || !Number.isFinite(token.probability)) continue;
    sum += token.probability;
    count += 1;
  }
  return count === 0 ? undefined : sum / count;
}

function finiteMs(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function wordsOf(groups: readonly (readonly WhisperToken[])[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const [index, group] of groups.entries()) {
    const text = decodeTokens(group);
    if (text.length === 0) continue;
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    const start = first.dtwMs ?? finiteMs(first.fromMs, 0);
    const next = groups[index + 1]?.[0]?.dtwMs;
    const end =
      first.dtwMs !== undefined && next !== undefined && next > start
        ? Math.min(next, start + DTW_WORD_MAX_MS)
        : Math.max(start, finiteMs(last.toMs, start));
    const confidence = meanProbability(group);
    words.push({
      text,
      range: msRange(start, Math.max(0, end - start)),
      ...(confidence === undefined ? {} : { confidence }),
    });
  }
  return words;
}

function samePhrase(words: readonly TranscriptWord[], left: number, right: number, length: number): boolean {
  for (let offset = 0; offset < length; offset += 1) {
    if (words[left + offset]?.text !== words[right + offset]?.text) return false;
  }
  return true;
}

function repeatCount(words: readonly TranscriptWord[], start: number, length: number): number {
  if (length < 1 || start + length > words.length) return 0;
  let count = 1;
  while (
    start + (count + 1) * length <= words.length &&
    samePhrase(words, start, start + count * length, length)
  ) {
    count += 1;
  }
  return count;
}

/**
 * Longer phrases first, so a 3-word loop is not read as a 1-word loop.
 * Keep two copies and resume after the run.
 */
function truncateLoops(words: readonly TranscriptWord[]): {
  words: TranscriptWord[];
  loopTruncated: boolean;
} {
  const minLen = AUDIO_CONFIG.speech.loopMinWords;
  const maxLen = AUDIO_CONFIG.speech.loopMaxWords;
  const need = AUDIO_CONFIG.speech.loopRepeats;
  const out: TranscriptWord[] = [];
  let loopTruncated = false;
  let index = 0;
  while (index < words.length) {
    let cut: { length: number; repeats: number } | null = null;
    for (let length = maxLen; length >= minLen; length -= 1) {
      const repeats = repeatCount(words, index, length);
      if (repeats >= need) {
        cut = { length, repeats };
        break;
      }
    }
    if (!cut) {
      const word = words[index];
      if (word) out.push(word);
      index += 1;
      continue;
    }
    loopTruncated = true;
    for (let offset = 0; offset < cut.length * 2; offset += 1) {
      const word = words[index + offset];
      if (word) out.push(word);
    }
    index += cut.length * cut.repeats;
  }
  return { words: out, loopTruncated };
}

export function wordsFromTokens(tokens: readonly WhisperToken[]): {
  words: TranscriptWord[];
  loopTruncated: boolean;
} {
  return truncateLoops(wordsOf(groupTokens(tokens)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function msField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseToken(value: unknown): WhisperToken | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const offsets = isRecord(value.offsets) ? value.offsets : {};
  const probability = typeof value.p === 'number' && Number.isFinite(value.p) ? value.p : undefined;
  const dtw =
    typeof value.t_dtw === 'number' && Number.isFinite(value.t_dtw) && value.t_dtw >= 0 ? value.t_dtw : -1;
  return {
    text: value.text,
    fromMs: msField(offsets.from),
    toMs: msField(offsets.to),
    ...(probability === undefined ? {} : { probability }),
    ...(dtw >= 0 ? { dtwMs: dtw * 10 } : {}),
  };
}

const EMPTY_PARSE = {
  language: null,
  tokens: [] as WhisperToken[],
  words: [] as TranscriptWord[],
  loopTruncated: false,
};

/** whisper.cpp `-ojf`. A missing `transcription` is no tokens, not a throw. */
export function parseWhisperJson(json: unknown): {
  language: string | null;
  tokens: WhisperToken[];
  words: TranscriptWord[];
  loopTruncated: boolean;
} {
  if (!isRecord(json)) return EMPTY_PARSE;
  const result = isRecord(json.result) ? json.result : null;
  const language = result && typeof result.language === 'string' ? result.language : null;
  if (!Array.isArray(json.transcription)) return { ...EMPTY_PARSE, language };
  const tokens: WhisperToken[] = [];
  for (const segment of json.transcription) {
    if (!isRecord(segment) || !Array.isArray(segment.tokens)) continue;
    for (const token of segment.tokens) {
      const parsed = parseToken(token);
      if (parsed) tokens.push(parsed);
    }
  }
  const { words, loopTruncated } = wordsFromTokens(tokens);
  return { language, tokens, words, loopTruncated };
}

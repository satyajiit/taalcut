// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export const PROVISIONAL_TITLE_LENGTH = 48;
export const TITLE_WORDS = 6;
export const MAX_CLEAN_TITLE_LENGTH = 60;

export const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

const CANNED_PREFIXES: readonly { readonly pattern: RegExp; readonly fallback: string }[] = [
  {
    pattern: /^(?:make|create)\s+a\s+video\s+like\s+this\s+reel\s*[:\-–—]?\s*/iu,
    fallback: 'Reel breakdown',
  },
  {
    pattern: /^(?:make|create)\s+a\s+video\s+with\s+my\s+template\s*[:\-–—]?\s*/iu,
    fallback: 'Template video',
  },
  { pattern: /^(?:make|create)\s+a\s+video\s+with\s+the\s+/iu, fallback: 'Template video' },
  {
    pattern: /^(?:make|create)\s+a\s+video\s+with\s+this\s+(?:template|clip|reel)\s*[:\-–—]?\s*/iu,
    fallback: 'Template video',
  },
  {
    pattern: /^(?:make|create)\s+a\s+video\s+with\s+these\s*(?:clips)?\s*[:\-–—]?\s*/iu,
    fallback: 'Selected clips',
  },
  { pattern: /^(?:make|create)\s+a\s+video\s+with\s*[:\-–—]?\s*/iu, fallback: 'New video' },
  { pattern: /^(?:make|create)\s+a\s+video\s+in\s+the\s+/iu, fallback: 'Template video' },
  {
    pattern: /^(?:make|create)\s+a\s+video\s+from\s+my\s+latest\s+clips\s*[:\-–—]?\s*/iu,
    fallback: 'Latest clips',
  },
  { pattern: /^(?:make|create)\s+a\s+video\s+(?:from|about|for|of|using)\s+/iu, fallback: 'New video' },
  { pattern: /^(?:make|create)\s+a\s+video\s*[:\-–—]?\s*/iu, fallback: 'New video' },
  {
    pattern:
      /^(?:make|create|copy|recreate)\s+(?:(?:a|an|some|this|that|the)\s+)?(?:(?:videos?|reels?|shorts?|edits?)\s+)?(?:from|like|using)\s+/iu,
    fallback: 'Reference reel breakdown',
  },
];

const REFERENCE_URL_RE =
  /https?:\/\/[^\s"'“”<>]+|\b(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|youtube\.com|youtu\.be)\/[^\s"'“”<>]+/giu;
const GENERIC_FOOTAGE_RE =
  /^(?:(?:from|with|using|out\s+of|in)\s+)?(?:(?:all(?:\s+of)?\s+)?(?:my|our|the|these|those)\s+)?(?:own\s+)?(?:footages?|clips?|videos?|shots?|library|media|camera\s+roll)$/iu;

/** Keep the subject beside a reference instead of a URL, tracking query or local path. */
function referenceContext(text: string): string | undefined {
  const withoutLocations = text
    .replace(REFERENCE_URL_RE, ' ')
    .replace(/(["'])(?:file:\/\/|~\/|\/|[a-z]:[\\/])[^"']+\1/giu, ' ')
    .replace(/(?<!\S)(?:file:\/\/|~\/|\/|[a-z]:[\\/])[^\s"'“”<>|]+/giu, ' ');
  if (withoutLocations === text) return undefined;
  const subject = flat(withoutLocations)
    .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/gu, '')
    .replace(/^(?:(?:we|you)\s+can\s+)?(?:use|include|add)\s+(?:(?:our|my|the)\s+)?/iu, '')
    .replace(/^(?:with|using|from)\s+(?:(?:our|my|the)\s+)?/iu, '');
  return subject && !GENERIC_FOOTAGE_RE.test(subject) ? cutAtWord(capitalizeFirst(subject)) : undefined;
}

const MEDIA_EXT_RE =
  /\.(?:mp4|mov|m4v|mkv|webm|avi|mts|m2ts|3gp|mpg|mpeg|wmv|flv|mp3|wav|m4a|aac|flac|ogg|jpg|jpeg|png|heic|webp|gif)$/iu;
const CAMERA_PREFIX_RE = /^(?:img|dsc|dscf|dscn|vid|mov|mvi|dji|pxl|gopr|gx|clip)(?:\d+)?$/iu;
const CAMERA_ALPHA_ONLY_RE = /^(?:img|dsc|dscf|dscn|vid|mov|mvi|dji|pxl|gopr|gx|clip)$/iu;
const NOISE_TOKEN_RE =
  /^(?:\d{3,4}x\d{3,4}|(?:4320|2160|1440|1080|720|540|480|360)p\d*|[248]k\d*|\d{2,3}fps|h264|h265|hevc|avc|prores)$/iu;
const PROCEDURAL_OPENER_RE =
  /^(?:i\s+will|i['’]ll|i\s+am\s+(?:now\s+)?(?:going\s+to|saving|mapping|matching|casting|building|fetching|analyzing|checking)|i['’]m\s+(?:now\s+)?(?:going\s+to|saving|mapping|matching|casting|building|fetching|analyzing|checking)|let\s+me|let['’]s|starting|breaking\s+down|analyzing|checking|looking\s+at|working\s+on|one\s+moment|hold\s+on)\b/iu;
const PROCEDURAL_STATUS_RE =
  /\b(?:shots?\s+are\s+mapped|saving\s+their\s+timing|for\s+matching\s+against\s+your\s+(?:footage|clips|library)|template\s+is\s+ready[;,.]?\s+i['’]?m\s+(?:now\s+)?matching|matching\s+your\s+(?:clips|footage)\s+to\s+(?:its|the)\s+slots)\b/iu;
const WORKFLOW_SUFFIX_RE =
  /\s+(?:reference\s+matching|reel\s+matching|shot\s+matching|clip\s+matching|template\s+matching|inspired\s+(?:video\s+)?(?:edit|reel|cut|short)|from\s+my\s+footages?)$/iu;
const BANNED_AI_TITLE_RE =
  /^(?:reference\s+matching|reel\s+matching|shot\s+matching|clip\s+matching|template\s+matching|inspired\s+(?:video\s+)?(?:edit|reel|cut|short)|from\s+my\s+footages?)$/iu;

function cutAtWord(text: string, maxLength = PROVISIONAL_TITLE_LENGTH): string {
  const clean = flat(text);
  if (clean.length <= maxLength) return clean;
  const room = clean.slice(0, maxLength - 1);
  const space = room.lastIndexOf(' ');
  const cut = (space > 0 ? room.slice(0, space) : room).replace(/[\s,;:.!?…-]+$/u, '');
  return `${cut}…`;
}

const capitalizeFirst = (text: string) => {
  const trimmed = flat(text);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
};

const stripOuterQuotes = (text: string) => text.replace(/^["'“”‘’«»`*]+|["'“”‘’«»`*]+$/gu, '').trim();

function formatSocialUrl(raw: string): string | undefined {
  const match =
    raw.match(/https?:\/\/[^\s"'“”<>]+/iu) ??
    raw.match(
      /\b(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|youtube\.com|youtu\.be)\/[^\s"'“”<>]+/iu,
    );
  if (!match) return undefined;
  const lower = match[0].toLowerCase();
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'Instagram reel breakdown';
  if (lower.includes('youtube.com/shorts') || lower.includes('youtu.be/shorts'))
    return 'YouTube Short breakdown';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube video breakdown';
  if (lower.includes('tiktok.com')) return 'TikTok reel breakdown';
  if (lower.includes('vimeo.com')) return 'Vimeo video breakdown';
  return 'Reference reel breakdown';
}

function extractFilePath(text: string, strippedPrefix: boolean): string | undefined {
  const unquoted = stripOuterQuotes(text);
  if (
    /^(?:file:\/\/|~\/|\/|[a-z]:[\\/])/iu.test(unquoted) &&
    (MEDIA_EXT_RE.test(unquoted) || !/\s/.test(unquoted) || strippedPrefix)
  ) {
    return unquoted;
  }
  const winMatch = unquoted.match(/\b[a-z]:[\\/][^\s"'“”<>|]+/iu);
  if (winMatch) return winMatch[0];
  const unixMatch = unquoted.match(/(?:file:\/\/)?(?:~\/|\/)[^\s"'“”<>|]+/iu);
  if (unixMatch && (MEDIA_EXT_RE.test(unixMatch[0]) || strippedPrefix || unixMatch[0] === unquoted)) {
    return unixMatch[0];
  }
  if ((strippedPrefix || !/\s/.test(unquoted)) && MEDIA_EXT_RE.test(unquoted)) {
    return unquoted.match(/[^\s"'“”<>|]+\.[a-z0-9]{2,5}$/iu)?.[0];
  }
  return undefined;
}

function formatFilePathTitle(rawPath: string): string | undefined {
  let decoded = rawPath.replace(/^file:\/\//iu, '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep raw */
  }
  const base = decoded
    .replace(/[\\/]+$/u, '')
    .split(/[\\/]/u)
    .filter(Boolean)
    .at(-1);
  if (!base) return undefined;
  const stem = base.replace(MEDIA_EXT_RE, '').replace(/\.[a-z0-9]{2,4}$/iu, '');
  const rawTokens = stem.split(/[-_\s.]+/u).filter(Boolean);
  const filtered: string[] = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    const token = rawTokens[i]!;
    if (CAMERA_PREFIX_RE.test(token)) {
      if (CAMERA_ALPHA_ONLY_RE.test(token) && /^\d+$/u.test(rawTokens[i + 1] ?? '')) {
        i += /^\d{4,6}$/u.test(rawTokens[i + 2] ?? '') ? 2 : 1;
      }
      continue;
    }
    if (!NOISE_TOKEN_RE.test(token)) filtered.push(token);
  }
  const joined = (filtered.length > 0 ? filtered : rawTokens).join(' ');
  return joined ? cutAtWord(capitalizeFirst(joined)) : undefined;
}

/** A sole file keeps its readable basename; prose beside a reference is more useful than its location. */
function referenceTitle(text: string, strippedPrefix: boolean): string | undefined {
  const filePath = extractFilePath(text, strippedPrefix);
  const fileTitle = filePath ? formatFilePathTitle(filePath) : undefined;
  if (
    fileTitle &&
    stripOuterQuotes(text) === filePath &&
    (!/\s/u.test(filePath) || MEDIA_EXT_RE.test(filePath))
  )
    return fileTitle;
  return referenceContext(text) ?? formatSocialUrl(text) ?? fileTitle;
}

/** The title a chat has until a model names it: cleaned of canned prefixes, paths and URLs. */
export function provisionalTitle(message: string): string {
  const raw = flat(message);
  if (!raw) return '';
  let remainder = raw.replace(/^(?:let['’]?s\s+|please\s+)(?=(?:make|create|copy|recreate)\b)/iu, '');
  let strippedPrefix = false;
  let fallback = '';
  for (const entry of CANNED_PREFIXES) {
    if (entry.pattern.test(remainder)) {
      remainder = remainder.replace(entry.pattern, '').trim();
      strippedPrefix = true;
      fallback = entry.fallback;
      break;
    }
  }
  if (!remainder) return fallback || cutAtWord(raw);

  const quotedStarter = remainder.match(
    /^["'“”‘’]([^"'“”‘’]+)["'“”‘’](?:\s+(?:starter|format|template))?$/iu,
  );
  if (quotedStarter?.[1]) remainder = quotedStarter[1].trim();
  else if (strippedPrefix && /^["'“”‘’].*["'“”‘’]$/u.test(remainder)) remainder = stripOuterQuotes(remainder);

  return (
    referenceTitle(remainder, strippedPrefix) ??
    cutAtWord(strippedPrefix ? capitalizeFirst(remainder) : remainder)
  );
}

/** Whether `currentTitle` is still managed by Taalcut rather than user-renamed. */
export function isManagedTitle(
  currentTitle: string,
  firstUserMessage: string,
  lastAiTitle?: string,
): boolean {
  const trimmed = currentTitle.trim();
  if (!trimmed) return true;
  if (lastAiTitle !== undefined && (currentTitle === lastAiTitle || trimmed === lastAiTitle.trim()))
    return true;
  const firstLine =
    firstUserMessage
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  return (
    currentTitle === provisionalTitle(firstUserMessage) ||
    currentTitle === cutAtWord(flat(firstUserMessage)) ||
    currentTitle === firstUserMessage.trim().slice(0, PROVISIONAL_TITLE_LENGTH) ||
    currentTitle === firstLine.slice(0, PROVISIONAL_TITLE_LENGTH) ||
    currentTitle === flat(firstUserMessage) ||
    currentTitle === flat(firstUserMessage).slice(0, 80)
  );
}

export const isProvisionalTitle = isManagedTitle;

/** A model's reply cleaned into a title: first line, no quotes/markdown/labels/trailing punctuation, <= 60 chars. */
export function cleanTitle(reply: string): string | undefined {
  const line = reply
    .split('\n')
    .map((l) => l.replace(/^#+\s*/u, '').trim())
    .find(Boolean);
  if (!line) return undefined;
  const stripped = flat(
    line
      .replace(/[*_`~]+/gu, '')
      .replace(/^(?:chat\s+)?(?:title|titel|titre|título)\s*:\s*/iu, '')
      .replace(/^["'“”‘’«»`*]+|["'“”‘’«»`*]+$/gu, ''),
  );
  if (!stripped) return undefined;
  const joined = stripped
    .split(' ')
    .filter(Boolean)
    .slice(0, TITLE_WORDS)
    .join(' ')
    .replace(/[\s.,;:!?…。、！？\-–—]+$/u, '')
    .replace(/^["'“”‘’«»`*]+|["'“”‘’«»`*]+$/gu, '')
    .replace(WORKFLOW_SUFFIX_RE, '')
    .trim();
  if (!joined || BANNED_AI_TITLE_RE.test(joined)) return undefined;
  return joined.length > MAX_CLEAN_TITLE_LENGTH
    ? cutAtWord(joined, MAX_CLEAN_TITLE_LENGTH).replace(/…$/u, '').trim() || undefined
    : joined;
}

export const tidyTitle = cleanTitle;

export const isProceduralOpener = (text: string) => {
  const paragraphs = text.split(/\n+/u).map(flat).filter(Boolean);
  return (
    paragraphs.length === 0 ||
    paragraphs.every((p) => p.length < 240 && (PROCEDURAL_OPENER_RE.test(p) || PROCEDURAL_STATUS_RE.test(p)))
  );
};

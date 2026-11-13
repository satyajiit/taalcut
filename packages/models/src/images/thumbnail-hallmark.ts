// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hallmark thumbnail prompt and copy preflight. This does not inspect rendered pixels:
 * - Enhances raster backdrop generation prompts with aspect-specific safe zones
 *   (YouTube bottom-right duration pill, Shorts/Reels right-rail & 4:5 grid crop),
 *   intentional negative space in the `textAlign` zone, scene-specific art direction,
 *   and explicit anti-slop negative directives.
 * - Sanitizes `hookText` (1–6 words, <= 48 chars, roman copy, no trailing period
 *   or clickbait `!!!`), `kickerText` (<= 28 chars), and `statBadge` (<= 20 chars,
 *   rejecting invented engagement metrics like `10M VIEWS`, `99.9%`, `100X` while
 *   allowing real timeline/camera facts like `14 SHOTS`, `4K RAW`, `DAY 2`, `0:42`).
 * - Checks the brief's copy while leaving execution and structural variety
 *   below the passing threshold until the finished composition is reviewed.
 */
import {
  hallmarkScoreSchema,
  type HallmarkScore,
  type PublishPlatform,
  type ThumbnailAlignment,
  type ThumbnailArchetype,
  type ThumbnailAspect,
  type ThumbnailTheme,
} from '@taalcut/core';
import { MAX_IMAGE_PROMPT } from './image-types';

export const HALLMARK_THUMBNAIL_AVOID =
  'Avoid unrequested watermarks, invented logos, generic neon gradients, glowing sci-fi HUDs, plastic skin and stock poses';

export const HALLMARK_THUMBNAIL_REVIEW_NOTE =
  'Visual review required: these scores check only the written brief. Execution and variety remain unreviewed, ' +
  'not quality judgments. Inspect the finished thumbnail for framing, contrast, typography and structural variety, ' +
  'then save the composed cover before claiming it is ready.';

export interface ThumbnailAspectSpec {
  readonly width: number;
  readonly height: number;
  readonly platform: PublishPlatform;
  readonly safeZoneNote: string;
}

export const THUMBNAIL_ASPECT_SPECS: Readonly<Record<ThumbnailAspect, ThumbnailAspectSpec>> = {
  '16:9': {
    width: 1920,
    height: 1080,
    platform: 'youtube',
    safeZoneNote:
      '16:9 widescreen YouTube thumbnail frame (1920x1080); keep bottom-right corner clear of key detail for the duration badge pill and anchor the primary subject off-center.',
  },
  '9:16': {
    width: 1080,
    height: 1920,
    platform: 'shorts',
    safeZoneNote:
      '9:16 vertical Shorts/Reels/TikTok cover frame (1080x1920); keep the right-rail action icon zone and bottom caption zone uncluttered while keeping the central 4:5 profile grid crop coherent.',
  },
  '4:5': {
    width: 1080,
    height: 1350,
    platform: 'reels',
    safeZoneNote:
      '4:5 portrait Instagram feed cover frame (1080x1350); compose the primary subject with clean margins so a center 1:1 profile grid crop stays balanced.',
  },
  '1:1': {
    width: 1080,
    height: 1080,
    platform: 'reels',
    safeZoneNote:
      '1:1 square profile grid cover frame (1080x1080); asymmetric rule-of-thirds subject placement with generous breathing room.',
  },
};

const ALIGNMENT_DIRECTIONS: Readonly<Record<ThumbnailAlignment, string>> = {
  left: 'Reserve an intentional low-detail tonal negative-space zone along the left column for crisp roman typographic overlay.',
  'top-left':
    'Reserve an intentional low-detail tonal negative-space zone in the top-left quadrant for crisp roman typographic overlay.',
  'bottom-left':
    'Reserve an intentional low-detail tonal negative-space zone in the bottom-left quadrant for crisp roman typographic overlay.',
};

const ARCHETYPE_DIRECTIONS: Readonly<Record<ThumbnailArchetype, string>> = {
  'editorial-specimen':
    'Editorial composition: decisive focal hierarchy and magazine-cover poise in the requested visual medium.',
  'brutal-slab':
    'Brutalist slab composition: high-contrast architectural geometry, bold shadow planes, stark tonal separation.',
  'atmospheric-cinema':
    'Atmospheric composition: let the chosen medium and setting carry the mood with one clear focal subject.',
  'minimal-frame':
    'Minimalist gallery frame: quiet uncluttered backdrop, generous tonal negative space, singular focal object.',
  'stat-callout':
    'Technical specimen composition: crisp subject isolation with clean tonal separation for a factual callout badge.',
};

const THEME_OPTICS: Readonly<Record<ThumbnailTheme, string>> = {
  'golden-hour':
    'Golden-hour palette: restrained warm highlights and natural material colors; preserve the scene and lighting described in the brief.',
  midnight:
    'Midnight palette: deep blue-black tones with readable subject separation and only light sources that belong in the scene.',
  newsprint:
    'Newsprint palette: restrained neutral tones and clear documentary detail; preserve the subject and its actual setting.',
  studio:
    'Studio palette: clean neutral color relationships and clear material detail, without replacing the setting described in the brief.',
  terminal:
    'Terminal palette: dark neutral tones and a restrained green accent only where it fits the subject; preserve the described setting.',
  'brand-kit':
    'Brand palette: follow supplied brand colors and material cues; do not invent a brand or alter the scene to fit a stock treatment.',
};

export interface HallmarkPromptInput {
  readonly prompt: string;
  readonly medium?: 'photograph' | 'illustration' | 'graphic' | 'mixed';
  readonly composition?: 'backdrop' | 'complete';
  readonly hookText?: string;
  readonly kickerText?: string;
  readonly branding?: string;
  readonly aspect?: ThumbnailAspect;
  readonly archetype?: ThumbnailArchetype;
  readonly theme?: ThumbnailTheme;
  readonly textAlign?: ThumbnailAlignment;
}

/**
 * Enhances a user/agent scene prompt into a Hallmark anti-slop thumbnail backdrop prompt
 * with aspect safe zones, intentional negative space for typography, and scene-specific art direction.
 */
export function buildHallmarkThumbnailPrompt(input: HallmarkPromptInput): string {
  const aspect = input.aspect ?? '16:9';
  const archetype = input.archetype ?? 'editorial-specimen';
  const theme = input.theme ?? 'golden-hour';
  const textAlign = input.textAlign ?? 'bottom-left';
  const scene = input.prompt.trim().replace(/\s+/g, ' ');

  const directions = [
    input.medium
      ? `Requested medium: ${input.medium}. Preserve that art direction; do not convert illustration or graphic artwork into a photograph.`
      : 'Preserve the medium described in the brief, whether photographic, illustrated, graphic or mixed; do not impose photorealism.',
    THUMBNAIL_ASPECT_SPECS[aspect].safeZoneNote,
    input.composition === 'complete'
      ? `Create the complete composition, including the requested lettering and supplied branding. Exact headline: ${JSON.stringify(input.hookText ?? '')}. ${input.kickerText ? `Secondary label: ${JSON.stringify(input.kickerText)}.` : ''} ${input.branding ? `Supplied branding: ${JSON.stringify(input.branding)}.` : ''} Preserve the brief's intended text placement and graphic elements; do not reserve a blank overlay zone.`
      : `${ALIGNMENT_DIRECTIONS[textAlign]} Keep the backdrop free of lettering; exact typography and supplied branding will be composed as editable cover design layers.`,
    ARCHETYPE_DIRECTIONS[archetype],
    THEME_OPTICS[theme],
    `${HALLMARK_THUMBNAIL_AVOID}.`,
  ].join(' ');
  // Long briefs retain the requested medium, composition mode and crop guidance.
  const sceneBudget = MAX_IMAGE_PROMPT - directions.length - 'Hero subject: . '.length;
  return `Hero subject: ${scene.slice(0, Math.max(0, sceneBudget)).trimEnd()}. ${directions}`;
}

const FAKE_ENGAGEMENT_METRIC_PATTERNS: readonly RegExp[] = [
  /\b\d+(?:[.,]\d+)?\s*[kmb]?\+?\s*(?:views|likes|subs|subscribers|followers|clicks|shares|impressions|viral|watched)\b/i,
  /\b\d+(?:[.,]\d+)?\s*%/,
  /\b(?:10|50|100|1000|\d{2,})\s*x\b/i,
  /^\s*\d+\s*x\s*$/i,
  /\b(?:must\s*watch|gone\s*wrong|shocking|insane|unbelievable|secret\s*hack|guaranteed)\b/i,
];

const SLOP_PROMPT_PATTERN =
  /\b(?:neon\s+purple|purple-to-cyan|glowing\s+(?:sci-fi\s+)?hud|plastic\s+skin|stock\s+pose)\b/i;

function stripMarkdownAndQuotes(raw: string): string {
  return raw
    .replace(/[*_~`]+/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingClickbait(raw: string): string {
  return raw
    .replace(/(?:!+|\?{2,}|!\?+|\?!+|\.+|…+)\s*$/g, '')
    .replace(/!{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitizes a thumbnail hook headline:
 * - Crisp roman copy (strips markdown emphasis/quotes)
 * - Strips trailing periods and clickbait `!!!`
 * - Enforces 1–6 words and <= 48 characters
 */
export function sanitizeHallmarkHook(raw: string): string {
  const cleaned = stripTrailingClickbait(stripMarkdownAndQuotes(raw));
  if (!cleaned) return 'FEATURED CUT';
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 6);
  let joined = words.join(' ');
  if (joined.length > 48) {
    const fitted: string[] = [];
    for (const word of words) {
      const candidate = fitted.length === 0 ? word : `${fitted.join(' ')} ${word}`;
      if (candidate.length <= 48) fitted.push(word);
      else break;
    }
    joined = fitted.length > 0 ? fitted.join(' ') : joined.slice(0, 48).trimEnd();
  }
  return stripTrailingClickbait(joined) || 'FEATURED CUT';
}

/** Sanitizes an optional kicker eyebrow label (<= 28 chars, crisp roman copy). */
export function sanitizeHallmarkKicker(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = stripTrailingClickbait(stripMarkdownAndQuotes(raw));
  if (!cleaned) return undefined;
  return cleaned.length <= 28 ? cleaned : cleaned.slice(0, 28).trimEnd();
}

/**
 * Sanitizes an optional stat badge (<= 20 chars):
 * Rejects invented engagement metrics (`10M VIEWS`, `99.9%`, `100X`) per Hallmark's
 * zero-invented-metrics rule while keeping real video/timeline facts (`14 SHOTS`, `4K RAW`, `DAY 2`, `0:42`).
 */
export function sanitizeHallmarkStatBadge(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = stripTrailingClickbait(stripMarkdownAndQuotes(raw));
  if (!cleaned) return undefined;
  for (const pattern of FAKE_ENGAGEMENT_METRIC_PATTERNS) {
    if (pattern.test(cleaned)) return undefined;
  }
  return cleaned.length <= 20 ? cleaned : cleaned.slice(0, 20).trimEnd();
}

/** Sanitizes an optional duration badge (<= 12 chars, e.g. `0:42`, `12:18`). */
export function sanitizeDurationBadge(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = stripMarkdownAndQuotes(raw);
  if (!cleaned) return undefined;
  return cleaned.length <= 12 ? cleaned : cleaned.slice(0, 12).trimEnd();
}

export interface HallmarkEvalInput {
  readonly prompt: string;
  readonly hookText: string;
  readonly kickerText?: string;
  readonly statBadge?: string;
  readonly durationBadge?: string;
  readonly aspect?: ThumbnailAspect;
  readonly archetype?: ThumbnailArchetype;
  readonly theme?: ThumbnailTheme;
  readonly textAlign?: ThumbnailAlignment;
}

export interface HallmarkThumbnailEvaluation extends HallmarkScore {
  readonly hookText: string;
  readonly kickerText?: string;
  readonly statBadge?: string;
  readonly durationBadge?: string;
  readonly score: HallmarkScore;
  readonly warnings: readonly string[];
}

/**
 * Sanitizes thumbnail overlay copy and checks the written design brief. A good prompt
 * cannot certify the image's contrast, framing, typography or structural variety.
 */
export function evaluateHallmarkThumbnail(input: HallmarkEvalInput): HallmarkThumbnailEvaluation {
  const warnings: string[] = [];
  const rawHook = input.hookText.trim();
  const rawWords = rawHook.split(/\s+/).filter(Boolean);
  const hadClickbait = /(?:!{2,}|\?{2,}|\.\s*$)/.test(rawHook);
  const hadMarkdown = /[*_~`]/.test(rawHook);

  const hookText = sanitizeHallmarkHook(input.hookText);
  const kickerText = sanitizeHallmarkKicker(input.kickerText);
  const statBadge = sanitizeHallmarkStatBadge(input.statBadge);
  const durationBadge = sanitizeDurationBadge(input.durationBadge);

  if (rawWords.length > 6 || rawHook.length > 48) {
    warnings.push('hookText exceeded 6 words or 48 chars and was trimmed to Hallmark display bounds.');
  }
  if (hadClickbait) {
    warnings.push('Stripped trailing periods or clickbait punctuation from hookText.');
  }
  if (hadMarkdown) {
    warnings.push('Stripped italic/markdown emphasis to enforce crisp roman headline copy.');
  }
  if (input.statBadge && input.statBadge.trim().length > 0 && !statBadge) {
    warnings.push(`Rejected fake or invented metric statBadge "${input.statBadge.trim()}".`);
  }
  const hasSlopPrompt = SLOP_PROMPT_PATTERN.test(input.prompt);
  if (hasSlopPrompt) {
    warnings.push('Prompt contained AI-slop visual clichés; anti-slop directives applied.');
  }
  warnings.push(HALLMARK_THUMBNAIL_REVIEW_NOTE);

  const promptWords = input.prompt.trim().split(/\s+/).filter(Boolean).length;
  const philosophy = promptWords >= 3 && !hasSlopPrompt ? 5 : 4;
  const hierarchy = rawWords.length <= 6 && rawHook.length <= 48 ? 5 : 4;
  // These axes need the finished image and prior designs, neither of which this preflight receives.
  const execution = 2;
  const specificity = promptWords >= 4 && !(input.statBadge && !statBadge) ? 5 : 4;
  const restraint = !hadClickbait && !(input.statBadge && !statBadge) ? 5 : 4;
  const variety = 2;

  const axes = [philosophy, hierarchy, execution, specificity, restraint, variety];
  const total = axes.reduce((sum, n) => sum + n, 0);
  const passed = axes.every((n) => n >= 4) && total >= 26;

  const score = hallmarkScoreSchema.parse({
    philosophy,
    hierarchy,
    execution,
    specificity,
    restraint,
    variety,
    passed,
  });

  return {
    ...score,
    hookText,
    ...(kickerText ? { kickerText } : {}),
    ...(statBadge ? { statBadge } : {}),
    ...(durationBadge ? { durationBadge } : {}),
    score,
    warnings,
  };
}

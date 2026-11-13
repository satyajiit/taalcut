// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Social publishing metadata & research builder: synthesizes and validates
 * ready-to-paste YouTube (title, alternates, description with 00:00 chapters,
 * comma-separable search tags), Instagram Reels/Feed (hookLine, caption,
 * normalized hashtags), and TikTok (caption, SEO search bar keywords, hashtags)
 * metadata packs from agent research and timeline context.
 */
import { socialMetadataPackSchema, type SocialChapter, type SocialMetadataPack } from '@taalcut/core';

export type { SocialMetadataPartial, SocialMetadataInput } from './social-metadata-types';
import type { SocialMetadataPartial, SocialMetadataInput } from './social-metadata-types';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'over',
  'under',
  'shot',
  'frame',
  'video',
  'clip',
  'hero',
  'subject',
]);

function clampText(text: string, max: number): string {
  const cleaned = text.trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trimEnd();
}

function toTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && STOP_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

function normalizeTimecode(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d:\d{2}$/.test(trimmed)) return `0${trimmed}`;
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) return trimmed;
  return clampText(trimmed.length >= 4 ? trimmed : '00:00', 12);
}

/**
 * Normalizes chapters and guarantees that when chapters are present, the first
 * chapter always starts at `00:00` (YouTube chapter requirement).
 */
export function normalizeSocialChapters(
  rawChapters: readonly SocialChapter[] | undefined,
  fallbackOpeningLabel = 'Intro & Hook',
): SocialChapter[] {
  if (!rawChapters || rawChapters.length === 0) return [];
  const normalized: SocialChapter[] = rawChapters
    .map((ch) => ({
      timecode: normalizeTimecode(ch.timecode),
      label: clampText(ch.label.replace(/\s+/g, ' '), 80) || 'Beat',
    }))
    .filter((ch) => ch.label.length > 0);
  if (normalized.length === 0) return [];
  if (normalized[0]!.timecode !== '00:00') {
    normalized.unshift({
      timecode: '00:00',
      label: clampText(fallbackOpeningLabel, 80) || 'Intro & Hook',
    });
  }
  return normalized.slice(0, 25);
}

/** Normalizes hashtag strings by stripping any leading `#` and spaces so UI can format `#tag` without `##tag`. */
export function normalizeHashtags(
  raw: readonly string[],
  fallbackPool: readonly string[],
  minCount: number,
  maxCount: number,
): string[] {
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const cleaned = candidate
      .replace(/^#+/, '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .toLowerCase()
      .slice(0, 40);
    if (cleaned.length >= 2) seen.add(cleaned);
  };
  for (const item of raw) {
    for (const part of item.split(/[\s,]+/)) add(part);
  }
  for (const fallback of fallbackPool) {
    if (seen.size >= minCount) break;
    add(fallback);
  }
  const extraDefaults = [
    'filmmaking',
    'cinematography',
    'videoediting',
    'shortformvideo',
    'storytelling',
    'behindthescenes',
    'visualstorytelling',
    'colorgrading',
  ];
  for (const d of extraDefaults) {
    if (seen.size >= minCount) break;
    add(d);
  }
  return [...seen].slice(0, maxCount);
}

/** Formats YouTube search tags as a ready-to-paste comma-separated string (`tag1, tag2, tag3`). */
export function formatYoutubeTagsCsv(tags: readonly string[]): string {
  return tags
    .map((t) => t.trim())
    .filter(Boolean)
    .join(', ');
}

function buildYoutubeTags(
  supplied: readonly string[] | undefined,
  baseWords: readonly string[],
  topicTitle: string,
  styleText: string,
): string[] {
  const seen = new Set<string>();
  const add = (raw: string) => {
    const cleaned = clampText(raw.replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase(), 50);
    if (cleaned.length >= 2) seen.add(cleaned);
  };
  for (const item of supplied ?? []) {
    for (const part of item.split(',')) add(part);
  }
  add(topicTitle.toLowerCase());
  for (const word of baseWords.slice(0, 8)) {
    add(word);
    add(`${word} video`);
    add(`${word} edit`);
  }
  if (styleText) add(styleText.toLowerCase());
  const defaults = [
    'visual storytelling',
    'cinematic edit',
    'short form filmmaking',
    'color grading',
    'camera movement',
    'sound design',
    'director cut',
    'field notes',
    'video breakdown',
    'editorial film',
  ];
  for (const d of defaults) {
    if (seen.size >= 8) break;
    add(d);
  }
  let length = 0;
  return [...seen].slice(0, 25).filter((tag) => {
    const next = tag.length + (tag.includes(' ') ? 2 : 0) + (length ? 1 : 0);
    if (length + next > 500) return false;
    length += next;
    return true;
  });
}

function buildResearchSummary(
  supplied: readonly string[] | undefined,
  hookTitle: string,
  scenePrompt: string,
  styleLabel: string,
  chapters: readonly SocialChapter[],
  audienceLabel: string,
): string[] {
  const bullets = (supplied ?? [])
    .map((line) => clampText(line.replace(/\s+/g, ' '), 160))
    .filter((line) => line.length > 0);
  const defaults = [
    clampText(`Hook angle: "${hookTitle}" framed as a direct, non-clickbait specimen headline.`, 160),
    clampText(
      `Visual anchor: ${scenePrompt || hookTitle} with high-contrast typographic negative space.`,
      160,
    ),
    clampText(
      chapters.length > 0
        ? `Pacing & structure: ${chapters.length} indexed chapters starting at 00:00 (${chapters[0]!.label}).`
        : `Aesthetic & pacing: ${styleLabel} cut for immediate first-frame retention.`,
      160,
    ),
    clampText(
      `Search & audience intent: tailored for ${audienceLabel} across YouTube, Reels, and TikTok SEO.`,
      160,
    ),
  ];
  for (const fallback of defaults) {
    if (bullets.length >= 2 && supplied && supplied.length >= 2) break;
    if (bullets.length < 6 && !bullets.includes(fallback)) bullets.push(fallback);
    if (bullets.length >= 4 && (!supplied || supplied.length === 0)) break;
  }
  return bullets.slice(0, 6);
}

/**
 * Builds a complete, schema-validated `SocialMetadataPack` for YouTube, Instagram,
 * and TikTok from agent research and timeline/thumbnail context.
 */
export function buildSocialMetadataPack(input: SocialMetadataInput): SocialMetadataPack {
  const partial: SocialMetadataPartial = {
    researchSummary: input.social?.researchSummary ?? input.researchSummary,
    youtube: { ...input.youtube, ...input.social?.youtube },
    instagram: { ...input.instagram, ...input.social?.instagram },
    tiktok: { ...input.tiktok, ...input.social?.tiktok },
  };

  const rawHook = (input.hookText ?? input.topic ?? 'Field Study').trim();
  const hookTitle = rawHook === rawHook.toUpperCase() ? toTitleCase(rawHook) : rawHook;
  const kicker = input.kickerText ? toTitleCase(input.kickerText) : undefined;
  const scenePrompt = (input.prompt ?? input.topic ?? hookTitle).trim().replace(/\s+/g, ' ');
  const styleLabel =
    input.style ??
    input.vibe ??
    `${input.archetype ?? 'editorial-specimen'} · ${input.theme ?? 'golden-hour'}`;
  const audienceLabel = input.targetAudience ?? input.audience ?? 'creators and visual storytellers';

  const chapters = normalizeSocialChapters(partial.youtube?.chapters ?? input.chapters, hookTitle);

  const keywordPool = [
    ...(input.keywords ?? []),
    ...extractKeywords(`${hookTitle} ${kicker ?? ''} ${scenePrompt} ${input.transcript ?? ''}`),
  ];

  const defaultYtTitle = clampText(
    kicker ? `${hookTitle}: ${kicker}` : `${hookTitle} — Visual Breakdown & Field Notes`,
    100,
  );
  const ytTitle = clampText(partial.youtube?.title ?? defaultYtTitle, 100);

  const defaultAlternates = [
    clampText(
      input.statBadge
        ? `${hookTitle} (${input.statBadge}): Inside the Cut`
        : `Inside ${hookTitle}: How Each Beat Lands`,
      100,
    ),
    clampText(`${kicker ? `${kicker} — ` : ''}${hookTitle} in Real Time`, 100),
    clampText(`Why ${hookTitle} Works: Framing, Pacing & Light`, 100),
  ];
  const ytAlternates = (
    partial.youtube?.titleAlternates && partial.youtube.titleAlternates.length >= 2
      ? partial.youtube.titleAlternates.map((t) => clampText(t, 100))
      : [...(partial.youtube?.titleAlternates?.map((t) => clampText(t, 100)) ?? []), ...defaultAlternates]
  ).slice(0, 4);

  const ytTags = buildYoutubeTags(partial.youtube?.tags, keywordPool, hookTitle, styleLabel);

  const chapterLines =
    chapters.length > 0 ? `\n\nChapters:\n${chapters.map((c) => `${c.timecode} ${c.label}`).join('\n')}` : '';
  const channelSignOff =
    input.channel?.name || input.channel?.handle
      ? `\n\nFilmed & edited by ${[input.channel.name, input.channel.handle].filter(Boolean).join(' · ')}.`
      : '';

  const baseYtDescription =
    partial.youtube?.description?.trim() ??
    `${ytTitle}\n${scenePrompt}${
      input.transcript ? `\n\nKey notes: ${clampText(input.transcript, 400)}` : ''
    }`;
  const withChapters =
    chapters.length > 0 && !baseYtDescription.includes('00:00')
      ? `${baseYtDescription}${chapterLines}`
      : baseYtDescription;
  const fullYtDescription = clampText(
    channelSignOff && !withChapters.includes(channelSignOff.trim())
      ? `${withChapters}${channelSignOff}`
      : withChapters,
    5000,
  );

  const igHookLine = clampText(
    partial.instagram?.hookLine ?? `${hookTitle}${kicker ? ` — ${kicker}` : ''}.`,
    140,
  );
  const igCaption = clampText(
    partial.instagram?.caption ??
      `${igHookLine}\n\n${scenePrompt}\n\nSave this cut for your next edit reference and share with a collaborator.`,
    2200,
  );
  const igHashtags = normalizeHashtags(partial.instagram?.hashtags ?? [], keywordPool, 5, 15);

  const seoKeywords = (() => {
    const supplied = (partial.tiktok?.seoKeywords ?? [])
      .map((k) => clampText(k.toLowerCase(), 40))
      .filter((k) => k.length >= 2);
    const topWords = keywordPool.slice(0, 5);
    const fallbacks = [
      clampText(hookTitle.toLowerCase(), 40),
      ...topWords.map((w) => clampText(`${w} aesthetic`, 40)),
      clampText(`${topWords[0] ?? 'video'} editing breakdown`, 40),
      'cinematic vlog',
    ];
    const combined = [...new Set([...supplied, ...fallbacks])].filter((k) => k.length >= 2);
    return combined.slice(0, Math.max(3, Math.min(8, combined.length)));
  })();

  const tiktokCaption = clampText(
    partial.tiktok?.caption ??
      `${hookTitle}${kicker ? ` · ${kicker}` : ''} — ${scenePrompt} (${seoKeywords.slice(0, 2).join(', ')}).`,
    2200,
  );
  const tiktokHashtags = normalizeHashtags(partial.tiktok?.hashtags ?? [], keywordPool, 4, 10);

  const researchSummary = buildResearchSummary(
    partial.researchSummary,
    hookTitle,
    scenePrompt,
    styleLabel,
    chapters,
    audienceLabel,
  );

  return socialMetadataPackSchema.parse({
    researchSummary,
    youtube: {
      title: ytTitle,
      titleAlternates: ytAlternates,
      description: fullYtDescription,
      tags: ytTags,
      chapters,
    },
    instagram: {
      hookLine: igHookLine,
      caption: igCaption,
      hashtags: igHashtags,
    },
    tiktok: {
      caption: tiktokCaption,
      seoKeywords,
      hashtags: tiktokHashtags,
    },
  });
}

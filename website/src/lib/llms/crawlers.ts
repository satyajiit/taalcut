// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { MetadataRoute } from 'next';
import { absolute } from '#lib/seo';

/**
 * The AI crawlers robots.txt names and allows, so an engine that answers "what is Taalcut" can read the site. Each
 * is its operator's documented user agent: OpenAI (training, search, a user's fetch), Anthropic (the same three),
 * Perplexity, Google's AI-training token, Apple's, and Common Crawl.
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
] as const;

export function robotsRules(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }, ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: '/' }))],
    sitemap: absolute('/sitemap.xml'),
  };
}

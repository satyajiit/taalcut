// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a platform's caption rule (post-caption.ts) applied. `buildPostCaption` assembles the text from the
 * parts the AI states, in the platform's order, and says what is outside the rule; `postCaptionIssues` reads a
 * whole text the same way, for a person's own edit, which is flagged and never refused. Both read every number
 * and the order from `POST_CAPTION_RULES`. Pure: no words for a person or a model are written here, only what is
 * wrong and by how much (the tool and the panel put it in words).
 */
import {
  postCaptionRule,
  type PostCaptionBlock,
  type PostCaptionParts,
  type PostCaptionPlatform,
  type PostCaptionRule,
} from './post-caption';

/** What a hashtag is made of: letters of any script, their marks, digits and the underscore. */
const WORD = '\\p{L}\\p{M}\\p{N}_';
const HASHTAG = new RegExp(`(?<![${WORD}])#[${WORD}]+`, 'gu');
const TAG = new RegExp(`^[${WORD}]+$`, 'u');
const TAGS_ONLY = new RegExp(`^(?:#[${WORD}]+\\s*)+$`, 'u');
/** What would break the bracketed list apart, or count as a hashtag. */
const KEYWORD_BREAK = /[(),#\n\r]/u;
const LIST_AT_END = /\(([^()]*)\)\s*$/u;
const LIST_ONLY = /^\([^()]*\)$/u;

/** What is outside a platform's rule, with the numbers that say by how much. */
export type PostCaptionIssue =
  | { readonly code: 'bodyEmpty' }
  /** The model typed the credit line, or its handle: the tool adds it, the model never does. */
  | { readonly code: 'creditTyped' }
  | { readonly code: 'hashtagInvalid'; readonly tag: string }
  | { readonly code: 'keywordInvalid'; readonly keyword: string }
  /** `inBody`: how many of them were typed in the body (a built caption only). */
  | { readonly code: 'hashtagsFew'; readonly count: number; readonly min: number; readonly inBody?: number }
  | { readonly code: 'hashtagsMany'; readonly count: number; readonly max: number; readonly inBody?: number }
  /** No bracketed list of search phrases at the very end. */
  | { readonly code: 'keywordsMissing' }
  | { readonly code: 'keywordsFew'; readonly count: number; readonly min: number }
  | { readonly code: 'keywordsMany'; readonly count: number; readonly max: number }
  | { readonly code: 'creditMissing' }
  | { readonly code: 'creditRepeated'; readonly count: number }
  | { readonly code: 'tooLong'; readonly length: number; readonly max: number };
export type PostCaptionIssueCode = PostCaptionIssue['code'];

/** What a caption's text holds, as its platform counts it. */
export interface PostCaptionFacts {
  readonly length: number;
  /** The first line's length: what the feed shows before "… more" (the rule's `feedCut`). */
  readonly firstLine: number;
  readonly hashtags: number;
  /** The phrases in the bracketed list at the very end; null when the text does not end with one. */
  readonly keywords: number | null;
  /** How many times the credit line is in it. */
  readonly credits: number;
}

/** The hashtags in a text, as typed (with their #). */
export function postCaptionHashtags(text: string): string[] {
  return text.match(HASHTAG) ?? [];
}

/** The search phrases of the bracketed list a text ends with; null when it ends with none. */
export function postCaptionKeywords(text: string): string[] | null {
  const list = LIST_AT_END.exec(text);
  if (!list) return null;
  return (list[1] ?? '')
    .split(',')
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

const occurrences = (text: string, phrase: string): number =>
  phrase ? text.toLowerCase().split(phrase.toLowerCase()).length - 1 : 0;

export function postCaptionFacts(platform: PostCaptionPlatform, text: string): PostCaptionFacts {
  const rule = postCaptionRule(platform);
  return {
    length: text.length,
    firstLine: (text.trimStart().split('\n')[0] ?? '').length,
    hashtags: postCaptionHashtags(text).length,
    keywords: postCaptionKeywords(text)?.length ?? null,
    credits: occurrences(text, rule.credit),
  };
}

/** The rule held against what a text holds. `credit`: whether the person keeps the credit line on. */
function issuesOf(rule: PostCaptionRule, facts: PostCaptionFacts, credit: boolean): PostCaptionIssue[] {
  const issues: PostCaptionIssue[] = [];
  const { min, max } = rule.hashtags;
  if (facts.hashtags < min) issues.push({ code: 'hashtagsFew', count: facts.hashtags, min });
  if (facts.hashtags > max) issues.push({ code: 'hashtagsMany', count: facts.hashtags, max });
  if (rule.order.includes('keywords')) {
    if (facts.keywords === null || facts.keywords === 0) issues.push({ code: 'keywordsMissing' });
    else if (facts.keywords < rule.keywords.min)
      issues.push({ code: 'keywordsFew', count: facts.keywords, min: rule.keywords.min });
    else if (facts.keywords > rule.keywords.max)
      issues.push({ code: 'keywordsMany', count: facts.keywords, max: rule.keywords.max });
  }
  if (rule.order.includes('credit')) {
    if (credit && facts.credits === 0) issues.push({ code: 'creditMissing' });
    if (facts.credits > 1) issues.push({ code: 'creditRepeated', count: facts.credits });
  }
  if (facts.length > rule.maxLength)
    issues.push({ code: 'tooLong', length: facts.length, max: rule.maxLength });
  return issues;
}

/**
 * What in a whole text is outside the platform's rule: a person's own edit read as the tool reads the AI's.
 * With the credit off, a credit line the person typed themselves is theirs to keep (only a repeat is said).
 */
export function postCaptionIssues(
  platform: PostCaptionPlatform,
  text: string,
  options: { readonly credit: boolean },
): PostCaptionIssue[] {
  return issuesOf(postCaptionRule(platform), postCaptionFacts(platform, text), options.credit);
}

/** Each once, whatever its letters' case, first first. */
function once(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The credit line and the handles in it: what a model must not type. */
function creditMarks(rule: PostCaptionRule): string[] {
  return [rule.credit, ...(rule.credit.match(/@[\w.]+/gu) ?? [])].map((mark) => mark.toLowerCase());
}

export interface BuiltPostCaption {
  /** The caption in the platform's order. Only to be kept when `issues` is empty. */
  readonly text: string;
  readonly issues: readonly PostCaptionIssue[];
}

/**
 * The caption built from the parts the AI stated: the body, then the platform's other blocks in its order, each
 * its own paragraph, the search phrases as one bracketed list. The credit line is added here when `credit` is on,
 * and never taken from the parts. Hashtags may come with or without their #; a hashtag typed in the body counts
 * toward the platform's total.
 */
export function buildPostCaption(
  platform: PostCaptionPlatform,
  parts: PostCaptionParts,
  options: { readonly credit: boolean },
): BuiltPostCaption {
  const rule = postCaptionRule(platform);
  const body = parts.body
    .replace(/\r\n?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  const tags = once(parts.hashtags.map((tag) => tag.trim().replace(/^#+/u, '')).filter(Boolean));
  const keywords = once(
    parts.keywords.map((phrase) => phrase.replace(/[^\S\n\r]+/gu, ' ').trim()).filter(Boolean),
  );
  const issues: PostCaptionIssue[] = [];
  if (!body) issues.push({ code: 'bodyEmpty' });
  const marks = creditMarks(rule);
  const stated = [body, ...parts.hashtags, ...parts.keywords].join('\n').toLowerCase();
  if (marks.some((mark) => stated.includes(mark))) issues.push({ code: 'creditTyped' });
  for (const tag of tags) if (!TAG.test(tag)) issues.push({ code: 'hashtagInvalid', tag });
  for (const keyword of keywords)
    if (KEYWORD_BREAK.test(keyword)) issues.push({ code: 'keywordInvalid', keyword });

  const blocks: Readonly<Record<PostCaptionBlock, string>> = {
    body,
    credit: options.credit ? rule.credit : '',
    hashtags: tags.map((tag) => `#${tag}`).join(' '),
    keywords: keywords.length > 0 ? `(${keywords.join(', ')})` : '',
  };
  const text = rule.order
    .map((block) => blocks[block])
    .filter(Boolean)
    .join('\n\n');
  const inBody = postCaptionHashtags(body).length;
  // The stated parts are the facts here: the list is the one stated, the credit the one this function added.
  const facts: PostCaptionFacts = {
    ...postCaptionFacts(platform, text),
    hashtags: inBody + tags.length,
    keywords: keywords.length,
    credits: options.credit ? 1 : 0,
  };
  for (const issue of issuesOf(rule, facts, options.credit))
    issues.push(issue.code === 'hashtagsFew' || issue.code === 'hashtagsMany' ? { ...issue, inBody } : issue);
  return { text, issues };
}

/** True for a paragraph that is one of the blocks a platform puts after its credit line. */
function comesAfterCredit(block: string, after: ReadonlySet<PostCaptionBlock>): boolean {
  const words = block.trim();
  return (after.has('keywords') && LIST_ONLY.test(words)) || (after.has('hashtags') && TAGS_ONLY.test(words));
}

/**
 * A caption's text with the credit line on or off, for the panel's switch: off takes out every line that is the
 * credit; on puts it back once, where the platform's order has it (before the hashtags and the bracketed list
 * the text ends with). Everything else stays as written, paragraphs a blank line apart.
 */
export function withPostCaptionCredit(platform: PostCaptionPlatform, text: string, on: boolean): string {
  const rule = postCaptionRule(platform);
  const at = rule.order.indexOf('credit');
  if (at < 0) return text;
  const credit = rule.credit.toLowerCase();
  const blocks = text
    .replace(/\r\n?/gu, '\n')
    .split(/\n[^\S\n]*\n+/u)
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.trim().toLowerCase() !== credit)
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
  if (!on) return blocks.join('\n\n');
  const after = new Set(rule.order.slice(at + 1));
  let end = blocks.length;
  while (end > 0 && comesAfterCredit(blocks[end - 1] ?? '', after)) end -= 1;
  return [...blocks.slice(0, end), rule.credit, ...blocks.slice(end)].join('\n\n');
}

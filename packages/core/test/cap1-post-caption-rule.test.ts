// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: a platform's caption rule, applied. The AI states parts and `buildPostCaption` assembles the text in the
 * platform's order; `postCaptionIssues` reads a whole text the same way, for a person's own edit. Every number
 * comes from `POST_CAPTION_RULES`.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPostCaption,
  POST_CAPTION_PLATFORMS,
  POST_CAPTION_RULES,
  postCaptionFacts,
  postCaptionHashtags,
  postCaptionIssues,
  postCaptionKeywords,
  withPostCaptionCredit,
  type PostCaptionParts,
} from '@taalcut/core';

const rule = POST_CAPTION_RULES.instagram;
const BODY =
  'Sunrise at Hoan Kiem Lake, before the city wakes.\n\nWe walked the whole loop with a cup of egg coffee. Would you get up at five for this?';
const parts = (over: Partial<PostCaptionParts> = {}): PostCaptionParts => ({
  body: BODY,
  hashtags: ['hanoi', 'HoanKiemLake', 'vietnamtravel', 'eggcoffee'],
  keywords: ['hanoi morning walk', 'hoan kiem lake sunrise', 'egg coffee hanoi'],
  ...over,
});
const codes = (over: Partial<PostCaptionParts>, credit = true) =>
  buildPostCaption('instagram', parts(over), { credit }).issues.map((issue) => issue.code);
const GOOD = [
  BODY,
  'Created with @taalcut.app',
  '#hanoi #HoanKiemLake #vietnamtravel #eggcoffee',
  '(hanoi morning walk, hoan kiem lake sunrise, egg coffee hanoi)',
].join('\n\n');

describe('the rule table (CAP1)', () => {
  it('holds Instagram’s rule as data: counts, the limit, the credit line and the order', () => {
    expect(POST_CAPTION_PLATFORMS).toEqual(['instagram']);
    expect(rule).toEqual({
      name: 'Instagram',
      maxLength: 2200,
      feedCut: 125,
      hashtags: { min: 1, max: 4 },
      keywords: { min: 3, max: 10 },
      credit: 'Created with @taalcut.app',
      order: ['body', 'credit', 'hashtags', 'keywords'],
    });
  });
});

describe('a caption built from the parts the AI states (CAP1)', () => {
  it('assembles the body, the credit line, the hashtags and the bracketed search phrases, in that order', () => {
    const built = buildPostCaption('instagram', parts(), { credit: true });
    expect(built.issues).toEqual([]);
    expect(built.text).toBe(GOOD);
    expect(postCaptionIssues('instagram', built.text, { credit: true })).toEqual([]);
  });

  it('takes hashtags with or without their #, each once, and tidies the phrases', () => {
    const built = buildPostCaption(
      'instagram',
      parts({
        hashtags: ['#hanoi', ' ##Hanoi ', 'eggcoffee'],
        keywords: ['  hanoi   morning walk ', 'Hanoi morning walk', 'egg coffee', 'old quarter'],
      }),
      { credit: true },
    );
    expect(built.issues).toEqual([]);
    expect(built.text.endsWith('#hanoi #eggcoffee\n\n(hanoi morning walk, egg coffee, old quarter)')).toBe(
      true,
    );
  });

  it('leaves the credit line out when the person turned the credit off', () => {
    const built = buildPostCaption('instagram', parts(), { credit: false });
    expect(built.issues).toEqual([]);
    expect(built.text).toBe(GOOD.replace('Created with @taalcut.app\n\n', ''));
    expect(built.text).not.toContain('@taalcut.app');
  });

  it('says five hashtags are one too many, and none is one too few', () => {
    const five = buildPostCaption('instagram', parts({ hashtags: ['a1', 'b2', 'c3', 'd4', 'e5'] }), {
      credit: true,
    });
    expect(five.issues).toEqual([{ code: 'hashtagsMany', count: 5, max: 4, inBody: 0 }]);
    const none = buildPostCaption('instagram', parts({ hashtags: [] }), { credit: true });
    expect(none.issues).toEqual([{ code: 'hashtagsFew', count: 0, min: 1, inBody: 0 }]);
  });

  it('counts a hashtag typed inside the body toward the four', () => {
    const built = buildPostCaption('instagram', parts({ body: `${BODY} #sunrise` }), { credit: true });
    expect(built.issues).toEqual([{ code: 'hashtagsMany', count: 5, max: 4, inBody: 1 }]);
    // Within four, a body's own hashtag is fine.
    expect(codes({ body: `${BODY} #sunrise`, hashtags: ['hanoi', 'eggcoffee'] })).toEqual([]);
  });

  it('wants the search phrases: none, too few and too many are each said', () => {
    expect(codes({ keywords: [] })).toEqual(['keywordsMissing']);
    expect(codes({ keywords: ['   '] })).toEqual(['keywordsMissing']);
    expect(
      buildPostCaption('instagram', parts({ keywords: ['one', 'two'] }), { credit: true }).issues,
    ).toEqual([{ code: 'keywordsFew', count: 2, min: 3 }]);
    const many = Array.from({ length: 11 }, (_, index) => `phrase ${index}`);
    expect(buildPostCaption('instagram', parts({ keywords: many }), { credit: true }).issues).toEqual([
      { code: 'keywordsMany', count: 11, max: 10 },
    ]);
  });

  it('refuses the credit line typed by the model, with the credit on or off', () => {
    for (const credit of [true, false]) {
      expect(codes({ body: `${BODY}\n\nCreated with @taalcut.app` }, credit)).toEqual(['creditTyped']);
      expect(codes({ body: `${BODY} Made with @Taalcut.App!` }, credit)).toEqual(['creditTyped']);
      expect(codes({ keywords: ['@taalcut.app', 'hanoi walk', 'egg coffee'] }, credit)).toEqual([
        'creditTyped',
      ]);
    }
  });

  it('holds the whole caption to the platform’s length', () => {
    const long = 'x'.repeat(rule.maxLength);
    const built = buildPostCaption('instagram', parts({ body: long }), { credit: true });
    expect(built.issues).toEqual([{ code: 'tooLong', length: built.text.length, max: 2200 }]);
    expect(built.text.length).toBeGreaterThan(rule.maxLength);
    // The longest body that still fits with its other blocks passes.
    const room = rule.maxLength - (GOOD.length - BODY.length);
    expect(codes({ body: 'x'.repeat(room) })).toEqual([]);
    expect(codes({ body: 'x'.repeat(room + 1) })).toEqual(['tooLong']);
  });

  it('names a hashtag that is not one word, a phrase that would break the list, and an empty body', () => {
    expect(
      buildPostCaption('instagram', parts({ hashtags: ['hanoi travel'] }), { credit: true }).issues,
    ).toEqual([{ code: 'hashtagInvalid', tag: 'hanoi travel' }]);
    expect(codes({ hashtags: ['हनोई', 'café_2026'] })).toEqual([]);
    expect(
      buildPostCaption('instagram', parts({ keywords: ['hanoi, vietnam', 'egg coffee', 'old quarter'] }), {
        credit: true,
      }).issues,
    ).toEqual([{ code: 'keywordInvalid', keyword: 'hanoi, vietnam' }]);
    // A # in a phrase is named as the phrase's fault, once: the list is not read for hashtags as well.
    expect(codes({ keywords: ['#hanoi', 'egg coffee', 'old quarter'] })).toEqual(['keywordInvalid']);
    expect(codes({ body: '  \n ' })).toEqual(['bodyEmpty']);
  });
});

describe('a whole text read against the rule, as a person’s edit is (CAP1)', () => {
  it('counts what the platform counts', () => {
    expect(postCaptionFacts('instagram', GOOD)).toEqual({
      length: GOOD.length,
      firstLine: 'Sunrise at Hoan Kiem Lake, before the city wakes.'.length,
      hashtags: 4,
      keywords: 3,
      credits: 1,
    });
    expect(postCaptionHashtags('C# and item#3 are not tags; #one and (#two) are')).toEqual(['#one', '#two']);
    expect(postCaptionKeywords('words (not, the, end) more words')).toBeNull();
    expect(postCaptionKeywords('words\n\n(a walk,  b ,, c)\n')).toEqual(['a walk', 'b', 'c']);
  });

  it('flags a fifth hashtag, a list that is gone or moved off the end, and a text past the limit', () => {
    const issues = (text: string, credit = true) =>
      postCaptionIssues('instagram', text, { credit }).map((issue) => issue.code);
    expect(issues(`${GOOD.replace('#eggcoffee', '#eggcoffee #sunrise')}`)).toEqual(['hashtagsMany']);
    expect(issues(GOOD.replace(/\n\n\(.*\)$/u, ''))).toEqual(['keywordsMissing']);
    expect(issues(`${GOOD}\n\nOne more line`)).toEqual(['keywordsMissing']);
    expect(issues(GOOD.replace(/#\w+ ?/gu, ''))).toEqual(['hashtagsFew']);
    expect(issues(`${'y'.repeat(2200)}\n\n${GOOD}`)).toEqual(['tooLong']);
  });

  it('wants the credit line once while the credit is on, and leaves a person’s own credit alone when off', () => {
    const without = GOOD.replace('Created with @taalcut.app\n\n', '');
    const issues = (text: string, credit: boolean) => postCaptionIssues('instagram', text, { credit });
    expect(issues(without, true)).toEqual([{ code: 'creditMissing' }]);
    expect(issues(without, false)).toEqual([]);
    expect(issues(GOOD, false)).toEqual([]);
    expect(issues(`${GOOD.replace(BODY, `${BODY}\n\ncreated with @taalcut.app`)}`, true)).toEqual([
      { code: 'creditRepeated', count: 2 },
    ]);
  });
});

describe('the credit switch applied to a text (CAP1)', () => {
  const without = GOOD.replace('Created with @taalcut.app\n\n', '');

  it('takes the credit line out, and puts it back where the platform’s order has it', () => {
    expect(withPostCaptionCredit('instagram', GOOD, false)).toBe(without);
    expect(withPostCaptionCredit('instagram', without, true)).toBe(GOOD);
    expect(withPostCaptionCredit('instagram', GOOD, true)).toBe(GOOD);
    expect(withPostCaptionCredit('instagram', without, false)).toBe(without);
  });

  it('keeps a person’s own words: only whole credit lines go, and a text with no tail gets the line last', () => {
    const own = 'My own words.\nCreated with @taalcut.app\nSecond line.\n\n\n\n#one';
    expect(withPostCaptionCredit('instagram', own, false)).toBe('My own words.\nSecond line.\n\n#one');
    expect(withPostCaptionCredit('instagram', own, true)).toBe(
      'My own words.\nSecond line.\n\nCreated with @taalcut.app\n\n#one',
    );
    expect(withPostCaptionCredit('instagram', 'Just a line (with brackets) inside.', true)).toBe(
      'Just a line (with brackets) inside.\n\nCreated with @taalcut.app',
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hub template v0, its content rules and the Worker's bodies (P3-B12, docs/template-hub.md). */
import { describe, expect, it } from 'vitest';
import * as core from '@taalcut/core';
import * as hubEntry from '@taalcut/core/hub';
import {
  HUB_CONTENT_RULES,
  HUB_ERROR_CODES,
  HUB_MAX_BYTES,
  HUB_PLACEHOLDER_VALUES,
  HUB_ROLE_PLACEHOLDERS,
  hubContentProblems,
  hubErrorBodySchema,
  hubInstallKeySchema,
  hubRatingsSchema,
  hubReportRequestSchema,
  hubStyleV0Schema,
  hubSubmissionRequestSchema,
  hubSubmissionResponseSchema,
  hubTemplateV0Schema,
  isPlaceholderText,
  MAX_HUB_PROBLEMS,
  newId,
  TEXT_PLACEHOLDERS,
  type ErrorDefinition,
} from '@taalcut/core';
import { issuePaths, json } from './helpers/documents';
import { hubTemplate, style } from './helpers/phase3';

const KEY = 'A'.repeat(22);

describe('hub template v0', () => {
  it('parses the reference template as the hub holds it, and survives a JSON round trip', () => {
    const doc = hubTemplate();
    expect(hubTemplateV0Schema.parse(json(doc))).toEqual(json(doc));
  });

  it('is strict: nothing private rides along', () => {
    const doc = hubTemplate();
    const [slot] = doc.structure.slots;
    const [overlay] = doc.structure.text;
    const leaky = {
      ...doc,
      url: 'x',
      structure: {
        ...doc.structure,
        slots: [{ ...slot, frame: 0, intent: { ...slot!.intent, source: 'analyst' } }],
        text: [{ ...overlay, text: 'Day 1 in Goa' }],
      },
    };
    expect(issuePaths(hubTemplateV0Schema, leaky)).toEqual(
      expect.arrayContaining(['', 'structure.slots.0', 'structure.slots.0.intent', 'structure.text.0']),
    );
  });

  it('checks the handle, tags, ids, dates and formats', () => {
    const doc = hubTemplate();
    const bad = {
      ...doc,
      id: 'not-a-ulid',
      handle: 'X',
      tags: ['Travel'],
      trendFreshness: '1 Oct',
      formatId: 'reel',
      licence: 'CC-BY-4.0',
      forkedFrom: { id: newId<'HubTemplate'>(), version: 0 },
    };
    expect(issuePaths(hubTemplateV0Schema, bad).sort()).toEqual(
      ['forkedFrom.version', 'formatId', 'handle', 'id', 'licence', 'tags.0', 'trendFreshness'].sort(),
    );
    expect(hubTemplateV0Schema.safeParse({ ...doc, formatId: 'talkingHead' }).success).toBe(true);
  });

  it("a style without assets is a Style's colours, fonts, captions and text looks", () => {
    const { colours, fonts, captions, textStyles, logo } = style();
    expect(hubStyleV0Schema.safeParse({ colours, fonts, captions, textStyles }).success).toBe(true);
    expect(hubStyleV0Schema.safeParse({ colours, fonts, captions, textStyles, logo }).success).toBe(false);
  });

  it('overlays carry a placeholder for their role, never words', () => {
    expect(Object.values(HUB_ROLE_PLACEHOLDERS).every((text) => isPlaceholderText(text))).toBe(true);
    expect(HUB_PLACEHOLDER_VALUES).toEqual(['{title}', '{label}', '{list}', '{caption}', '{cta}', '{other}']);
    expect(TEXT_PLACEHOLDERS).toHaveLength(18);
    expect(isPlaceholderText('Day 1 in Goa')).toBe(false);
    const doc = hubTemplate();
    const overlay = { ...doc.structure.text[0], placeholder: '{offer}' };
    expect(
      hubTemplateV0Schema.safeParse({ ...doc, structure: { ...doc.structure, text: [overlay] } }).success,
    ).toBe(false);
  });
});

describe('hub content rules', () => {
  const with_ = (description: string) => ({ ...hubTemplate(), description });

  it('let a clean document through', () => {
    expect(hubContentProblems(hubTemplate())).toEqual([]);
  });

  it.each([
    ['url', 'see https://kaatu.example'],
    ['www', 'www.kaatu'],
    ['domain', 'shop at kaatu.com today'],
    ['email', 'write to me@kaatu.io'],
    ['handle', 'follow @kaatu.cuts'],
    ['phone', 'call +91 98765 43210'],
    ['encoded', `key ${'Qm'.repeat(20)}`],
    ['dataUri', 'data:image/png;base64,'],
    ['control', 'bell\u0007'],
  ])('catch %s in any string, with its path', (rule, text) => {
    expect(hubContentProblems(with_(text))).toContainEqual({ path: 'description', rule });
  });

  it('every rule is data the hub repository can compile', () => {
    expect(new Set(HUB_CONTENT_RULES.map((rule) => rule.id)).size).toBe(HUB_CONTENT_RULES.length);
    for (const rule of HUB_CONTENT_RULES) expect(() => new RegExp(rule.pattern, rule.flags)).not.toThrow();
  });

  it('want NFC, the shape and the size limit', () => {
    expect(hubContentProblems({ ...hubTemplate(), name: 'Café' })).toContainEqual({
      path: 'name',
      rule: 'notNfc',
    });
    expect(hubContentProblems('a template')).toEqual([{ path: '', rule: 'schema' }]);
    const big = { ...hubTemplate(), padding: ' '.repeat(HUB_MAX_BYTES) };
    expect(hubContentProblems(big)).toEqual(
      expect.arrayContaining([
        { path: '', rule: 'tooLarge' },
        { path: '', rule: 'schema' },
      ]),
    );
    expect(hubContentProblems({ ...hubTemplate(), tags: ['www.x'] })).toContainEqual({
      path: 'tags.0',
      rule: 'www',
    });
  });

  it('report at most MAX_HUB_PROBLEMS, with paths cut to 200 characters', () => {
    const doc = hubTemplate();
    const many = { ...doc, notes: Array.from({ length: 80 }, () => 'www.x') };
    expect(hubContentProblems(many)).toHaveLength(MAX_HUB_PROBLEMS);
    const long = hubContentProblems({ ...doc, ['k'.repeat(300)]: 'ok' });
    expect(long.every((problem) => problem.path.length <= 200)).toBe(true);
  });
});

describe('the hub Worker API', () => {
  it('validates submissions, ratings and reports', () => {
    expect(hubInstallKeySchema.safeParse(KEY).success).toBe(true);
    expect(hubInstallKeySchema.safeParse('short').success).toBe(false);
    expect(hubSubmissionRequestSchema.safeParse({ installKey: KEY, template: hubTemplate() }).success).toBe(
      true,
    );
    const response = {
      submissionId: newId<'HubSubmission'>(),
      hubId: newId<'HubTemplate'>(),
      version: 1,
      state: 'open',
      pullRequest: 12,
    };
    expect(hubSubmissionResponseSchema.safeParse(response).success).toBe(true);
    expect(hubSubmissionResponseSchema.safeParse({ ...response, state: 'pending' }).success).toBe(false);
    const ratings = { generatedAt: 0, ratings: { [newId<'HubTemplate'>()]: { count: 3, mean: 4.3 } } };
    expect(hubRatingsSchema.safeParse(ratings).success).toBe(true);
    expect(
      hubRatingsSchema.safeParse({ generatedAt: 0, ratings: { x: { count: 1, mean: 6 } } }).success,
    ).toBe(false);
    const report = { installKey: KEY, hubId: newId<'HubTemplate'>(), reason: 'copyright' };
    expect(hubReportRequestSchema.safeParse(report).success).toBe(true);
    expect(hubReportRequestSchema.safeParse({ ...report, reason: 'boring' }).success).toBe(false);
  });

  it('error bodies use the hub codes, and the app defines an error for each', () => {
    expect(hubErrorBodySchema.safeParse({ code: 'hub.rate_limited', retryAfterSeconds: 60 }).success).toBe(
      true,
    );
    expect(hubErrorBodySchema.safeParse({ code: 'hub.nope' }).success).toBe(false);
    const defined = (Object.values(core) as unknown[])
      .filter(
        (value): value is ErrorDefinition => typeof value === 'function' && 'code' in value && 'is' in value,
      )
      .map((define) => define.code)
      .filter((code) => code.startsWith('hub.'));
    expect(defined.sort()).toEqual([...HUB_ERROR_CODES].sort());
    expect(core.HubRateLimited({ retryAfterSeconds: 60 })).toMatchObject({
      retryable: true,
      params: { retryAfterSeconds: 60 },
    });
    expect(core.HubNotOwner().retryable).toBe(false);
  });

  it('the hub entry exports the same values as the main entry, and nothing with side effects', () => {
    for (const [name, value] of Object.entries(hubEntry))
      expect(core[name as keyof typeof core], name).toBe(value);
    expect(Object.keys(hubEntry)).not.toContain('HubRateLimited');
    expect(Object.keys(hubEntry)).not.toContain('hubContract');
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations, STACK_NAMES } from '#content/claims';
import { PAGES } from '#content/pages';
import { faqPageJsonLd, organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from '#lib/jsonld';
import { llmsFullTxt, llmsTxt } from '#lib/llms/llms-txt';
import { listedPages } from '#lib/llms/mirror';
import { pageMarkdown } from '#lib/llms/pages-md';
import { filesUnder, proseLiterals, read } from './source-files';

/** The stack sweep (the owner, 2026-11-06): nothing a visitor or an engine reads names what the site runs on. */
function stack(text: string) {
  return STACK_NAMES.filter(({ pattern }) => pattern.test(text)).map(({ why }) => ({ text, why }));
}

describe('the stack sweep', () => {
  it('catches the stack names, and lets the plain words through', () => {
    for (const bad of [
      'Google Firebase stores the waitlist and contact entries (Cloud Firestore).',
      'Firebase Hosting receives what every browser sends.',
      '`firebase-app-check-database`: the token showing the form passed its check',
      'reCAPTCHA Enterprise, through App Check, checks that a person is sending it.',
      'On Google Cloud.',
      'Built with Next.js, on Vercel or Cloudflare.',
      'Built with NextJS.',
    ]) {
      expect(claimViolations(bad), bad).not.toEqual([]);
    }
    for (const good of [
      'Our cloud provider stores the waitlist and contact entries and serves this website.',
      'When you send a form, a bot check run by our cloud provider reads signals from your browser.',
      'On our cloud provider’s servers.',
      'Use API keys for OpenAI, Anthropic, Google, OpenRouter and ElevenLabs.',
      'Google Gemini models with your API key',
      'What happens next',
      'Check the next clip.',
    ]) {
      expect(claimViolations(good), good).toEqual([]);
    }
  });

  it('holds for every prose string in the site’s source: pages, components and content', () => {
    const files = [...filesUnder('src/app', ['.tsx', '.ts']), ...filesUnder('src/components', ['.tsx', '.ts']), ...filesUnder('src/content', ['.ts'])].filter(
      (f) => !f.endsWith('media.gen.ts') && !f.endsWith('claims.ts'),
    );
    const found = files.flatMap((file) => proseLiterals(read(file)).flatMap(stack).map((v) => ({ file, ...v })));
    expect(found).toEqual([]);
  });

  it('holds for what engines read: llms.txt, llms-full.txt, every .md mirror and the JSON-LD', () => {
    const machine = [
      llmsTxt(),
      llmsFullTxt(),
      ...listedPages().map(pageMarkdown),
      ...PAGES.map((p) => `${p.title}\n${p.description}`),
      JSON.stringify([organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd(), faqPageJsonLd()]),
    ];
    const found = machine.flatMap((text) => text.split('\n').flatMap(stack));
    expect(found).toEqual([]);
  });
});

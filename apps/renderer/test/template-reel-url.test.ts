// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** BRK1-CMD: the review's player loads a template's kept reel from main's media host, which the CSP allows. */
import { APP_CSP_DIRECTIVES, newId, TEMPLATE_REEL_KEY_PATTERN } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeMedia } from '../src/backend/fake/fake-media';
import { appMediaUrls } from '../src/backend/media';

describe('MediaUrls.templateReel', () => {
  it('is app://media/template-reel/<templateId> in the app, a host the page may play media from', () => {
    const templateId = newId<'Template'>();
    const url = new URL(appMediaUrls.templateReel(templateId)!);
    expect(url.href).toBe(`app://media/template-reel/${templateId}`);
    expect(TEMPLATE_REEL_KEY_PATTERN.test(url.pathname.slice(1))).toBe(true);
    expect(APP_CSP_DIRECTIVES['media-src']).toContain(`${url.protocol}//${url.host}`);
  });

  it('is a sample clip in the fake backend', () => {
    expect(createFakeMedia().templateReel(newId<'Template'>())).toBe('/fake-media/landscape.mp4');
  });
});

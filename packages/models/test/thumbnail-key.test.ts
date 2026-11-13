// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId } from '@taalcut/core';
import { expect, it } from 'vitest';
import { generateThumbnailKey, type GenerateThumbnailInput } from '../src/images/thumbnail-tool-io';

const input: GenerateThumbnailInput = {
  projectId: newId<'Project'>(),
  prompt: 'A potter shaping a clay bowl',
  hookText: 'Made by hand',
  channel: { name: 'Studio', handle: '@studio' },
  social: { youtube: { title: 'Handmade', description: 'Making a bowl.' } },
};

it('does not replay old publishing copy or channel branding for an otherwise identical request', () => {
  const key = generateThumbnailKey(input);
  expect(generateThumbnailKey({ ...input, channel: { ...input.channel, name: 'New Studio' } })).not.toBe(key);
  expect(generateThumbnailKey({ ...input, channel: { ...input.channel, showOnThumbnail: false } })).not.toBe(
    key,
  );
  expect(generateThumbnailKey({ ...input, social: { youtube: { title: 'A New Title' } } })).not.toBe(key);
});

it('preserves idempotency when channel and nested social keys arrive in another order', () => {
  expect(
    generateThumbnailKey({
      ...input,
      channel: { handle: '@studio', name: 'Studio' },
      social: { youtube: { description: 'Making a bowl.', title: 'Handmade' } },
    }),
  ).toBe(generateThumbnailKey(input));
});

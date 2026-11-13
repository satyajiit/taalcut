// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addHeader, hasHeader, styleFor } from './headers.mjs';

test('Astro components are checked, with the header inside the frontmatter', () => {
  assert.equal(styleFor('website/src/pages/index.astro'), 'astro');
  const fixed = addHeader("---\nimport Logo from './Logo.astro';\n---\n<Logo />\n", 'astro');
  assert.ok(fixed.startsWith('---\n// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright'));
  assert.ok(hasHeader(fixed));
  assert.equal(fixed.split('\n').filter((line) => line === '---').length, 2);
});

test('an Astro component without frontmatter gets a fence of its own', () => {
  const fixed = addHeader('<p>Hi</p>\n', 'astro');
  assert.equal(
    fixed,
    '---\n// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Taalcut contributors\n---\n<p>Hi</p>\n',
  );
  assert.ok(hasHeader(fixed));
});

test('the other styles are unchanged', () => {
  assert.equal(styleFor('a.ts'), 'line');
  assert.equal(styleFor('a.yml'), 'hash');
  assert.equal(styleFor('a.css'), 'block');
  assert.equal(styleFor('a.md'), null);
  assert.ok(addHeader('#!/bin/sh\necho\n', 'hash').startsWith('#!/bin/sh\n# SPDX'));
  assert.ok(addHeader('a {}\n', 'block').startsWith('/* SPDX'));
});

test('a file without the header in its first lines is missing it', () => {
  assert.equal(hasHeader('---\nimport x from "y";\n---\n'), false);
});

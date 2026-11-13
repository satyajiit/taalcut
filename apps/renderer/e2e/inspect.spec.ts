// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The pseudo-locale's "text that does not fit" check (inspect.ts clippedText) on a page of its own: a person's own
// words cut with an ellipsis, the whole of them in the box's tooltip (a long chat title in the sidebar), are data
// of any length and are left out; UI text cut the same way is still found.
import { expect, test } from '@playwright/test';
import { clippedText } from './inspect.ts';

const CUT = 'display:block;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
const TITLE = 'Make a video from my latest clips of the Goa trip';

test('clippedText leaves out a person’s own words cut with an ellipsis, and still finds cut UI text', async ({
  page,
}) => {
  await page.setContent(`
    <span id="own" title="${TITLE}" style="${CUT}"><span data-user-content>${TITLE}</span></span>
    <span id="no-tooltip" style="${CUT}"><span data-user-content>${TITLE}</span></span>
    <span id="ui" title="Choose another folder for these clips" style="${CUT}">Choose another folder for these clips</span>
  `);
  const found = await clippedText(page);
  expect(found.map((each) => each.text)).toEqual([TITLE, 'Choose another folder for these clips']);
});
